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
  jsonMode?: boolean;
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
    body: JSON.stringify({ system: options.system, messages: options.messages, task: options.task ?? "fast", jsonMode: options.jsonMode === true }),
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
  let finishReason: string | null = null;

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
    if (payload.choices?.[0]?.finish_reason) {
      finishReason = payload.choices?.[0]?.finish_reason ?? null;
      finished = true;
    }
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

  if (finishReason === "length") {
    throw new Error("The AI response reached its output limit before it could finish. Try a smaller document or try again.");
  }
  if (!result.trim()) throw new Error("NVIDIA returned an empty response. Please try again.");
  return result;
}


/** Parse a completed streamed JSON payload and run the caller's schema guard. */
function extractJsonPayload(text: string): string {
  const normalized = text.trim()
    .replace(/^\uFEFF/, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Prefer a complete top-level JSON object/array even if the model adds a
  // short preamble or trailing commentary outside the structured response.
  const firstObject = normalized.indexOf("{");
  const firstArray = normalized.indexOf("[");
  const starts = [firstObject, firstArray].filter((index) => index >= 0);
  if (!starts.length) return normalized;
  const start = Math.min(...starts);
  const opener = normalized[start]!;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < normalized.length; i += 1) {
    const char = normalized[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return normalized.slice(start, i + 1);
    }
  }
  return normalized.slice(start);
}

export function parseStreamedJson<T>(text: string, validate: (value: unknown) => T): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(text));
  } catch {
    throw new Error("The AI returned incomplete or malformed structured data. Nothing was saved; please try again.");
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
    system: `${options.system}\n\nOUTPUT REQUIREMENT: Return a complete, syntactically valid JSON value only. Do not include markdown fences, commentary, or reasoning outside the JSON.`,
    messages: options.messages,
    ...(options.task ? { task: options.task } : {}),
    jsonMode: true,
    ...(options.signal ? { signal: options.signal } : {}),
    onDelta: (chunk) => options.onDelta?.(chunk),
  });
  // Permit fenced JSON because some models wrap structured responses despite
  // explicit JSON-only instructions.
  return parseStreamedJson(text, options.validate);
}

/** Complete the lecture-first notes pipeline in the browser, including optional-reading enrichment. */
export async function streamPreparedNotes(options: {
  prepared: {
    notesPrompts: { system: string; messages: StreamMessage[] }[];
    notesHeader?: string;
    readingPlan?: {
      readingChunks: string[];
      readingSystemPrefix: string;
      readingSystemSuffix: string;
      finalSystem: string;
    };
  };
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onDelta?: (chunk: string) => void;
}): Promise<string> {
  const { prepared, signal, onProgress, onDelta } = options;
  const noteParts: string[] = [];
  for (let i = 0; i < prepared.notesPrompts.length; i += 1) {
    const prompt = prepared.notesPrompts[i]!;
    onProgress?.(`Generating lecture notes (${i + 1}/${prepared.notesPrompts.length})…`);
    const part = await streamAiText({ system: prompt.system, messages: prompt.messages, signal, onDelta });
    noteParts.push(part.trim());
  }
  let notes = prepared.notesHeader
    ? `${prepared.notesHeader}\n\n${noteParts.join("\n\n---\n\n")}`
    : noteParts[0] ?? "";

  if (prepared.readingPlan) {
    const plan = prepared.readingPlan;
    const additions: string[] = [];
    for (let i = 0; i < plan.readingChunks.length; i += 1) {
      onProgress?.(`Comparing optional reading (${i + 1}/${plan.readingChunks.length})…`);
      const result = await streamAiText({
        system: `${plan.readingSystemPrefix}${notes.slice(0, 18000)}${plan.readingSystemSuffix}`,
        messages: [{ role: "user", content: `OPTIONAL READING PART ${i + 1}/${plan.readingChunks.length}:\n${plan.readingChunks[i]}` }],
        signal,
        onDelta,
      });
      const clean = result.trim();
      if (clean && !/^NO RELEVANT NEW ADDITIONS\.?$/i.test(clean)) additions.push(clean);
    }
    onProgress?.("Integrating reading additions into the lecture notes…");
    notes = await streamAiText({
      system: plan.finalSystem,
      messages: [{ role: "user", content: `EXISTING LECTURE NOTES:\n${notes.slice(0, 36000)}\n\nREADING ENRICHMENT CANDIDATES (some may overlap; deduplicate carefully):\n${additions.length ? additions.join("\n\n").slice(0, 20000) : "No useful new reading additions were identified. Preserve the lecture notes, clean up any repeated chunk headings if possible, and add one concise Key Takeaways section."}` }],
      signal,
      onDelta,
    });
  }
  if (!notes.trim()) throw new Error("The notes stream returned no content.");
  return notes;
}
