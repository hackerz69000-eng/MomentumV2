const NIM_MODEL = process.env["NIM_MODEL"]?.trim() || "openai/gpt-oss-20b";
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

type ModelMessage = { role: "user" | "assistant"; content: string };

class NimError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "NimError";
    this.statusCode = statusCode;
  }
}

function nimErrorMessage(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // Keep the raw response when NVIDIA does not return JSON.
  }

  if (status === 401) {
    return "NVIDIA NIM rejected the API key. Check NVIDIA_API_KEY in your Vercel environment variables and redeploy.";
  }
  if (status === 402) {
    return "NVIDIA NIM requires billing or the selected model is not available to this API key. Check your NVIDIA API Catalog account and model access.";
  }
  if (status === 403) {
    return `NVIDIA NIM denied the request${detail ? `: ${detail.slice(0, 1000)}` : "."}`;
  }
  if (status === 429) {
    return "NVIDIA NIM rate limit reached. Please wait a moment and try again.";
  }
  return `NVIDIA NIM request failed${detail ? `: ${detail.slice(0, 1000)}` : ` (HTTP ${status}).`}`;
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

async function callNim(system: string, messages: ModelMessage[]): Promise<string> {
  const apiKey = process.env["NVIDIA_API_KEY"]?.trim();
  if (!apiKey) {
    throw new NimError(
      "NVIDIA NIM is not configured on the server. Set NVIDIA_API_KEY in the Vercel environment variables, then redeploy.",
    );
  }

  const response = await fetch(NIM_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: NIM_MODEL,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: "system", content: system },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new NimError(nimErrorMessage(response.status, body), response.status);
  }

  let payload: { choices?: Array<{ message?: { content?: string | null } }> };
  try {
    payload = JSON.parse(body) as { choices?: Array<{ message?: { content?: string | null } }> };
  } catch {
    throw new NimError("NVIDIA NIM returned an invalid response.");
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new NimError("NVIDIA NIM returned an empty response.");
  return text;
}

function retryable(err: unknown) {
  const status = err instanceof NimError ? err.statusCode : undefined;
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function aiText(
  system: string,
  messages: ModelMessage[],
  opts: { grounded?: boolean } = {},
): Promise<string> {
  if (opts.grounded !== false) system += GROUNDING;

  const delays = [1000, 2000, 4000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await callNim(system, messages);
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === delays.length) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("NVIDIA NIM request failed. Please try again.");
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
