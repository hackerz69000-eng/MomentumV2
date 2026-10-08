import type { ModelMessage } from "ai";

const MODEL = "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

class OpenRouterError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.statusCode = statusCode;
  }
}

function providerErrorMessage(status: number, detail: string) {
  const clean = detail.trim();
  if (status === 401) return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel.";
  if (status === 402)
    return "OpenRouter needs credits for this request. Add credits or use an available free model.";
  if (status === 403) return `OpenRouter denied the request${clean ? `: ${clean}` : "."}`;
  if (status === 404)
    return `OpenRouter could not find the requested model/router${clean ? `: ${clean}` : "."}`;
  if (status === 429)
    return `OpenRouter rate-limited the request${clean ? `: ${clean}` : ". Please try again in a minute."}`;
  if (status >= 500)
    return `OpenRouter returned a server error (${status})${clean ? `: ${clean}` : ". Please try again."}`;
  return `OpenRouter rejected the request (${status})${clean ? `: ${clean}` : "."}`;
}

function extractErrorDetail(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { error?: unknown; message?: unknown };
  if (typeof p.message === "string") return p.message;
  if (p.error && typeof p.error === "object") {
    const e = p.error as { message?: unknown; code?: unknown };
    if (typeof e.message === "string") {
      return typeof e.code === "string" ? `${e.message} (code ${e.code})` : e.message;
    }
  }
  return "";
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

async function callGemini(system: string, messages: ModelMessage[]): Promise<string | null> {
  const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!geminiKey) return null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: {
        headers: { "User-Agent": "aistudio-build" },
      },
    });
    const userPrompt = messages.map((m) => `${m.content}`).join("\n\n");
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: userPrompt,
      config: {
        systemInstruction: system,
      },
    });
    const text = response.text?.trim();
    return text || null;
  } catch (err) {
    console.warn("Gemini API call returned error, checking OpenRouter:", err);
    return null;
  }
}

async function aiTextOnce(system: string, messages: ModelMessage[]): Promise<string> {
  const geminiRes = await callGemini(system, messages);
  if (geminiRes) return geminiRes;

  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();

  if (!apiKey) {
    throw new Error(
      "AI is not configured on the server. Please set GEMINI_API_KEY or OPENROUTER_API_KEY.",
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://momentum.vercel.app",
      "X-Title": "Momentum",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }

  if (!response.ok) {
    const detail = extractErrorDetail(payload);
    console.error("OpenRouter request failed", { status: response.status, detail });
    throw new OpenRouterError(providerErrorMessage(response.status, detail), response.status);
  }

  const choice = (
    payload as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
    }
  )?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    console.error("OpenRouter returned no text", payload);
    throw new Error("OpenRouter returned an empty response. Please try again.");
  }

  if (choice?.finish_reason === "length") {
    throw new Error("The AI response was cut off before it finished. Please try again.");
  }

  return content;
}

function retryable(err: unknown) {
  const status = err instanceof OpenRouterError ? err.statusCode : undefined;
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function aiText(
  system: string,
  messages: ModelMessage[],
  opts: { grounded?: boolean } = {},
): Promise<string> {
  if (opts.grounded !== false) system += GROUNDING;

  try {
    return await aiTextOnce(system, messages);
  } catch (e) {
    if (!retryable(e)) throw e instanceof Error ? e : new Error("AI request failed.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return aiTextOnce(system, messages);
  }
}

export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error("Could not read the AI response. Please try again.");

  let end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  while (end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      const prev = Math.max(cleaned.lastIndexOf("}", end - 1), cleaned.lastIndexOf("]", end - 1));
      if (prev <= start) break;
      end = prev;
    }
  }

  throw new Error("Could not read the AI response. Please try again.");
}

export function clip(material: string, max = 60000) {
  return material.length > max ? material.slice(0, max) + "\n\n[...material truncated]" : material;
}
