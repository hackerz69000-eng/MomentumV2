export type FlashcardDraft = { q: string; a: string; t?: string; kind?: "qa" | "cloze" };

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "does", "for", "from", "how", "in", "into", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);

export function normalizeFlashcardPrompt(value: string): string {
  return value.toLowerCase()
    .replace(/\{\{c\d+::(.*?)\}\}/g, "$1")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(value.toLowerCase()
    .replace(/\{\{c\d+::(.*?)\}\}/g, "$1")
    .match(/[a-z0-9]{3,}/g)?.filter((token) => !STOP_WORDS.has(token)) ?? []);
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / Math.min(a.size, b.size);
}

function diceSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const normalized = normalizeFlashcardPrompt(value);
    const result = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) result.add(normalized.slice(i, i + 2));
    return result;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const gram of left) if (right.has(gram)) common++;
  return (2 * common) / (left.size + right.size);
}

export function isValidClozePrompt(value: string): boolean {
  const matches = [...value.matchAll(/\{\{c1::(.+?)\}\}/g)];
  if (matches.length !== 1 || !matches[0]?.[1]?.trim()) return false;
  const context = value.replace(/\{\{c1::(.+?)\}\}/g, " ").replace(/[_…]+/g, " ").trim();
  const words = context.match(/[a-z0-9]{2,}/gi) ?? [];
  return words.length >= 5 && context.length >= 28;
}

export function deduplicateFlashcards<T extends FlashcardDraft>(cards: T[]): T[] {
  const accepted: T[] = [];
  const exact = new Set<string>();
  for (const card of cards) {
    const key = normalizeFlashcardPrompt(card.q);
    if (!key || exact.has(key) || (card.kind === "cloze" && !isValidClozePrompt(card.q))) continue;
    const qTokens = meaningfulTokens(card.q);
    const aTokens = meaningfulTokens(card.a);
    const duplicate = accepted.some((prior) => {
      const priorQ = meaningfulTokens(prior.q);
      const priorA = meaningfulTokens(prior.a);
      const qOverlap = overlapRatio(qTokens, priorQ);
      const answerOverlap = overlapRatio(aTokens, priorA);
      const sameAnswer = normalizeFlashcardPrompt(card.a) === normalizeFlashcardPrompt(prior.a);
      return diceSimilarity(card.q, prior.q) >= 0.9 ||
        (sameAnswer && qOverlap >= 0.5) ||
        (qOverlap >= 0.82 && answerOverlap >= 0.75) ||
        (qOverlap >= 0.9 && answerOverlap >= 0.55);
    });
    if (duplicate) continue;
    exact.add(key);
    accepted.push(card);
  }
  return accepted;
}

export function targetFlashcardCount(material: string): number {
  const words = (material.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  if (words < 150) return 5;
  if (words < 400) return 7;
  if (words < 800) return 10;
  if (words < 1400) return 14;
  if (words < 2200) return 18;
  if (words < 3200) return 22;
  if (words < 4500) return 28;
  if (words < 6500) return 34;
  return 40;
}
