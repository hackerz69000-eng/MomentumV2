const GROQ_MODEL = process.env["GROQ_MODEL"]?.trim() || "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

type ModelMessage = {
  role: "user" | "assistant";
  // The OCR flow sends multimodal file/image content; other AI tools send plain text.
  content: string | Array<Record<string, unknown>>;
};

class GroqError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GroqError";
    this.statusCode = statusCode;
  }
}

function groqErrorMessage(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // Keep the raw response when Groq does not return JSON.
  }

  if (status === 401) {
    return "Groq rejected the API key. Check GROQ_API_KEY in your Vercel environment variables and redeploy.";
  }
  if (status === 402) {
    return "Groq rejected the request because access or billing may be unavailable for this model. Check your Groq Console model access and usage limits.";
  }
  if (status === 403) {
    return `Groq denied the request${detail ? `: ${detail.slice(0, 1000)}` : "."}`;
  }
  if (status === 429) {
    return "Groq rate limit reached. Please wait a moment and try again.";
  }
  return `Groq request failed${detail ? `: ${detail.slice(0, 1000)}` : ` (HTTP ${status}).`}`;
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

async function callGroq(system: string, messages: ModelMessage[], timeoutMs = 90_000, model = GROQ_MODEL): Promise<string> {
  const apiKey = process.env["GROQ_API_KEY"]?.trim();
  if (!apiKey) {
    throw new GroqError(
      "Groq is not configured on the server. Set GROQ_API_KEY in the Vercel environment variables, then redeploy.",
    );
  }

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Bound provider latency, but leave enough time for larger study tasks.
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 6000,
        stream: false,
        messages: [
          { role: "system", content: system },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
      }),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    // Normalize fetch failures so the retry policy handles timeouts and transient network errors.
    throw new GroqError(
      timedOut
        ? "The AI request timed out. Please try again, or request a smaller response."
        : "Couldn't connect to Groq. Check the server connection and try again.",
      timedOut ? 408 : undefined,
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new GroqError("Groq returned an unreadable response.", 502);
  }
  if (!response.ok) {
    throw new GroqError(groqErrorMessage(response.status, body), response.status);
  }

  let payload: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
  try {
    payload = JSON.parse(body) as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
  } catch {
    throw new GroqError("Groq returned an invalid response.", 502);
  }

  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new GroqError("The AI response reached its output limit. Please request fewer questions or a shorter response.", 413);
  }
  const text = choice?.message?.content?.trim();
  if (!text) throw new GroqError("Groq returned an empty response.", 502);
  return text;
}

function retryable(err: unknown) {
  if (!(err instanceof GroqError)) return false;
  const status = err.statusCode;
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500) ||
    /returned an invalid response|returned an empty response|unreadable response|couldn't connect/i.test(err.message);
}

export async function aiText(
  system: string,
  messages: ModelMessage[],
  opts: { grounded?: boolean; retries?: number; timeoutMs?: number; model?: string } = {},
): Promise<string> {
  if (opts.grounded !== false) system += GROUNDING;

  // A bounded retry policy helps with provider/network instability without
  // multiplying requests indefinitely or retrying credential/configuration errors.
  const delays = [800, 1800];
  const retryCount = Math.max(0, Math.min(delays.length, opts.retries ?? delays.length));
  const timeoutMs = Math.max(1000, Math.min(90_000, opts.timeoutMs ?? 90_000));
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await callGroq(system, messages, timeoutMs, opts.model?.trim() || GROQ_MODEL);
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === retryCount) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Groq request failed. Please try again.");
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
