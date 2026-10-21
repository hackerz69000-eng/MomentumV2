const STOPWORDS = new Set([
  "what", "which", "when", "where", "why", "how", "does", "did", "is", "are", "was", "were",
  "the", "a", "an", "of", "to", "in", "on", "for", "from", "and", "or", "with", "according",
  "material", "lecture", "explain", "describe", "identify", "define",
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

/** Conservative local duplicate check; deliberately leaves distinct questions on the same topic alone. */
export function isNearDuplicateQuestion(candidate: string, existing: string): boolean {
  const aNorm = normalize(candidate);
  const bNorm = normalize(existing);
  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;
  if (aNorm.length >= 25 && bNorm.length >= 25 && (aNorm.includes(bNorm) || bNorm.includes(aNorm))) return true;
  const a = tokens(candidate);
  const b = tokens(existing);
  if (a.size < 3 || b.size < 3) return false;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  const overlap = intersection / Math.max(1, union);
  const largerSetCoverage = intersection / Math.max(a.size, b.size);
  const containment = intersection / Math.min(a.size, b.size);
  return overlap >= 0.78 || largerSetCoverage >= 0.8 || (containment >= 0.9 && Math.abs(a.size - b.size) <= 2);
}
