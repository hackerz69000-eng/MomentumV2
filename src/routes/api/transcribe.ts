import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

const MODEL = "google/gemini-3.5-transcribe";
const MAX_FILE = 13 * 1024 * 1024; // model cap is 14 MB

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
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return json({ error: "Transcription is not configured." }, 500);
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX_FILE)
          return json({ error: "Invalid audio segment." }, 400);
        const out = new FormData();
        out.append("model", MODEL);
        out.append("file", new File([file], file.name || "segment.wav", { type: "audio/wav" }));
        out.append("response_format", "json");
        out.append("stream", "true");
        try {
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
            body: out,
            signal: request.signal,
          });
          const headers = new Headers({
            "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
            "Cache-Control": "no-cache",
          });
          upstream.headers.forEach((v, k) => {
            if (k.toLowerCase().startsWith("x-lovable-aig-")) headers.set(k, v);
          });
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch (e) {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return json({ error: "Transcription failed." }, 502);
        }
      },
    },
  },
});
