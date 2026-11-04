import { supabase } from "@/integrations/supabase/client";

type StreamMessage = { role: "user" | "assistant"; content: string };
type StreamChunk = {
  choices?: Array<{
    delta?: { content?: string | Array<{ text?: string }> };
    finish_reason?: string | null;
  }>;
  error?: { message?: string } | string;
};

/** Streams NVIDIA chat-completion text into the browser without exposing the API key. */
export async function streamAiText(options: {
  system: string;
  messages: StreamMessage[];
  task?: "fast" | "reasoning";
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<string> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error("Couldn't verify your session. Please sign in again.");
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  if (options.signal?.aborted) throw new DOMException("The request was stopped.", "AbortError");

  const response = await fetch("/api/ai-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    body: JSON.stringify({ system: options.system, messages: options.messages, task: options.task ?? "fast" }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `The AI request failed (${response.status}).`);
  }
  if (!response.body) throw new Error("Your browser doesn't support response streaming.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  let finished = false;

  const consumeEvent = (event: string) => {
    const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    if (!dataLines.length) return;
    // Preserve provider token whitespace exactly. Trimming each SSE data frame can
    // silently remove leading/trailing spaces that belong to the generated answer.
    const data = dataLines.map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data.trim()) return;
    if (data.trim() === "[DONE]") { finished = true; return; }
    let payload: StreamChunk;
    try { payload = JSON.parse(data) as StreamChunk; }
    catch { return; } // Ignore non-JSON provider keep-alive frames.
    if (payload.error) {
      const message = typeof payload.error === "string" ? payload.error : payload.error.message;
      throw new Error(message || "The AI provider reported an error.");
    }
    const delta = payload.choices?.[0]?.delta?.content;
    const chunk = typeof delta === "string"
      ? delta
      : Array.isArray(delta) ? delta.map((part) => part.text ?? "").join("") : "";
    if (chunk) { result += chunk; options.onDelta?.(chunk); }
    if (payload.choices?.[0]?.finish_reason) finished = true;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        consumeEvent(event);
        if (finished) break;
      }
    }
    buffer += decoder.decode();
    if (!finished && buffer.trim()) consumeEvent(buffer);
    if (!finished) throw new Error("The AI stream ended before the response was complete. Please try again.");
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!result.trim()) throw new Error("NVIDIA returned an empty response. Please try again.");
  return result;
}


/** Parse a completed streamed JSON payload and run the caller's schema guard. */
export function parseStreamedJson<T>(text: string, validate: (value: unknown) => T): T {
  let parsed: unknown;
  try {
    const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("The AI response wasn't valid JSON. Nothing was saved; please try again.");
  }
  return validate(parsed);
}

/**
 * Stream a JSON response while keeping the UI responsive, then parse and validate
 * the complete payload before callers persist or act on it. Validation is supplied
 * by the feature so each workflow can enforce its own schema.
 */
export async function streamAiJson<T>(options: {
  system: string;
  messages: StreamMessage[];
  task?: "fast" | "reasoning";
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  validate: (value: unknown) => T;
}): Promise<T> {
  const text = await streamAiText({
    system: options.system,
    messages: options.messages,
    ...(options.task ? { task: options.task } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    onDelta: (chunk) => options.onDelta?.(chunk),
  });
  // Permit fenced JSON because some models wrap structured responses despite
  // explicit JSON-only instructions.
  return parseStreamedJson(text, options.validate);
}
