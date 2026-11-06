import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseUserClient, verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";
import { completeProviderUsage, ProviderLimitError, reserveProviderUsage, type UsageReservation } from "@/lib/provider-usage.server";

// Stay below Vercel Functions’ request-body cap, including multipart overhead.
// The recorder’s 60-second 16 kHz mono WAV segments are about 1.9 MiB.
const MAX_FILE = 4 * 1024 * 1024;
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en";

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sse(transcript: string) {
  // The browser's recorder consumes the same text-delta/done event contract as before.
  // Hosted batch ASR returns a complete transcript, so it is sent as one delta.
  const body = [
    `data: ${JSON.stringify({ type: "transcript.text.delta", delta: transcript })}`,
    "",
    `data: ${JSON.stringify({ type: "transcript.text.done", text: transcript })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    },
  });
}

async function bearerToken(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  try {
    return (await verifySupabaseAccessToken(token)) ? token : null;
  } catch {
    return null;
  }
}

function safeProviderMessage(status: number) {
  if (status === 400 || status === 415) return "Deepgram could not read this audio. Try recording again.";
  if (status === 401 || status === 403) return "Deepgram rejected the API key. Check DEEPGRAM_API_KEY in Vercel.";
  if (status === 413) return "This audio segment is too large for transcription.";
  if (status === 429) return "Deepgram transcription is busy right now. Please wait a moment and try again.";
  return "Deepgram transcription failed. Please try again in a moment.";
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = await bearerToken(request);
        if (!token) return json({ error: "Please sign in again." }, 401);

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_FILE + 128 * 1024) {
          return json({ error: "Audio segment too large." }, 413);
        }

        const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
        if (!apiKey) return json({ error: "Audio transcription is not configured. Set DEEPGRAM_API_KEY in Vercel." }, 500);

        let form: FormData;
        try {
          const bytes = await readBodyLimited(request, MAX_FILE + 128 * 1024);
          const body = new Blob([bytes as unknown as ArrayBuffer], { type: request.headers.get("content-type") ?? "" });
          const boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body });
          form = await boundedRequest.formData();
        } catch (error) {
          if (error instanceof Error && error.message === "BODY_TOO_LARGE") return json({ error: "Audio segment too large." }, 413);
          return json({ error: "Invalid audio upload." }, 400);
        }

        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX_FILE) {
          return json({ error: "Invalid audio segment." }, 400);
        }

        // The recorder sends PCM WAV. Check the container header instead of trusting
        // the client-supplied filename or MIME type.
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const isWav = header.length === 12 &&
          String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...header.slice(8, 12)) === "WAVE";
        if (!isWav) return json({ error: "Audio must be a valid WAV segment. Please record again." }, 415);

        const supabase = createSupabaseUserClient(token);
        let reservation: UsageReservation;
        try { reservation = await reserveProviderUsage(supabase, "deepgram_asr", file.size); }
        catch (error) {
          if (error instanceof ProviderLimitError) return json({ error: error.message }, 429);
          return json({ error: "Audio usage limits could not be checked. Please try again shortly." }, 503);
        }

        let upstream: Response;
        try {
          upstream = await fetch(DEEPGRAM_URL, {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": "audio/wav",
              Accept: "application/json",
            },
            body: await file.arrayBuffer(),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
          });
        } catch (error) {
          await completeProviderUsage(supabase, reservation, request.signal.aborted ? "cancelled" : "failure").catch(() => undefined);
          if (request.signal.aborted) return new Response(null, { status: 499 });
          if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            return json({ error: "Transcription timed out. Please try the segment again." }, 504);
          }
          return json({ error: "Couldn't connect to Deepgram transcription. Please try again." }, 502);
        }

        if (!upstream.ok) {
          try { await upstream.body?.cancel(); } catch { /* ignore cancellation errors */ }
          await completeProviderUsage(supabase, reservation, "failure").catch(() => undefined);
          const status = upstream.status === 429 ? 429
            : upstream.status === 413 ? 413
            : upstream.status === 400 || upstream.status === 415 ? 422
            : 502;
          return json({ error: safeProviderMessage(upstream.status) }, status);
        }

        let payload: {
          results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        };
        try {
          payload = await upstream.json() as typeof payload;
        } catch {
          await completeProviderUsage(supabase, reservation, "failure").catch(() => undefined);
          return json({ error: "Deepgram returned an unreadable transcription response." }, 502);
        }
        const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!transcript) {
          await completeProviderUsage(supabase, reservation, "failure").catch(() => undefined);
          return json({ error: "No speech was detected in this audio segment." }, 422);
        }
        await completeProviderUsage(supabase, reservation, "success", transcript.length).catch((error) => {
          console.error("[provider-usage] Could not finalize transcription usage:", error instanceof Error ? error.message : "unknown error");
        });
        return sse(transcript);
      },
    },
  },
});
