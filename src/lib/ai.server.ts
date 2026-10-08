const GROQ_MODEL = process.env["GROQ_MODEL"]?.trim() || "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

class GroqError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GroqError";
    this.statusCode = statusCode;
  }
}

function groqErrorMessage(status: number, detail: string): string {
  if (status === 401) {
    return "Groq rejected the API key. Check GROQ_API_KEY in your Vercel environment variables and redeploy.";
  }
  if (status === 403) {
    return `Groq denied the request${detail ? `: ${detail}` : "."}`;
  }
  if (status === 429) {
    return "Groq rate limit reached. Please wait a moment and try again.";
  }
  return `Groq request failed${detail ? `: ${detail}` : ". Please try again."}`;
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

async function callGroq(system: string, messages: ModelMessage[]): Promise<string> {
  const groqKey = process.env["GROQ_API_KEY"]?.trim();
  if (!groqKey) {
    throw new GroqError(
      "Groq is not configured on the server. Set GROQ_API_KEY in the Vercel environment variables, then redeploy.",
    );
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      ],
      temperature: 0.2,
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.error?.message || raw || `HTTP ${response.status}`;
    throw new GroqError(groqErrorMessage(response.status, detail), response.status);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GroqError("Groq returned an empty response.");
  return text;
}

async function aiTextOnce(system: string, messages: ModelMessage[]): Promise<string> {
  return callGroq(system, messages);
}

function retryable(err: unknown) {
  const status = err instanceof GroqError ? err.statusCode : undefined;
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
    await new Promise((resolve) => setTimeout(resolve, 1500));
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
