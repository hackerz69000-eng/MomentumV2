const BYTEZ_MODEL = process.env["BYTEZ_MODEL"]?.trim() || "microsoft/Phi-3-mini-4k-instruct";
const BYTEZ_URL = "https://api.bytez.com/models/v2";

type ModelMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

class BytezError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "BytezError";
    this.statusCode = statusCode;
  }
}

function providerDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string; detail?: string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
    if (parsed.detail) return parsed.detail;
  } catch {
    // Keep raw response when the provider does not return JSON.
  }
  return body.trim();
}

function bytezErrorMessage(status: number, body: string): string {
  const detail = providerDetail(body).slice(0, 800);
  if (status === 401 || status === 403) return "Bytez rejected the API key or model access. Check BYTEZ_API_KEY and the selected model in Bytez, then redeploy.";
  if (status === 402) return "Bytez needs more credits or this model is not available on your current plan. Check your Bytez dashboard.";
  if (status === 429) return "Bytez is rate-limiting requests. Wait a little and try again; avoid generating multiple quizzes at once.";
  if (status === 413) return "The AI request is too large. Try fewer questions or a smaller source document.";
  return `Bytez request failed${detail ? `: ${detail}` : ` (HTTP ${status}).`}`;
}

function extractText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (typeof record.generated_text === "string" && record.generated_text.trim()) return record.generated_text.trim();
        if (Array.isArray(record.generated_text)) {
          const messages = record.generated_text as Array<Record<string, unknown>>;
          const last = [...messages].reverse().find((message) => message.role === "assistant" && typeof message.content === "string");
          if (typeof last?.content === "string" && last.content.trim()) return last.content.trim();
        }
        if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
      }
    }
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.generated_text === "string") return record.generated_text.trim();
    if (Array.isArray(record.generated_text)) {
      const messages = record.generated_text as Array<Record<string, unknown>>;
      const last = [...messages].reverse().find((message) => message.role === "assistant" && typeof message.content === "string");
      if (typeof last?.content === "string" && last.content.trim()) return last.content.trim();
    }
    if (typeof record.text === "string") return record.text.trim();
    if (typeof record.content === "string") return record.content.trim();
  }
  return "";
}

async function callBytez(
  system: string,
  messages: ModelMessage[],
  timeoutMs = 90_000,
  model = BYTEZ_MODEL,
): Promise<string> {
  const apiKey = process.env["BYTEZ_API_KEY"]?.trim();
  if (!apiKey) throw new BytezError("Bytez is not configured on the server. Set BYTEZ_API_KEY in Vercel, then redeploy.");

  let response: Response;
  try {
    response = await fetch(`${BYTEZ_URL}/${model}`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        stream: false,
        params: { temperature: 0.2, max_length: 6000 },
      }),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new BytezError(timedOut
      ? "The Bytez request timed out. Try fewer questions or a shorter response."
      : "Couldn't connect to Bytez. Check the server connection and try again.", timedOut ? 408 : undefined);
  }

  let body: string;
  try { body = await response.text(); }
  catch { throw new BytezError("Bytez returned an unreadable response.", 502); }
  if (!response.ok) throw new BytezError(bytezErrorMessage(response.status, body), response.status);

  let payload: { output?: unknown; error?: unknown };
  try { payload = JSON.parse(body) as { output?: unknown; error?: unknown }; }
  catch { throw new BytezError("Bytez returned an invalid response.", 502); }
  if (payload.error) throw new BytezError(typeof payload.error === "string" ? payload.error : "Bytez reported an inference error.", 502);
  const text = extractText(payload.output);
  if (!text) throw new BytezError("Bytez returned an empty or unrecognized response. Check that the selected model supports chat messages.", 502);
  return text;
}

/** Appended to every AI system prompt: the student's materials are the primary source. */
export const GROUNDING = `

SOURCE GROUNDING (always applies when study material, lecture transcripts, notes, sources or student writing are provided):
- Treat the student's provided materials as the PRIMARY source.
- Never invent facts, definitions, quotes, examples, statistics or citations and present them as coming from the materials.
- If the requested information is not in the materials, say plainly: "I couldn't find this in your study materials."
- You may add helpful general context, but label it clearly as "General background (not from your materials)".
- When useful, point to where something came from.
- Never fabricate a citation, page number, author or quote.
- Stay helpful while keeping outside knowledge separate from the student's materials.

QUALITY RULES:
- Follow the student's custom set instructions, requested difficulty and education level.
- Be concise and avoid generic filler.
- Use the same terminology the materials use.
- Generated questions must have exactly one defensible correct answer.
- Distractors should be plausible but clearly wrong.
- Avoid trick questions unless requested.
- Avoid duplicate questions.
- Focus on important testable ideas rather than trivia.
`;

export async function aiText(
  system: string,
  messages: ModelMessage[],
  opts: { grounded?: boolean; retries?: number; timeoutMs?: number; model?: string } = {},
): Promise<string> {
  if (opts.grounded !== false) system += GROUNDING;

  // A bounded retry policy helps with provider/network instability without
  // multiplying requests indefinitely or retrying credential/configuration errors.
  const delays = [1200, 3000];
  const retryCount = Math.max(0, Math.min(delays.length, opts.retries ?? delays.length));
  const timeoutMs = Math.max(1000, Math.min(90_000, opts.timeoutMs ?? 90_000));
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await callBytez(system, messages, timeoutMs, opts.model?.trim() || BYTEZ_MODEL);
    } catch (error) {
      lastError = error;
      // Retry transient failures and rate limits only; never retry auth, credit, or model errors.
      const status = error instanceof BytezError ? error.statusCode : undefined;
      const retryable = status === 408 || status === 429 || (typeof status === "number" && status >= 500) ||
        (error instanceof BytezError && /invalid response|empty or unrecognized|unreadable response|couldn't connect/i.test(error.message));
      if (!retryable || attempt === retryCount) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Bytez request failed. Please try again.");
}

/** Call a Bytez vision model using its documented text + base64 multi-input schema. */
export async function aiImage(system: string, prompt: string, base64Image: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<string> {
  const apiKey = process.env["BYTEZ_API_KEY"]?.trim();
  if (!apiKey) throw new BytezError("Bytez is not configured on the server. Set BYTEZ_API_KEY in Vercel, then redeploy.");
  const model = opts.model?.trim() || process.env["BYTEZ_VISION_MODEL"]?.trim() || "Qwen/Qwen2.5-VL-7B-Instruct";
  let response: Response;
  try {
    response = await fetch(`${BYTEZ_URL}/${model}`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(1000, Math.min(90_000, opts.timeoutMs ?? 90_000))),
      body: JSON.stringify({ text: `${system}\n\n${prompt}`, base64: base64Image, stream: false, params: { temperature: 0.2, max_length: 6000 } }),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new BytezError(timedOut ? "The Bytez vision request timed out. Try a smaller image." : "Couldn't connect to Bytez vision. Please try again.", timedOut ? 408 : undefined);
  }
  const body = await response.text();
  if (!response.ok) throw new BytezError(bytezErrorMessage(response.status, body), response.status);
  let payload: { output?: unknown; error?: unknown };
  try { payload = JSON.parse(body) as { output?: unknown; error?: unknown }; }
  catch { throw new BytezError("Bytez vision returned an invalid response.", 502); }
  if (payload.error) throw new BytezError(typeof payload.error === "string" ? payload.error : "Bytez vision inference failed.", 502);
  const text = extractText(payload.output);
  if (!text) throw new BytezError("Bytez vision returned an empty response. Check that the selected model supports image inputs.", 502);
  return text;
}

/** Parse a complete JSON object/array from an AI response, tolerating fences and stray prose. */
export function parseJson<T>(text: string): T {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The AI response was empty. Please try again.");
  }
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  // Some models prepend bracketed labels such as [JSON] before the actual object.
  // Try each possible root instead of failing permanently on the first brace/bracket.
  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== "{" && cleaned[start] !== "[") continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") {
        const last = stack.pop();
        if ((ch === "}" && last !== "{") || (ch === "]" && last !== "[")) break;
        if (stack.length === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1)) as T;
          } catch {
            // Continue scanning: an earlier bracketed phrase may not be JSON.
            break;
          }
        }
      }
    }
  }
  throw new Error("Could not read the AI response as complete JSON. It may be malformed or truncated; please retry.");
}

export function clip(material: string, max = 60000) {
  return material.length > max ? material.slice(0, max) + "\n\n[...material truncated]" : material;
}

/** Split long extracted documents at paragraph/line boundaries without dropping later content. */
export function splitTextIntoChunks(material: string, maxChars = 16000): string[] {
  const text = material.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const chunks: string[] = [];
  const safeMax = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : 16000;
  let current = "";
  const blocks = text.split(/\n\s*\n/); // prefer paragraph boundaries; further split oversized blocks below
  for (const block of blocks) {
    const part = block.trim();
    if (!part) continue;
    if (part.length > safeMax) {
      if (current.trim()) { chunks.push(current.trim()); current = ""; }
      for (let i = 0; i < part.length; i += safeMax) chunks.push(part.slice(i, i + safeMax));
      continue;
    }
    if (current.length && current.length + part.length + 2 > safeMax) {
      chunks.push(current.trim());
      current = part;
    } else current += `${current ? "\n\n" : ""}${part}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
