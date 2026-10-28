import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

// Stay below Vercel Functions’ request-body cap, including multipart overhead.
// The recorder’s 60-second 16 kHz mono WAV segments are about 1.9 MiB.
const MAX_FILE = 4 * 1024 * 1024;
const BYTEZ_URL = "https://api.bytez.com/models/v2";
const BYTEZ_ASR_MODEL = process.env["BYTEZ_ASR_MODEL"]?.trim() || "openai/whisper-large-v3";

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

async function authorized(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return false;
  try {
    return !!(await verifySupabaseAccessToken(token));
  } catch {
    return false;
  }
}

function safeProviderMessage(status: number) {
  if (status === 400 || status === 415) return "Bytez transcription could not read this audio. Try recording again.";
  if (status === 401 || status === 403) return "Bytez rejected the transcription request. Check BYTEZ_API_KEY and model access.";
  if (status === 413) return "This audio segment is too large for transcription.";
  if (status === 429) return "Bytez transcription is busy right now. Please wait a moment and try again.";
  if (status === 402) return "Bytez transcription access or usage limits are unavailable for this model.";
  return "Bytez transcription failed. Please try again in a moment.";
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return json({ error: "Please sign in again." }, 401);

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_FILE + 128 * 1024) {
          return json({ error: "Audio segment too large." }, 413);
        }

        const apiKey = process.env["BYTEZ_API_KEY"]?.trim();
        if (!apiKey) return json({ error: "Bytez is not configured on the server. Set BYTEZ_API_KEY in Vercel." }, 500);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
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

        const audioBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
        let upstream: Response;
        try {
          upstream = await fetch(`${BYTEZ_URL}/${BYTEZ_ASR_MODEL}`, {
            method: "POST",
            headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              audio: `data:audio/wav;base64,${audioBase64}`,
              stream: false,
              params: { language: "en" },
            }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
          });
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            return json({ error: "Bytez transcription timed out. Please try the segment again." }, 504);
          }
          return json({ error: "Couldn't connect to Bytez transcription. Please try again." }, 502);
        }

        if (!upstream.ok) {
          // Read a bounded amount for diagnostics without returning provider internals to the browser.
          try { await upstream.body?.cancel(); } catch { /* ignore cancellation errors */ }
          const status = upstream.status === 429 ? 429
            : upstream.status === 413 ? 413
            : upstream.status === 400 || upstream.status === 415 ? 422
            : 502;
          return json({ error: safeProviderMessage(upstream.status) }, status);
        }

        let payload: { output?: unknown; text?: unknown; error?: unknown };
        try {
          payload = await upstream.json() as { output?: unknown; text?: unknown; error?: unknown };
        } catch {
          return json({ error: "Bytez transcription returned an unreadable response." }, 502);
        }
        if (payload.error) return json({ error: "Bytez could not transcribe this audio. Check the selected model and try again." }, 502);
        let transcript = typeof payload.text === "string" ? payload.text.trim() : typeof payload.output === "string" ? payload.output.trim() : "";
        if (!transcript && Array.isArray(payload.output)) {
          for (const item of payload.output) {
            if (item && typeof item === "object") {
              const record = item as Record<string, unknown>;
              if (typeof record.text === "string") transcript = record.text.trim();
              else if (typeof record.generated_text === "string") transcript = record.generated_text.trim();
              if (transcript) break;
            }
          }
        }
        if (!transcript) return json({ error: "No speech was detected in this audio segment." }, 422);
        return sse(transcript);
      },
    },
  },
});
