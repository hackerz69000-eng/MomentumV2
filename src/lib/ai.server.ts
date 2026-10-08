const MISTRAL_MODEL = "mistral-small-latest";

type ModelMessage = { role: "user" | "assistant"; content: string };
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

class MistralError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "MistralError";
    this.statusCode = statusCode;
  }
}

function mistralErrorMessage(status: number, body: string): string {
  const message = body.trim();
  if (status === 401) {
    return "Mistral rejected the API key. Check MISTRAL_API_KEY in your Vercel environment variables and redeploy.";
  }
  if (status === 402) {
    return "Mistral requires billing for this request. Check your Mistral Studio plan and usage limits.";
  }
  if (status === 429) {
    return "Mistral rate limit reached. Please wait a moment and try again.";
  }
  return `Mistral request failed${message ? `: ${message.slice(0, 1000)}` : ` (HTTP ${status}).`}`;
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

async function callMistral(system: string, messages: ModelMessage[]): Promise<string> {
  const mistralKey = process.env["MISTRAL_API_KEY"]?.trim();
  if (!mistralKey) {
    throw new MistralError(
      "Mistral is not configured on the server. Set MISTRAL_API_KEY in the Vercel environment variables, then redeploy.",
    );
  }

  const response = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new MistralError(mistralErrorMessage(response.status, body), response.status);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new MistralError("Mistral returned an empty response.");
  return text;
}

function retryable(err: unknown) {
  const status = err instanceof MistralError ? err.statusCode : undefined;
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function aiText(
  system: string,
  messages: ModelMessage[],
  opts: { grounded?: boolean } = {},
): Promise<string> {
  if (opts.grounded !== false) system += GROUNDING;

  // Mistral Free mode can temporarily rate-limit or return a transient 5xx.
  // Retry a few times instead of failing an entire study-set generation.
  const delays = [1000, 2000, 4000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await callMistral(system, messages);
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === delays.length) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Mistral request failed. Please try again.");
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
