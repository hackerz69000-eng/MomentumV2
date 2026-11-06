/**
 * Shared quiz-question pipeline: validation, within-quiz de-duplication and
 * batch planning.
 *
 * De-duplication here is deliberately scoped to ONE quiz session. Previous
 * quizzes are never an input to this module, so a question used in an earlier
 * quiz (or practice exam, or comprehensive exam) can never permanently exhaust a
 * study set. Callers may pass earlier questions to the model as a soft
 * preference, but they must never feed them to the filters below.
 */

export type QuizQuestion = {
  type: "mc" | "tf" | "short";
  question: string;
  options: string[];
  answer: number;
  answerText: string;
  explanation: string;
  topic: string;
  setId?: string;
  imageIndex?: number;
  imageUrl?: string;
  imageName?: string;
  imagePath?: string;
  imageKind?: "image" | "pdf" | "pptx" | "docx";
  imageSourceIndex?: number;
  imageDataUrl?: string;
};

export const MAX_QUIZ_QUESTIONS = 60;
export const MIN_QUIZ_QUESTIONS = 3;
/** Upper bound for one provider request; large batches lose JSON compliance. */
export const QUESTIONS_PER_BATCH = 8;
/** Vision requests carry up to three images, so they get a smaller batch. */
export const QUESTIONS_PER_VISION_BATCH = 4;

/** Hard ceiling on replacement rounds so generation can never loop forever. */
export const MAX_GENERATION_ROUNDS = 18;
/** Consecutive rounds with no accepted question before we give up gracefully. */
export const MAX_STALLED_ROUNDS = 3;

/** Lowercase, punctuation-free, whitespace-collapsed representation. */
export function normalizeQuestionText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact-match key: case, punctuation and spacing insensitive. */
export function questionKey(text: string): string {
  return normalizeQuestionText(text).replace(/ /g, "");
}

const SIMILARITY_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "by", "with",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "that", "this", "these", "those", "it", "its", "as", "and", "or", "but",
  "according", "following", "statement", "question", "material",
]);

/** Content tokens used for similarity, with question scaffolding removed. */
export function similarityTokens(text: string): string[] {
  return normalizeQuestionText(text)
    .split(" ")
    .filter((token) => token.length > 1 && !SIMILARITY_STOPWORDS.has(token));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

function charBigrams(text: string): string[] {
  const compact = questionKey(text);
  if (compact.length < 2) return compact ? [compact] : [];
  const grams: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) grams.push(compact.slice(i, i + 2));
  return grams;
}

/** Sorensen-Dice coefficient over character bigrams: word order sensitive. */
function diceBigrams(a: string, b: string): number {
  const gramsA = charBigrams(a);
  const gramsB = charBigrams(b);
  if (!gramsA.length || !gramsB.length) return 0;
  const counts = new Map<string, number>();
  for (const gram of gramsA) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let shared = 0;
  for (const gram of gramsB) {
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      shared += 1;
      counts.set(gram, remaining - 1);
    }
  }
  return (2 * shared) / (gramsA.length + gramsB.length);
}

/**
 * Similarity in [0,1]. Requires BOTH bag-of-words overlap and character-order
 * overlap, so reversing the word order (or swapping one term for another) does
 * not, on its own, register as a duplicate.
 */
export function questionSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (questionKey(a) === questionKey(b)) return 1;
  const tokenScore = jaccard(similarityTokens(a), similarityTokens(b));
  const orderScore = diceBigrams(a, b);
  return Math.min(tokenScore, orderScore);
}

/** Near-identical duplicates only; different concepts sharing vocabulary survive. */
export const NEAR_DUPLICATE_THRESHOLD = 0.82;

export function isNearDuplicate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (questionKey(a) === questionKey(b)) return true;
  const tokensA = similarityTokens(a);
  const tokensB = similarityTokens(b);
  // Very short prompts ("Define pH.") only count as duplicates when identical.
  if (tokensA.length < 3 || tokensB.length < 3) return false;
  return questionSimilarity(a, b) >= NEAR_DUPLICATE_THRESHOLD;
}

export type DedupeVerdict = "unique" | "exact-duplicate" | "near-duplicate";

/**
 * Within-quiz duplicate detector. One instance covers exactly one quiz: every
 * accepted question of the current quiz is registered here, including questions
 * from earlier batches and questions restored from an interrupted generation.
 */
export class QuizQuestionRegistry {
  private readonly keys = new Set<string>();
  private readonly texts: string[] = [];

  constructor(initial: readonly { question: string }[] = []) {
    for (const question of initial) this.register(question.question);
  }

  get size(): number {
    return this.keys.size;
  }

  register(text: string): void {
    const key = questionKey(text);
    if (!key || this.keys.has(key)) return;
    this.keys.add(key);
    this.texts.push(text);
  }

  check(text: string): DedupeVerdict {
    const key = questionKey(text);
    if (!key) return "exact-duplicate";
    if (this.keys.has(key)) return "exact-duplicate";
    for (const existing of this.texts) {
      if (isNearDuplicate(existing, text)) return "near-duplicate";
    }
    return "unique";
  }

  /** Returns the verdict and registers the question when it is new. */
  accept(text: string): DedupeVerdict {
    const verdict = this.check(text);
    if (verdict === "unique") this.register(text);
    return verdict;
  }
}

const TYPE_VALUES = new Set(["mc", "tf", "short"]);

export type QuestionRejection =
  | "not-an-object"
  | "unsupported-type"
  | "empty-question"
  | "too-long"
  | "bad-options"
  | "bad-answer-index"
  | "duplicate-options"
  | "bad-true-false"
  | "missing-answer"
  | "missing-explanation"
  | "not-requested-type";

/**
 * Validate one raw provider object. Nothing here counts toward the requested
 * total until it passes as a complete, answerable question.
 */
export function validateQuestion(
  raw: unknown,
  options: { types?: readonly ("mc" | "tf" | "short")[] } = {},
): { ok: true; question: QuizQuestion } | { ok: false; reason: QuestionRejection } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not-an-object" };
  const candidate = raw as Partial<QuizQuestion> & Record<string, unknown>;
  if (typeof candidate.question !== "string") return { ok: false, reason: "empty-question" };
  const questionText = candidate.question.trim();
  if (!questionText) return { ok: false, reason: "empty-question" };
  if (questionText.length > 2000) return { ok: false, reason: "too-long" };
  if (typeof candidate.type !== "string" || !TYPE_VALUES.has(candidate.type)) {
    return { ok: false, reason: "unsupported-type" };
  }
  const type = candidate.type as "mc" | "tf" | "short";
  if (options.types?.length && !options.types.includes(type)) {
    return { ok: false, reason: "not-requested-type" };
  }
  if (!Array.isArray(candidate.options)) return { ok: false, reason: "bad-options" };
  if (candidate.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 500)) {
    return { ok: false, reason: "bad-options" };
  }
  const optionList = (candidate.options as string[]).map((option) => option.trim());
  const answer = typeof candidate.answer === "number" ? candidate.answer : Number.NaN;
  const answerText = typeof candidate.answerText === "string" ? candidate.answerText.trim() : "";
  const explanation = typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";

  if (type === "mc" && (optionList.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3)) {
    return { ok: false, reason: "bad-answer-index" };
  }
  if (type === "tf" && (optionList.length !== 2 || !Number.isInteger(answer) || answer < 0 || answer > 1)) {
    return { ok: false, reason: "bad-answer-index" };
  }
  if (type === "short" && (optionList.length > 0 || candidate.answer !== -1)) {
    return { ok: false, reason: "bad-options" };
  }
  if (type === "short" && (!answerText || answerText.length > 2000)) {
    return { ok: false, reason: "missing-answer" };
  }
  if (type === "mc" && new Set(optionList.map(questionKey)).size !== optionList.length) {
    return { ok: false, reason: "duplicate-options" };
  }
  if (
    type === "tf" &&
    (new Set(optionList.map(questionKey)).size !== 2 ||
      !optionList.some((option) => questionKey(option) === "true") ||
      !optionList.some((option) => questionKey(option) === "false"))
  ) {
    return { ok: false, reason: "bad-true-false" };
  }
  if (!explanation) return { ok: false, reason: "missing-explanation" };

  const imageIndex = candidate.imageIndex;
  const hasImageIndex =
    typeof imageIndex === "number" && Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < 3;

  return {
    ok: true,
    question: {
      type,
      question: questionText,
      options: type === "short" ? [] : optionList,
      answer: type === "short" ? -1 : answer,
      // The indexed option is the single source of truth for objective questions.
      answerText: type === "short" ? answerText : (optionList[answer] ?? answerText),
      explanation,
      topic: typeof candidate.topic === "string" && candidate.topic.trim()
        ? candidate.topic.trim().slice(0, 60)
        : "General",
      ...(hasImageIndex ? { imageIndex: imageIndex as number } : {}),
    },
  };
}

/** Collects complete JSON objects from a possibly truncated model response. */
export function extractJsonObjects(text: string): unknown[] {
  const source = String(text ?? "");
  const out: unknown[] = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, i + 1)) as unknown;
            if (parsed && typeof parsed === "object") out.push(parsed);
          } catch { /* incomplete object: skip */ }
          start = i;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Read a raw provider payload into question candidates. Accepts
 * {"questions":[...]}, {"parts":[{questions:[...]}]}, a bare array, and
 * truncated JSON (complete questions are salvaged instead of losing the batch).
 */
export function readQuestionCandidates(text: string): unknown[] {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const cleaned = source.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const tryParse = (value: string): unknown => {
    try { return JSON.parse(value) as unknown; } catch { return null; }
  };
  const collect = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (Array.isArray(record["questions"])) return record["questions"];
    if (Array.isArray(record["parts"])) {
      return record["parts"].flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const questions = (part as Record<string, unknown>)["questions"];
        return Array.isArray(questions) ? questions : [];
      });
    }
    return [];
  };
  const direct = tryParse(cleaned);
  if (direct !== null) {
    const collected = collect(direct);
    if (collected.length) return collected;
  }
  // Salvage path: truncated or prose-wrapped output.
  const objects = extractJsonObjects(cleaned);
  for (const object of objects) {
    const collected = collect(object);
    if (collected.length) return collected;
  }
  return objects.filter((object) => {
    const record = object as Record<string, unknown>;
    return typeof record["question"] === "string";
  });
}

export type AcceptedQuestions = {
  questions: QuizQuestion[];
  invalidCount: number;
  duplicateCount: number;
};

/**
 * Validate and de-duplicate raw candidates against questions already accepted
 * for this quiz, stopping at `limit`. Only accepted questions are returned, so
 * callers can count exactly what the student will see.
 */
export function acceptQuestions(
  candidates: readonly unknown[],
  registry: QuizQuestionRegistry,
  options: { limit: number; types?: readonly ("mc" | "tf" | "short")[] },
): AcceptedQuestions {
  const questions: QuizQuestion[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const candidate of candidates) {
    if (questions.length >= options.limit) break;
    const validated = validateQuestion(candidate, options.types ? { types: options.types } : {});
    if (!validated.ok) {
      invalidCount += 1;
      continue;
    }
    const verdict = registry.accept(validated.question.question);
    if (verdict !== "unique") {
      duplicateCount += 1;
      continue;
    }
    questions.push(validated.question);
  }
  return { questions, invalidCount, duplicateCount };
}

/** Split `count` questions across `parts`, front-loading the remainder. */
export function allocateQuestionTargets(count: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(count / parts);
  let extra = count - base * parts;
  return Array.from({ length: parts }, () => {
    const target = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return target;
  });
}

/**
 * How many questions of one batch may be accepted: never more than the batch
 * asked for, and never more than the quiz is still missing. The planner asks
 * for extra questions on purpose, so the surplus must not inflate the quiz.
 */
export function acceptLimit(batchCount: number, count: number, accepted: number): number {
  return Math.max(0, Math.min(Math.floor(batchCount), Math.floor(count) - Math.floor(accepted)));
}

export type BatchRequest = { unit: number; batchCount: number };

/**
 * Smallest batch we ever ask for. Asking for a single question is the worst
 * case for a model: it tends to hand back a slight rewording of a question the
 * quiz already has, which the duplicate filter then rejects, so the round makes
 * no progress and the quiz stalls one question short.
 */
export const MIN_BATCH_ASK = 3;
/** Ceiling on provider requests issued in one round. */
export const MAX_BATCH_REQUESTS = 6;

/** How many questions one round should ask for, including safety headroom. */
export function batchAskTotal(remaining: number, batchCap: number): number {
  if (remaining <= 0) return 0;
  const cap = Math.max(1, Math.floor(batchCap));
  const wanted = Math.max(remaining, Math.ceil(remaining * 1.6), Math.min(MIN_BATCH_ASK, cap));
  return Math.min(wanted, cap * MAX_BATCH_REQUESTS);
}

/** Split a total into evenly sized provider batches, none above the cap. */
export function splitIntoBatchSizes(total: number, batchCap: number): number[] {
  const cap = Math.max(1, Math.floor(batchCap));
  if (total <= 0) return [];
  const chunks = Math.ceil(total / cap);
  const size = Math.ceil(total / chunks);
  const sizes: number[] = [];
  let left = total;
  while (left > 0) {
    const next = Math.min(size, left);
    sizes.push(next);
    left -= next;
  }
  return sizes;
}

/**
 * Plan the next round of provider requests for a set of material units.
 *
 * 1. Fill each unit's remaining shortfall (rotating the start position each
 *    round so one weak unit cannot starve the others).
 * 2. Then top up round-robin from units that are still allowed, so material
 *    that cannot support its share never blocks the requested total.
 *
 * Every request is capped at `batchCap` so prompts stay small enough for the
 * provider to return complete JSON. Units listed in `exhausted` are skipped:
 * they already returned nothing twice, so re-asking them burns rounds.
 */
export function planBatchRequests(args: {
  targets: readonly number[];
  accepted: readonly number[];
  remaining: number;
  batchCap: number;
  round: number;
  exhausted?: readonly number[];
}): BatchRequest[] {
  const count = args.targets.length;
  if (count === 0 || args.remaining <= 0) return [];
  const batchCap = Math.max(1, Math.floor(args.batchCap));
  const exhausted = new Set(args.exhausted ?? []);
  const allExhausted = exhausted.size >= count;
  const order: number[] = [];
  for (let step = 0; step < count; step += 1) {
    const unit = (step + Math.max(0, args.round)) % count;
    if (!allExhausted && exhausted.has(unit)) continue;
    order.push(unit);
  }
  if (!order.length) return [];

  // Ask for MORE than is missing. A provider that returns exactly what was
  // asked for, minus one rejected duplicate, used to leave the quiz one short
  // and then loop on a single-question request that kept colliding.
  const total = Math.min(
    batchAskTotal(args.remaining, batchCap),
    batchCap * order.length * 2,
  );
  const sizes = splitIntoBatchSizes(total, batchCap);

  // Units that still owe their share of the quiz's topic mix get served first.
  const ranked = [...order].sort((a, b) => {
    const na = Math.max(0, (args.targets[a] ?? 0) - (args.accepted[a] ?? 0));
    const nb = Math.max(0, (args.targets[b] ?? 0) - (args.accepted[b] ?? 0));
    return nb - na;
  });
  return sizes.map((batchCount, index) => ({
    unit: ranked[index % ranked.length] as number,
    batchCount,
  }));
}

/** Number of questions a plan will ask for in total. */
export function planQuestionTotal(plan: readonly BatchRequest[]): number {
  return plan.reduce((sum, item) => sum + item.batchCount, 0);
}

// ---------------------------------------------------------------------------
// Pure planning and finalization used by the server generation handlers.
// Kept free of Supabase and provider calls so they can be tested directly.
// ---------------------------------------------------------------------------

export type InQuizState = { byPart: Map<number, QuizQuestion[]>; all: QuizQuestion[] };

/**
 * Read the questions already accepted for THIS quiz out of the round-trip
 * state. Earlier quizzes are never read here, so they can never block a new
 * quiz. Parts are validated and de-duplicated against one another.
 */
export function readInQuizState(generatedText?: string): InQuizState {
  const byPart = new Map<number, QuizQuestion[]>();
  const all: QuizQuestion[] = [];
  if (!generatedText) return { byPart, all };
  let parsed: { parts?: unknown } | null = null;
  try {
    parsed = JSON.parse(generatedText) as { parts?: unknown };
  } catch {
    parsed = null;
  }
  const parts = Array.isArray(parsed?.parts) ? (parsed.parts as unknown[]) : [];
  if (!parts.length) {
    // Accept a plain {"questions":[...]} payload as "all questions in part 0".
    const direct = readQuestionCandidates(generatedText);
    if (!direct.length) return { byPart, all };
    const accepted = acceptQuestions(direct, new QuizQuestionRegistry(), { limit: direct.length });
    if (accepted.questions.length) {
      byPart.set(0, accepted.questions);
      all.push(...accepted.questions);
    }
    return { byPart, all };
  }
  const registry = new QuizQuestionRegistry();
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as { partIndex?: unknown; questions?: unknown };
    const index = typeof record.partIndex === "number" && Number.isInteger(record.partIndex) ? record.partIndex : 0;
    const raw = Array.isArray(record.questions) ? record.questions : [];
    const accepted = acceptQuestions(raw, registry, { limit: raw.length });
    for (const question of accepted.questions) {
      byPart.set(index, [...(byPart.get(index) ?? []), question]);
      all.push(question);
    }
  }
  return { byPart, all };
}

/** Serialise accepted questions back into the round-trip `parts` shape. */
export function serializeInQuizState(byPart: ReadonlyMap<number, readonly QuizQuestion[]>): string {
  return JSON.stringify({
    parts: [...byPart.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partIndex, questions]) => ({ partIndex, questions })),
  });
}

export type QuizPlan = {
  requests: BatchRequest[];
  remaining: number;
  accepted: number;
  targets: number[];
  acceptedPerPart: number[];
};

/**
 * Plan the next round of requests for one study set's material parts.
 * Pure: no I/O, so the same numbers drive the prompt builder and the tests.
 */
export function planQuizBatches(args: {
  partCount: number;
  count: number;
  generatedText?: string;
  batchCap: number;
  round?: number;
  exhaustedParts?: readonly number[];
}): QuizPlan {
  const { partCount, count, batchCap } = args;
  const state = readInQuizState(args.generatedText);
  const accepted = state.all.length;
  const remaining = Math.max(0, count - accepted);
  const targets = allocateQuestionTargets(count, partCount);
  const acceptedPerPart = Array.from({ length: partCount }, (_, index) => (state.byPart.get(index) ?? []).length);
  const requests = remaining > 0
    ? planBatchRequests({
        targets,
        accepted: acceptedPerPart,
        remaining,
        batchCap,
        round: args.round ?? 0,
        ...(args.exhaustedParts?.length ? { exhausted: args.exhaustedParts } : {}),
      })
    : [];
  return { requests, remaining, accepted, targets, acceptedPerPart };
}

/** Final question list for one study set, or a precise shortfall error. */
export function finalizeQuizQuestions(args: { count: number; generatedText?: string }): QuizQuestion[] {
  const state = readInQuizState(args.generatedText);
  const questions = state.all.slice(0, args.count);
  if (questions.length !== args.count) {
    throw new Error(
      `Momentum has ${questions.length} of ${args.count} accepted questions for this quiz. Your material is preserved; retry generation to fill the remaining ${args.count - questions.length}.`,
    );
  }
  return questions;
}

export type ComprehensiveAllocation = { setId: string; count: number };

/** Split a comprehensive exam's question count across its study sets. */
export function allocateAcrossSets(count: number, setIds: readonly string[]): ComprehensiveAllocation[] {
  if (!setIds.length) return [];
  const base = Math.floor(count / setIds.length);
  let extra = count - base * setIds.length;
  return setIds.map((setId) => {
    const share = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return { setId, count: share };
  });
}

export type ComprehensivePlan = {
  allocations: ComprehensiveAllocation[];
  requests: { setId: string; partIndex: number; batchCount: number }[];
  remaining: number;
  accepted: number;
  perSet: Map<string, QuizPlan>;
};

/**
 * Plan one round of a comprehensive exam. Each set fills its own allocation
 * first; leftover questions are redistributed to sets that can still answer so
 * one thin set never starves the exam.
 */
export function planComprehensiveBatches(args: {
  sets: { id: string; partCount: number }[];
  count: number;
  generatedBySet?: readonly { setId: string; generatedText: string }[];
  batchCap: number;
  round?: number;
  exhaustedSets?: readonly string[];
}): ComprehensivePlan {
  const allocations = allocateAcrossSets(args.count, args.sets.map((set) => set.id));
  const texts = new Map((args.generatedBySet ?? []).map((item) => [item.setId, item.generatedText]));
  const perSet = new Map<string, QuizPlan>();
  const requests: { setId: string; partIndex: number; batchCount: number }[] = [];
  let acceptedTotal = 0;

  const skip = new Set(args.exhaustedSets ?? []);
  for (const allocation of allocations) {
    const set = args.sets.find((item) => item.id === allocation.setId);
    if (!set || skip.has(set.id)) continue;
    const plan = planQuizBatches({
      partCount: set.partCount,
      count: allocation.count,
      ...(texts.has(set.id) ? { generatedText: texts.get(set.id) as string } : {}),
      batchCap: args.batchCap,
      round: args.round ?? 0,
    });
    perSet.set(set.id, plan);
    acceptedTotal += plan.accepted;
    for (const request of plan.requests) {
      requests.push({ setId: set.id, partIndex: request.unit, batchCount: request.batchCount });
    }
  }

  const remaining = Math.max(0, args.count - acceptedTotal);
  const planned = requests.reduce((sum, item) => sum + item.batchCount, 0);
  let shortfall = remaining - planned;
  const exhausted = new Set(args.exhaustedSets ?? []);
  const flexible = args.sets.filter((set) => !exhausted.has(set.id) && set.partCount > 0);
  let cursor = 0;
  let guard = 0;
  while (shortfall > 0 && flexible.length && guard < flexible.length * args.batchCap * 6) {
    const set = flexible[cursor % flexible.length] as { id: string; partCount: number };
    cursor += 1;
    guard += 1;
    const ask = Math.min(Math.max(1, Math.floor(args.batchCap)), Math.max(MIN_BATCH_ASK, shortfall));
    requests.push({ setId: set.id, partIndex: (cursor + (args.round ?? 0)) % set.partCount, batchCount: ask });
    shortfall -= ask;
  }

  return { allocations, requests, remaining, accepted: acceptedTotal, perSet };
}

/**
 * Merge per-set accepted questions into one exam, de-duplicating across sets.
 * Sets that produced more than their allocation backfill others before failing.
 */
export function finalizeComprehensiveQuestions(args: {
  count: number;
  setIds: readonly string[];
  generatedBySet?: readonly { setId: string; generatedText: string }[];
  types?: readonly ("mc" | "tf" | "short")[];
}): QuizQuestion[] {
  const texts = new Map((args.generatedBySet ?? []).map((item) => [item.setId, item.generatedText]));
  const allocations = allocateAcrossSets(args.count, args.setIds);
  const registry = new QuizQuestionRegistry();
  const pools = new Map<string, QuizQuestion[]>();

  for (const setId of args.setIds) {
    const state = readInQuizState(texts.get(setId));
    const pool: QuizQuestion[] = [];
    for (const question of state.all) {
      if (args.types?.length && !args.types.includes(question.type)) continue;
      if (registry.accept(question.question) !== "unique") continue;
      pool.push(question);
    }
    pools.set(setId, pool);
  }

  const questions: QuizQuestion[] = [];
  const used = new Set<string>();
  for (const allocation of allocations) {
    const pool = pools.get(allocation.setId) ?? [];
    for (const question of pool.slice(0, allocation.count)) {
      questions.push({ ...question, setId: allocation.setId });
      used.add(`${allocation.setId}::${questionKey(question.question)}`);
    }
  }
  if (questions.length < args.count) {
    for (const allocation of allocations) {
      if (questions.length >= args.count) break;
      const pool = pools.get(allocation.setId) ?? [];
      for (const question of pool) {
        if (questions.length >= args.count) break;
        const key = `${allocation.setId}::${questionKey(question.question)}`;
        if (used.has(key)) continue;
        used.add(key);
        questions.push({ ...question, setId: allocation.setId });
      }
    }
  }
  if (questions.length < args.count) {
    throw new Error(
      `Momentum generated ${questions.length} of ${args.count} requested questions for this comprehensive exam. Your material is preserved; retry generation to fill the remaining ${args.count - questions.length}.`,
    );
  }
  return questions.slice(0, args.count);
}
