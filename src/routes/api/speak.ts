import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

const MAX_TEXT_CHARS = 4000;
const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3";

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return json({ error: "Please sign in again." }, 401);
        const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
        if (!apiKey) return json({ error: "Text-to-speech is not configured. Set DEEPGRAM_API_KEY in Vercel." }, 500);

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
          return json({ error: "Speech request is too large." }, 413);
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid speech request." }, 400);
        }
        const text = payload && typeof payload === "object" && "text" in payload && typeof payload.text === "string"
          ? payload.text.trim()
          : "";
        if (!text || text.length > MAX_TEXT_CHARS) {
          return json({ error: `Speech text must contain between 1 and ${MAX_TEXT_CHARS} characters.` }, 400);
        }

        let upstream: Response;
        try {
          upstream = await fetch(DEEPGRAM_SPEAK_URL, {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({ text }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
          });
        } catch (error) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            return json({ error: "Speech generation timed out. Please try again." }, 504);
          }
          return json({ error: "Couldn't connect to text-to-speech. Please try again." }, 502);
        }

        if (!upstream.ok) {
          const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 422 : 502;
          try { await upstream.body?.cancel(); } catch { /* ignore cancellation errors */ }
          return json({
            error: upstream.status === 401 || upstream.status === 403
              ? "Deepgram rejected the API key. Check DEEPGRAM_API_KEY in Vercel."
              : upstream.status === 429
                ? "Speech generation is busy right now. Please wait a moment and try again."
                : "Deepgram couldn't generate speech for this text. Please try again.",
          }, status);
        }

        const contentType = upstream.headers.get("content-type")?.split(";")[0];
        if (contentType !== "audio/mpeg" || !upstream.body) {
          try { await upstream.body?.cancel(); } catch { /* ignore cancellation errors */ }
          return json({ error: "Text-to-speech returned an unreadable audio response." }, 502);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
