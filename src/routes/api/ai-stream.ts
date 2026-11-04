import { createFileRoute } from "@tanstack/react-router";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

const BASE_URL = "https://integrate.api.nvidia.com/v1";
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

export const Route = createFileRoute("/api/ai-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        if (!token || !(await verifySupabaseAccessToken(token))) {
          return json({ error: "Please sign in again." }, 401);
        }

        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_BODY) return json({ error: "AI request is too large." }, 413);

        let rawBody: string;
        try { rawBody = await request.text(); }
        catch { return json({ error: "Invalid AI request." }, 400); }
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY) {
          return json({ error: "AI request is too large." }, 413);
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

        const apiKey = process.env["NVIDIA_API_KEY"]?.trim();
        if (!apiKey) return json({ error: "NVIDIA AI is not configured. Set NVIDIA_API_KEY in Vercel." }, 500);
        const preferredModel = task === "vision"
          ? process.env["NVIDIA_VISION_MODEL"]?.trim() || "nvidia/nemotron-3.5-super-vl-120b-a12b"
          : task === "reasoning"
          ? process.env["NVIDIA_REASONING_MODEL"]?.trim() || "nvidia/nemotron-3-ultra-550b-a55b"
          : process.env["NVIDIA_MODEL"]?.trim() || "nvidia/nemotron-3.5-lightning-30b-a3b";
        const fallbackModels = task === "vision" ? [] : (process.env["NVIDIA_FALLBACK_MODELS"] ?? "stepfun-ai/step-3.5-flash")
          .split(",").map((item) => item.trim()).filter(Boolean);
        const models = [...new Set([preferredModel, ...(task === "vision" ? [] : [process.env["NVIDIA_MODEL"]?.trim(), ...fallbackModels])].filter(Boolean))] as string[];
        let upstream: Response | null = null;
        let lastError = "Couldn't connect to NVIDIA. Please try again.";
        for (let index = 0; index < models.length; index += 1) {
          const model = models[index]!;
          try {
            const candidate = await fetch(`${BASE_URL}/chat/completions`, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
              body: JSON.stringify({
                model,
                messages: [{ role: "system", content: system }, ...messages],
                temperature: 0.2,
                max_tokens: body.jsonMode === true ? 8192 : 6000,
                ...(body.jsonMode === true ? { response_format: { type: "json_object" } } : {}),
                stream: true,
                ...(model.startsWith("nvidia/nemotron-3") ? { chat_template_kwargs: { enable_thinking: model.includes("ultra") } } : {}),
              }),
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
            });
            if (candidate.ok && candidate.body) { upstream = candidate; break; }
            const detail = (await candidate.text().catch(() => "")).slice(0, 400);
            lastError = candidate.status === 401 || candidate.status === 403
              ? "NVIDIA rejected the API key or model access."
              : candidate.status === 402 ? "NVIDIA API access or usage limits are unavailable for this model."
              : candidate.status === 429 ? "NVIDIA is busy. Wait a moment and try again."
              : `NVIDIA streaming request failed${detail ? `: ${detail}` : ` (${candidate.status}).`}`;
            const retryable = [400, 403, 404, 408, 429].includes(candidate.status) || candidate.status >= 500;
            if (!retryable || index === models.length - 1) return json({ error: lastError }, candidate.status >= 400 && candidate.status < 600 ? candidate.status : 502);
          } catch (error) {
            if (request.signal.aborted) return json({ error: "The AI request was cancelled." }, 499);
            lastError = error instanceof Error && error.name === "TimeoutError"
              ? "The NVIDIA request timed out. Try a shorter response or smaller source document."
              : "Couldn't connect to NVIDIA. Please try again.";
            if (index === models.length - 1) return json({ error: lastError }, 502);
          }
        }
        if (!upstream?.body) return json({ error: lastError }, 502);

        // Forward provider SSE bytes without buffering so the browser can render tokens immediately.
        return new Response(upstream.body, {
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
