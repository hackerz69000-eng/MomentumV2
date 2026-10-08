import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

const MODEL = "nova-3";
const MAX_FILE = 13 * 1024 * 1024;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function authorized(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  try {
    return !!(await verifySupabaseAccessToken(token));
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return json({ error: "Please sign in again." }, 401);
        const len = Number(request.headers.get("content-length") ?? 0);
        if (len > MAX_FILE + 64 * 1024) return json({ error: "Audio segment too large." }, 413);
        const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
        if (!apiKey) return json({ error: "Transcription is not configured. Add DEEPGRAM_API_KEY." }, 500);

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX_FILE) {
          return json({ error: "Invalid audio segment." }, 400);
        }

        try {
          const upstream = await fetch(
            `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(MODEL)}&smart_format=true&punctuate=true&utterances=true`,
            {
              method: "POST",
              headers: {
                Authorization: `Token ${apiKey}`,
                "Content-Type": file.type || "audio/wav",
              },
              body: file,
              signal: request.signal,
            },
          );

          if (!upstream.ok) {
            const body = await upstream.text();
            const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status;
            return json({ error: `Transcription failed: ${body.slice(0, 500)}` }, status);
          }

          const result = (await upstream.json()) as {
            results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
          };
          const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (!transcript) return json({ error: "The audio ended without any speech to transcribe." }, 422);
          return json({ text: transcript }, 200);
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return json({ error: e instanceof Error ? e.message : "Transcription failed." }, 502);
        }
      },
    },
  },
});
