export type GeneratedQuizQuestion = {
  type: "mc" | "tf" | "short";
  question: string;
  options: string[];
  answer: number;
  answerText: string;
  explanation: string;
  topic: string;
  imageIndex?: number;
};

export function normalizeQuizQuestionText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

/** Strictly validate a provider batch before it can count as completed progress. */
export function validateQuizBatch(raw: unknown[], alreadySeen: Iterable<string> = []): GeneratedQuizQuestion[] {
  const seen = new Set([...alreadySeen].map(normalizeQuizQuestionText));
  const valid: GeneratedQuizQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    if (typeof q["question"] !== "string" || !q["question"].trim() || !["mc", "tf", "short"].includes(String(q["type"]))) continue;
    const type = q["type"] as GeneratedQuizQuestion["type"];
    const options = Array.isArray(q["options"]) ? q["options"].map((option) => String(option).trim()) : [];
    if (options.some((option) => !option)) continue;
    const answer = Number(q["answer"]);
    const answerText = typeof q["answerText"] === "string" ? q["answerText"].trim() : "";
    const explanation = typeof q["explanation"] === "string" ? q["explanation"].trim() : "";
    if (type === "mc" && (options.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer >= 4)) continue;
    if (type === "tf" && (options.length !== 2 || !Number.isInteger(answer) || answer < 0 || answer >= 2)) continue;
    if (type === "short" && (!answerText || options.length > 0)) continue;
    if (type !== "short" && !answerText && !options[answer]) continue;
    const normalizedOptions = options.map(normalizeQuizQuestionText);
    if ((type === "mc" && new Set(normalizedOptions).size !== 4) ||
        (type === "tf" && (new Set(normalizedOptions).size !== 2 || !normalizedOptions.includes("true") || !normalizedOptions.includes("false")))) continue;
    if (!explanation) continue;
    const question = q["question"].trim();
    const key = normalizeQuizQuestionText(question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    valid.push({
      type,
      question,
      options: type === "short" ? [] : options,
      answer: type === "short" ? -1 : answer,
      answerText: type === "short" ? answerText : options[answer]!,
      explanation,
      topic: typeof q["topic"] === "string" ? q["topic"].trim().slice(0, 60) || "General" : "General",
      ...(Number.isInteger(q["imageIndex"]) && Number(q["imageIndex"]) >= 0 && Number(q["imageIndex"]) < 3 ? { imageIndex: Number(q["imageIndex"]) } : {}),
    });
  }
  return valid;
}

export function quizBatchSize(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? Math.max(3, Math.min(6, parsed)) : 5;
}

export async function withQuizBatchRetries<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; delay?: (milliseconds: number) => Promise<void>; attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  const delay = options.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    try {
      const result = await operation();
      if (Array.isArray(result) && result.length === 0) throw new Error("The AI returned no valid, unique questions for this batch.");
      return result;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError") || attempt + 1 === attempts) throw error;
      await delay(400 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The quiz batch failed after retries.");
}

export function createQuizProgressKey(userId: string, session: unknown): string {
  const stable = JSON.stringify(session);
  let first = 2166136261;
  let second = 2246822519;
  for (let i = 0; i < stable.length; i += 1) {
    first = Math.imul(first ^ stable.charCodeAt(i), 16777619);
    second = Math.imul(second ^ stable.charCodeAt(i), 3266489917);
  }
  return `momentum:quiz-generation:v2:${userId}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}
