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
  return text.normalize("NFKC").toLocaleLowerCase().replace(/'s\b/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}

const QUESTION_FILLER = new Set("a an the is are was were be been being do does did can could would should what which who whom whose when where why how tell explain describe identify name select choose determine compare contrast about from into with for of in on at by as that this these those following according based upon please question following s".split(" "));
const QUESTION_SYNONYMS: Record<string, string> = {
  define: "definition", meaning: "definition", definition: "definition",
  cause: "cause", causes: "cause", caused: "cause", reason: "cause", reasons: "cause",
  effect: "effect", effects: "effect", consequence: "effect", consequences: "effect",
  produce: "produce", produces: "produce", producing: "produce", production: "produce", make: "produce", makes: "produce", generate: "produce", generates: "produce",
  function: "function", functions: "function", role: "function", purpose: "function",
  process: "process", processes: "process", mechanism: "process", mechanisms: "process",
};

function questionTokens(text: string): string[] {
  return normalizeQuizQuestionText(text).split(" ").filter((token) => token && !QUESTION_FILLER.has(token)).map((token) => {
    if (QUESTION_SYNONYMS[token]) return QUESTION_SYNONYMS[token]!;
    if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (token.length > 5 && token.endsWith("s")) return token.slice(0, -1);
    return token;
  });
}

function questionIntent(text: string): string {
  const normalized = normalizeQuizQuestionText(text);
  if (/^(define|definition|meaning)\b/.test(normalized) || /^what is\b/.test(normalized) || /\bmean\s+by\b/.test(normalized)) return "definition";
  if (/^(compare|contrast)\b/.test(normalized) || /\b(difference|differences) between\b/.test(normalized)) return "comparison";
  if (/\b(cause|causes|caused|reason|reasons|why)\b/.test(normalized)) return "cause";
  if (/\b(effect|effects|affect|affects|consequence|consequences)\b/.test(normalized)) return "effect";
  if (/\b(function|functions|role|purpose)\b/.test(normalized)) return "function";
  if (/\b(process|processes|mechanism|mechanisms|how)\b/.test(normalized)) return "process";
  return "general";
}

function questionSignature(text: string): string {
  const intent = questionIntent(text);
  const actionWords = new Set(Object.keys(QUESTION_SYNONYMS));
  const tokens = questionTokens(text).filter((token) => !actionWords.has(token));
  return `${intent}:${[...new Set(tokens)].sort().join(" ")}`;
}

function duplicateKind(candidate: string, previous: string): QuizDuplicateKind | null {
  const normalized = normalizeQuizQuestionText(candidate);
  const priorNormalized = normalizeQuizQuestionText(previous);
  if (!normalized || !priorNormalized) return null;
  if (normalized === priorNormalized) return "exact";
  if (questionSignature(candidate) === questionSignature(previous)) return "semantic";
  const candidateTokens = new Set(questionTokens(candidate));
  const priorUnique = new Set(questionTokens(previous));
  if (candidateTokens.size < 4 || priorUnique.size < 4) return null;
  const intersection = [...candidateTokens].filter((token) => priorUnique.has(token)).length;
  const union = new Set([...candidateTokens, ...priorUnique]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(candidateTokens.size, priorUnique.size);
  return (jaccard >= 0.82 && intersection >= 4) || (containment >= 0.92 && intersection >= 5) ? "near" : null;
}

/** Stable database key for case/punctuation/intent paraphrase collisions. */
export function questionReservationKey(text: string): string {
  return questionSignature(text);
}

/**
 * Conservative wording duplicate check shared by assessment flows.
 * It catches punctuation/case variants, common intent paraphrases and close
 * wording while requiring several shared content terms for a near-match.
 */
export function isDuplicateQuestionText(candidate: string, seen: Iterable<string>): boolean {
  for (const previous of seen) if (duplicateKind(candidate, previous)) return true;
  return false;
}

/** Accept only the first occurrence of each question across a whole workflow. */
export function uniqueQuestionTexts<T extends { question: string }>(questions: T[], excluded: Iterable<string> = []): T[] {
  const seen = [...excluded];
  const accepted: T[] = [];
  for (const item of questions) {
    if (isDuplicateQuestionText(item.question, seen)) continue;
    accepted.push(item);
    seen.push(item.question);
  }
  return accepted;
}

/** Extract numbered practice prompts between Markdown headings for rich-text outputs. */
export function extractNumberedQuestionSection(markdown: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = markdown.match(new RegExp(`^#{1,3}\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=^#{1,3}\\s|(?![\\s\\S]))`, "im"))?.[1] ?? "";
  return body.split("\n").map((line) => line.match(/^\s*\d+[.)]\s+(.+?)\s*$/)?.[1]?.trim() ?? "").filter(Boolean);
}

export type QuizBatchValidation = {
  questions: GeneratedQuizQuestion[];
  invalidCount: number;
  duplicateCount: number;
  exactDuplicateCount: number;
  nearDuplicateCount: number;
  semanticDuplicateCount: number;
  duplicateFingerprints: string[];
  inputCount: number;
  formatError?: string;
};

export type QuizDuplicateKind = "exact" | "near" | "semantic";

/** Compact identifier for comparing responses without printing source text. */
export function diagnosticFingerprint(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function logQuizDiagnostic(details: Record<string, unknown>): void {
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem("momentum:quiz-diagnostics") === "enabled") {
      console.info("[Momentum quiz generation]", details);
    }
  } catch { /* Diagnostics must never interrupt quiz generation. */ }
}

/** Accept equivalent JSON wrappers while preserving strict per-question validation. */
export function extractQuizQuestionArray(value: unknown): { questions: unknown[]; formatError?: string } {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; }
    catch { return { questions: [], formatError: "The response was malformed JSON." }; }
  }
  if (Array.isArray(value)) return { questions: value };
  if (!value || typeof value !== "object") return { questions: [], formatError: "Expected a question array or JSON object containing questions." };
  const record = value as Record<string, unknown>;
  for (const key of ["questions", "items", "quiz", "quizQuestions", "quiz_questions", "results", "questionList", "question_list"]) {
    if (Array.isArray(record[key])) return { questions: record[key] as unknown[] };
  }
  for (const key of ["data", "result", "exam"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const extracted = extractQuizQuestionArray(nested);
      if (!extracted.formatError) return extracted;
    }
  }
  const grouped = [
    ["mc", ["multiple_choice_questions", "multipleChoiceQuestions", "mc_questions", "mcq"]],
    ["tf", ["true_false_questions", "trueFalseQuestions", "true_false"]],
    ["short", ["short_answer_questions", "shortAnswerQuestions", "short_answer"]],
  ] as const;
  const groupedQuestions = grouped.flatMap(([type, keys]) => keys.flatMap((key) => Array.isArray(record[key])
    ? (record[key] as unknown[]).map((question) => question && typeof question === "object" && !Array.isArray(question)
      ? { type, ...(question as Record<string, unknown>) }
      : question)
    : []));
  if (groupedQuestions.length) return { questions: groupedQuestions };
  return { questions: [], formatError: "The JSON object did not contain a recognized questions array." };
}

function field(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function canonicalType(value: unknown): GeneratedQuizQuestion["type"] | null {
  const type = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["mc", "mcq", "multiple_choice", "multiplechoice", "multiple_choice_question", "choice"].includes(type)) return "mc";
  if (["tf", "true_false", "true/false", "truefalse", "boolean"].includes(type)) return "tf";
  if (["short", "short_answer", "shortanswer", "free_response", "open_ended"].includes(type)) return "short";
  return null;
}

function canonicalAnswer(value: unknown, options: string[]): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "boolean") return value ? 0 : 1;
  if (typeof value !== "string") return Number.NaN;
  const normalized = normalizeQuizQuestionText(value);
  const exactIndex = options.findIndex((option) => normalizeQuizQuestionText(option) === normalized);
  if (exactIndex >= 0) return exactIndex;
  if (/^[a-d]$/i.test(value.trim())) return value.trim().toUpperCase().charCodeAt(0) - 65;
  if ((normalized === "true" || normalized === "false") && options.length === 2) {
    return options.findIndex((option) => normalizeQuizQuestionText(option) === normalized);
  }
  if (/^-?\d+$/.test(value.trim())) return Number(value);
  return Number.NaN;
}

/** Strictly validate a provider payload before it can count as completed progress. */
export function inspectQuizBatch(payload: unknown, alreadySeen: Iterable<string> = []): QuizBatchValidation {
  const extracted = extractQuizQuestionArray(payload);
  const seen = [...alreadySeen];
  const valid: GeneratedQuizQuestion[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let exactDuplicateCount = 0;
  let nearDuplicateCount = 0;
  let semanticDuplicateCount = 0;
  const duplicateFingerprints: string[] = [];
  for (const item of extracted.questions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { invalidCount += 1; continue; }
    const q = item as Record<string, unknown>;
    const questionValue = field(q, ["question", "prompt", "text"]);
    const type = canonicalType(field(q, ["type", "questionType", "question_type", "kind"]));
    if (typeof questionValue !== "string" || !questionValue.trim() || !type) { invalidCount += 1; continue; }
    const rawOptions = field(q, ["options", "choices"]);
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option) => String(option).trim())
      : rawOptions && typeof rawOptions === "object"
        ? Object.entries(rawOptions as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([, option]) => String(option).trim())
        : [];
    if (options.some((option) => !option)) { invalidCount += 1; continue; }
    if (type === "tf" && options.length === 0) options.push("True", "False");
    const rawAnswer = field(q, ["answer", "answerIndex", "answer_index", "correctIndex", "correct_index", "correctOption", "correct_option", "correctAnswer", "correct_answer"]);
    const answer = canonicalAnswer(rawAnswer, options);
    const answerTextValue = field(q, ["answerText", "answer_text", "modelAnswer", "model_answer", "correctAnswerText", "correct_answer_text"]);
    const answerText = typeof answerTextValue === "string" ? answerTextValue.trim() : type === "short" && typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    const explanationValue = field(q, ["explanation", "rationale", "feedback", "reason"]);
    const explanation = typeof explanationValue === "string" ? explanationValue.trim() : "";
    if (type === "mc" && (options.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer >= 4)) { invalidCount += 1; continue; }
    if (type === "tf" && (options.length !== 2 || !Number.isInteger(answer) || answer < 0 || answer >= 2)) { invalidCount += 1; continue; }
    if (type === "short" && (!answerText || options.length > 0)) { invalidCount += 1; continue; }
    if (type !== "short" && !answerText && !options[answer]) { invalidCount += 1; continue; }
    const normalizedOptions = options.map(normalizeQuizQuestionText);
    if ((type === "mc" && new Set(normalizedOptions).size !== 4) ||
        (type === "tf" && (new Set(normalizedOptions).size !== 2 || !normalizedOptions.includes("true") || !normalizedOptions.includes("false")))) { invalidCount += 1; continue; }
    if (!explanation) { invalidCount += 1; continue; }
    const question = questionValue.trim();
    const key = normalizeQuizQuestionText(question);
    if (!key) { invalidCount += 1; continue; }
    const duplicateKinds = seen.map((previous) => duplicateKind(question, previous));
    const duplicate = duplicateKinds.includes("exact") ? "exact"
      : duplicateKinds.includes("semantic") ? "semantic"
      : duplicateKinds.includes("near") ? "near" : null;
    if (duplicate) {
      duplicateCount += 1;
      if (duplicate === "exact") exactDuplicateCount += 1;
      else if (duplicate === "near") nearDuplicateCount += 1;
      else semanticDuplicateCount += 1;
      duplicateFingerprints.push(diagnosticFingerprint(normalizeQuizQuestionText(question)));
      continue;
    }
    seen.push(question);
    valid.push({
      type,
      question,
      options: type === "short" ? [] : options,
      answer: type === "short" ? -1 : answer,
      answerText: type === "short" ? answerText : options[answer]!,
      explanation,
      topic: typeof field(q, ["topic", "category", "subject"]) === "string" ? String(field(q, ["topic", "category", "subject"])).trim().slice(0, 60) || "General" : "General",
      ...(Number.isInteger(q["imageIndex"]) && Number(q["imageIndex"]) >= 0 && Number(q["imageIndex"]) < 3 ? { imageIndex: Number(q["imageIndex"]) } : {}),
    });
  }
  return { questions: valid, invalidCount, duplicateCount, exactDuplicateCount, nearDuplicateCount, semanticDuplicateCount, duplicateFingerprints, inputCount: extracted.questions.length, ...(extracted.formatError ? { formatError: extracted.formatError } : {}) };
}

export function validateQuizBatch(raw: unknown[] | unknown, alreadySeen: Iterable<string> = []): GeneratedQuizQuestion[] {
  return inspectQuizBatch(raw, alreadySeen).questions;
}

/** Validate and bound browser-stored progress before it is reused by a server plan. */
export function sanitizeQuizResumeParts(
  rawParts: unknown,
  targetCounts: number[],
  excludedQuestions: Iterable<string> = [],
  allowedTypes?: readonly GeneratedQuizQuestion["type"][],
): Map<number, GeneratedQuizQuestion[]> {
  const result = new Map<number, GeneratedQuizQuestion[]>();
  if (!Array.isArray(rawParts)) return result;
  const seen = [...excludedQuestions];
  for (const rawPart of rawParts) {
    if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) continue;
    const part = rawPart as { partIndex?: unknown; questions?: unknown };
    const partIndex = part.partIndex;
    if (!Number.isInteger(partIndex) || (partIndex as number) < 0 || (partIndex as number) >= targetCounts.length || !Array.isArray(part.questions)) continue;
    const current = result.get(partIndex as number) ?? [];
    const remaining = Math.max(0, (targetCounts[partIndex as number] ?? 0) - current.length);
    if (!remaining) continue;
    const allowed = allowedTypes ? new Set(allowedTypes) : null;
    const accepted = inspectQuizBatch(part.questions, seen).questions
      .filter((question) => !allowed || allowed.has(question.type))
      .slice(0, remaining);
    accepted.forEach((question) => seen.push(question.question));
    if (accepted.length) result.set(partIndex as number, [...current, ...accepted]);
    else if (!result.has(partIndex as number)) result.set(partIndex as number, []);
  }
  return result;
}

export class QuizBatchValidationError extends Error {
  constructor(readonly validation: QuizBatchValidation, readonly expectedCount: number) {
    const reason = validation.formatError ?? `${validation.invalidCount} invalid; ${validation.exactDuplicateCount} exact, ${validation.nearDuplicateCount} near, and ${validation.semanticDuplicateCount} semantic duplicate(s)`;
    super(`Only ${validation.questions.length} of ${expectedCount} questions were valid and unique (${reason}).`);
    this.name = "QuizBatchValidationError";
  }
}

/** Keep all valid items from a partial response and ask only for its missing replacements. */
export async function generateValidatedQuizBatch(
  expectedCount: number,
  existingQuestions: GeneratedQuizQuestion[],
  excludedQuestions: string[],
  request: (feedback: string | null, attempt: number, requestId: string, usedQuestions: string[]) => Promise<unknown>,
  options: {
    signal?: AbortSignal;
    attempts?: number;
    allowedTypes?: readonly GeneratedQuizQuestion["type"][];
    diagnostics?: { batchId?: string; requestedTotal?: number; completedCount?: number; sourcePartIndex?: number; sourceChars?: number; sourceFingerprint?: string };
  } = {},
): Promise<GeneratedQuizQuestion[]> {
  const maxAttempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  const accepted: GeneratedQuizQuestion[] = [];
  const seen = [...excludedQuestions, ...existingQuestions.map((question) => question.question)];
  let lastValidation: QuizBatchValidation = { questions: [], invalidCount: 0, duplicateCount: 0, exactDuplicateCount: 0, nearDuplicateCount: 0, semanticDuplicateCount: 0, duplicateFingerprints: [], inputCount: 0, formatError: "No response was received." };
  let lastError: unknown;
  const observedResponses = new Set<string>();
  const batchId = options.diagnostics?.batchId ?? `quiz-${diagnosticFingerprint(`${Date.now()}:${Math.random()}`)}`;
  for (let attempt = 0; attempt < maxAttempts && accepted.length < expectedCount; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    const missing = expectedCount - accepted.length;
    // Prioritize questions from this assessment/retry, then the most recent
    // history (the server returns history newest first). Keeping the tail used
    // to omit the most recent history and could omit current retry candidates.
    const usedQuestions = [...new Set([
      ...existingQuestions.map((question) => question.question),
      ...accepted.map((question) => question.question),
      ...excludedQuestions,
    ])].slice(0, 80);
    const avoidList = usedQuestions.length ? ` Already-used questions that must not be repeated:\n- ${usedQuestions.join("\n- ")}` : "";
    const feedback = attempt === 0 ? null : lastValidation.formatError
      ? `The previous reply could not be parsed: ${lastValidation.formatError}${lastError instanceof Error ? ` (${lastError.message})` : ""}. Return exactly ${missing} replacement question(s) as one JSON object with a top-level "questions" array. Each item must use type "mc", "tf", or "short"; keys "question", "options", "answer", "answerText", "explanation", and "topic"; obey the requested answer-index rules; include every required field; do not add prose or code fences.${avoidList}`
      : `The previous reply yielded ${lastValidation.questions.length} valid question(s), ${lastValidation.invalidCount} invalid item(s), and ${lastValidation.duplicateCount} duplicate item(s). Keep valid questions already accepted; now return exactly ${missing} replacement question(s) that pass the same validation. Use one JSON object with a top-level "questions" array and canonical fields type, question, options, answer, answerText, explanation, and topic. ${options.allowedTypes ? `Use only these requested question types: ${options.allowedTypes.join(", ")}.` : ""} Do not repeat any excluded or already accepted question. Do not relax source grounding or guess.${avoidList}`;
    const requestId = `${batchId}-${attempt + 1}`;
    const acceptedBefore = accepted.length;
    try {
      const payload = await request(feedback, attempt, requestId, usedQuestions);
      const inspected = inspectQuizBatch(payload, seen);
      if (options.allowedTypes) {
        const allowed = new Set(options.allowedTypes);
        const questions = inspected.questions.filter((question) => allowed.has(question.type));
        lastValidation = {
          ...inspected,
          questions,
          invalidCount: inspected.invalidCount + inspected.questions.length - questions.length,
        };
      } else lastValidation = inspected;
      const remainingValid = lastValidation.questions.slice(0, missing);
      accepted.push(...remainingValid);
      remainingValid.forEach((question) => seen.push(question.question));
      const responseQuestions = extractQuizQuestionArray(payload).questions.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return "";
        return String(field(item as Record<string, unknown>, ["question", "prompt", "text"]) ?? "").trim();
      }).filter(Boolean);
      const candidateFingerprints = responseQuestions.map((question) => diagnosticFingerprint(normalizeQuizQuestionText(question))).sort();
      const responseFingerprint = diagnosticFingerprint(candidateFingerprints.join("|"));
      const responseFresh = !observedResponses.has(responseFingerprint);
      observedResponses.add(responseFingerprint);
      logQuizDiagnostic({
        event: "quiz_batch_response",
        batchId,
        requestId,
        requestReturned: true,
        responseFresh,
        responseFingerprint,
        requestedTotal: options.diagnostics?.requestedTotal ?? expectedCount,
        completedBeforeBatch: options.diagnostics?.completedCount ?? existingQuestions.length,
        batchSize: expectedCount,
        sourcePartIndex: options.diagnostics?.sourcePartIndex ?? null,
        sourceChars: options.diagnostics?.sourceChars ?? null,
        sourceFingerprint: options.diagnostics?.sourceFingerprint ?? null,
        replacementAttempt: attempt,
        replacementRequested: attempt > 0 ? missing : 0,
        candidateCount: lastValidation.inputCount,
        validCandidateCount: lastValidation.questions.length,
        candidateFingerprints,
        acceptedThisResponse: accepted.length - acceptedBefore,
        acceptedTotalAfterResponse: (options.diagnostics?.completedCount ?? existingQuestions.length) + accepted.length,
        remainingTotalAfterResponse: Math.max(0, (options.diagnostics?.requestedTotal ?? expectedCount) - (options.diagnostics?.completedCount ?? existingQuestions.length) - accepted.length),
        invalidRejected: lastValidation.invalidCount,
        exactDuplicatesRejected: lastValidation.exactDuplicateCount,
        nearDuplicatesRejected: lastValidation.nearDuplicateCount,
        semanticDuplicatesRejected: lastValidation.semanticDuplicateCount,
        usedQuestionContextCount: usedQuestions.length,
        duplicateFingerprints: lastValidation.duplicateFingerprints,
      });
      lastError = null;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lastError = error;
      logQuizDiagnostic({
        event: "quiz_batch_request_failed",
        batchId,
        requestId,
        requestReturned: false,
        requestedTotal: options.diagnostics?.requestedTotal ?? expectedCount,
        completedBeforeBatch: options.diagnostics?.completedCount ?? existingQuestions.length,
        batchSize: expectedCount,
        sourcePartIndex: options.diagnostics?.sourcePartIndex ?? null,
        sourceChars: options.diagnostics?.sourceChars ?? null,
        sourceFingerprint: options.diagnostics?.sourceFingerprint ?? null,
        replacementAttempt: attempt,
        replacementRequested: attempt > 0 ? missing : 0,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      lastValidation = { questions: [], invalidCount: 0, duplicateCount: 0, exactDuplicateCount: 0, nearDuplicateCount: 0, semanticDuplicateCount: 0, duplicateFingerprints: [], inputCount: 0, formatError: `The provider response was malformed, incomplete, or unavailable${error instanceof Error ? `: ${error.message}` : ""}.` };
    }
  }
  if (!accepted.length) {
    throw new QuizBatchValidationError({ ...lastValidation, questions: accepted }, expectedCount);
  }
  return accepted;
}

export function quizBatchSize(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? Math.max(3, Math.min(6, parsed)) : 5;
}

export async function withQuizBatchRetries<T>(
  operation: (attempt: number, previousError: unknown) => Promise<T>,
  options: { signal?: AbortSignal; delay?: (milliseconds: number) => Promise<void>; attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  const delay = options.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    try {
      const result = await operation(attempt, lastError);
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
