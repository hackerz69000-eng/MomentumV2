const GEMINI_MODEL = "gemini-3.8-flash";

class GeminiError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GeminiError";
    this.statusCode = statusCode;
  }
}

function geminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown Gemini error");
  const message = raw.trim();
  if (/api key|api_key|authentication|unauthenticated|401/i.test(message)) {
    return "Gemini rejected the API key. Check GEMINI_API_KEY in your Vercel environment variables and redeploy.";
  }
  if (/quota|rate.?limit|429|resource exhausted/i.test(message)) {
    return "Gemini rate limit or quota reached. Please wait and try again.";
  }
  if (/permission|403|forbidden/i.test(message)) {
    return `Gemini denied the request${message ? `: ${message}` : "."}`;
  }
  return `Gemini request failed${message ? `: ${message}` : ". Please try again."}`;
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

async function callGemini(system: string, messages: ModelMessage[]): Promise<string> {
  const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!geminiKey) {
    throw new GeminiError(
      "Gemini is not configured on the server. Set GEMINI_API_KEY in the Vercel environment variables, then redeploy.",
    );
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const userPrompt = messages.map((m) => `${m.content}`).join("\n\n");
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: system,
      },
    });
    const text = response.text?.trim();
    if (!text) throw new GeminiError("Gemini returned an empty response.");
    return text;
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    console.error("Gemini request failed", err);
    throw new GeminiError(geminiErrorMessage(err));
  }
}

async function aiTextOnce(system: string, messages: ModelMessage[]): Promise<string> {
  return callGemini(system, messages);
}

function retryable(err: unknown) {
  const status = err instanceof GeminiError ? err.statusCode : undefined;
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
