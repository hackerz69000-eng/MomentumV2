import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseUserClient, verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";
import { nvidiaModels, openNvidiaStream } from "@/lib/ai.server";
import { completeProviderUsage, meterProviderStream, ProviderLimitError, reserveProviderUsage } from "@/lib/provider-usage.server";

const MAX_BODY = 8_000_000;
const MAX_MESSAGES = 24;
const MAX_CONTENT = 160_000;

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "user" | "assistant"; content: string | ContentPart[] };

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally { reader.releaseLock(); }
  return chunks.join("");
}

export const Route = createFileRoute("/api/ai-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        let user: Awaited<ReturnType<typeof verifySupabaseAccessToken>> = null;
        try { user = token ? await verifySupabaseAccessToken(token) : null; }
        catch { return json({ error: "Please sign in again." }, 401); }
        if (!token || !user) {
          return json({ error: "Please sign in again." }, 401);
        }

        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_BODY) return json({ error: "AI request is too large." }, 413);

        let rawBody: string;
        try { rawBody = await readBodyLimited(request, MAX_BODY); }
        catch (error) {
          if (error instanceof Error && error.message === "BODY_TOO_LARGE") return json({ error: "AI request is too large." }, 413);
          return json({ error: "Invalid AI request." }, 400);
        }
        let body: { system?: unknown; messages?: unknown; task?: unknown; jsonMode?: unknown };
        try { body = JSON.parse(rawBody) as typeof body; }
        catch { return json({ error: "Invalid AI request." }, 400); }

        const system = typeof body.system === "string" ? body.system.trim() : "";
        const messages = Array.isArray(body.messages) ? body.messages as Message[] : [];
        const task = body.task === "vision" ? "vision" : body.task === "reasoning" ? "reasoning" : body.task === "fast" || body.task == null ? "fast" : null;
        const contentText = (content: Message["content"]) => typeof content === "string" ? content : JSON.stringify(content) ?? "";
        const totalContent = system.length + messages.reduce((sum, message) => sum + (message?.content ? contentText(message.content).length : 0), 0);
        const validContent = (content: unknown) => {
          if (typeof content === "string") return Boolean(content.trim()) && content.length <= MAX_CONTENT;
          if (!Array.isArray(content) || !content.length || content.length > 4) return false;
          let images = 0;
          return content.every((part) => {
            if (part?.type === "text") return typeof part.text === "string" && part.text.length <= MAX_CONTENT;
            if (part?.type === "image_url" && typeof part.image_url?.url === "string" && part.image_url.url.startsWith("data:image/jpeg;base64,")) {
              images += 1;
              return part.image_url.url.length <= 3_000_000;
            }
            return false;
          }) && images > 0 && images <= 3;
        };
        if (!task || !system || system.length > MAX_CONTENT || !messages.length || messages.length > MAX_MESSAGES ||
          totalContent > MAX_BODY ||
          messages.some((m) => !m || !["user", "assistant"].includes(m.role) || !validContent(m.content)) ||
          (task === "vision" && !messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")))) {
          return json({ error: "The AI prompt or conversation is invalid or too large." }, 400);
        }

        if (!process.env["NVIDIA_API_KEY"]?.trim()) return json({ error: "NVIDIA AI is not configured. Set NVIDIA_API_KEY in Vercel." }, 500);
        const supabase = createSupabaseUserClient(token);
        const models = nvidiaModels(task);
        let upstream: Response | null = null;
        let reservation: Awaited<ReturnType<typeof reserveProviderUsage>> | null = null;
        let lastStatus = 502;
        for (let index = 0; index < models.length; index += 1) {
          const model = models[index]!;
          try {
            // Each attempted model consumes quota: fallback calls can also incur provider cost.
            reservation = await reserveProviderUsage(supabase, "nvidia", totalContent);
          } catch (error) {
            if (error instanceof ProviderLimitError) return json({ error: error.message }, 429);
            return json({ error: "AI usage limits could not be checked. Please try again shortly." }, 503);
          }
          try {
            const candidate = await openNvidiaStream(system, messages, {
              model, signal: request.signal, jsonMode: body.jsonMode === true,
              maxTokens: body.jsonMode === true ? 8192 : 6000,
            });
            if (candidate.ok && candidate.body) { upstream = candidate; break; }
            lastStatus = candidate.status;
            await candidate.body?.cancel().catch(() => undefined);
            await completeProviderUsage(supabase, reservation, "failure");
            reservation = null;
            const retryable = [400, 403, 404, 408, 429].includes(candidate.status) || candidate.status >= 500;
            if (!retryable || index === models.length - 1) {
              const message = candidate.status === 401 || candidate.status === 403 ? "NVIDIA rejected the API key or model access."
                : candidate.status === 402 ? "NVIDIA API access or usage limits are unavailable for this model."
                : candidate.status === 429 ? "NVIDIA is busy. Wait a moment and try again."
                : "NVIDIA couldn't complete the AI request. Please try again.";
              return json({ error: message }, candidate.status >= 400 && candidate.status < 600 ? candidate.status : 502);
            }
          } catch (error) {
            lastStatus = request.signal.aborted ? 499 : 502;
            try { if (reservation) await completeProviderUsage(supabase, reservation, request.signal.aborted ? "cancelled" : "failure"); }
            catch { return json({ error: "The AI request ran, but its usage could not be finalized. Wait a moment before retrying." }, 503); }
            reservation = null;
            if (request.signal.aborted) return json({ error: "The AI request was cancelled." }, 499);
            if (index === models.length - 1) return json({ error: error instanceof Error ? error.message : "Couldn't connect to NVIDIA. Please try again." }, lastStatus);
          }
        }
        if (!upstream?.body || !reservation) return json({ error: "Couldn't connect to NVIDIA. Please try again." }, lastStatus);

        // Metering wraps the byte stream without buffering, preserving immediate token delivery.
        return new Response(meterProviderStream(supabase, upstream.body, reservation), {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            "x-content-type-options": "nosniff",
            "vary": "Authorization",
          },
        });
      },
    },
  },
});
