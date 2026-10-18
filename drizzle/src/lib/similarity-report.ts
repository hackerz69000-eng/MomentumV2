export type SimilarityGroup = "not-cited-or-quoted" | "missing-quotation" | "missing-citation" | "cited-and-quoted";
export type SimilaritySourceKind = "provided-source" | "internet" | "publication" | "student-paper";

export type SimilaritySource = {
  id: string;
  title: string;
  text: string;
  kind?: SimilaritySourceKind;
  url?: string;
  coverage?: "provided-text" | "full-page" | "search-snippet" | "abstract";
};

export type SimilarityMatch = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  startWord: number;
  endWord: number;
  /** Actual essay token indexes matched to this source. Gaps bridged for display are not counted. */
  matchedWordIndexes: number[];
  matchedWords: number;
  snippet: string;
  sourceSnippet?: string;
  group: SimilarityGroup;
  inBibliography: boolean;
};

export type SimilarityFilters = {
  includeQuotes: boolean;
  includeCitations: boolean;
  includeBibliography: boolean;
  minimumMatchWords: number;
  excludedSourceIds: string[];
};

export type SimilaritySourceStat = {
  id: string;
  title: string;
  kind: SimilaritySourceKind | undefined;
  url?: string;
  coverage?: "provided-text" | "full-page" | "search-snippet" | "abstract";
  matchedWords: number;
  percentage: number;
  matchCount: number;
};

export type SimilarityAnalysis = {
  wordCount: number;
  matches: SimilarityMatch[];
  sources: SimilaritySourceStat[];
  matchedWordIndexes: number[];
  percentage: number;
  coverageNote: string;
};

type Token = { value: string; raw: string; start: number; end: number; index: number };

function normalizeToken(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[’‘]/g, "'");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    tokens.push({ value: normalizeToken(raw), raw, start: match.index ?? 0, end: (match.index ?? 0) + raw.length, index: tokens.length });
  }
  return tokens;
}

function bibliographyRanges(text: string): Array<[number, number]> {
  const startPattern = /^[ \t]*(?:references|works[ \t]+cited|bibliography|literature[ \t]+cited|reference[ \t]+list|sources[ \t]+cited|bibliographic[ \t]+references)[ \t]*:?[ \t]*$/gim;
  const endPattern = /^[ \t]*(?:appendix(?:[ \t]+[a-z0-9]+)?|appendices|glossary|acknowledg(?:e)?ments?|list[ \t]+of[ \t]+figures|list[ \t]+of[ \t]+tables)[ \t]*:?[ \t]*$/gim;
  const starts = [...text.matchAll(startPattern)];
  const ranges: Array<[number, number]> = [];
  for (const start of starts) {
    const startAt = start.index ?? 0;
    const afterHeading = startAt + start[0].length;
    const rest = text.slice(afterHeading);
    const end = endPattern.exec(rest);
    endPattern.lastIndex = 0;
    const endAt = end ? afterHeading + (end.index ?? 0) : text.length;
    ranges.push([startAt, endAt]);
  }
  return ranges;
}

function insideRanges(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd);
}

function quoteRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /“[^”\n]{2,5000}”/gs,
    /„[^“\n]{2,5000}“/gs,
    /«[^»\n]{2,5000}»/gs,
    /»[^«\n]{2,5000}«/gs,
    /"[^"\n]{2,5000}"/gs,
    /『[^』\n]{2,5000}』/gs,
    /「[^」\n]{2,5000}」/gs,
    /〈[^〉\n]{2,5000}〉/gs,
    /(?<![\p{L}\p{N}])'[^'\n]{3,5000}'(?![\p{L}\p{N}])/gu,
    /^[ \t]*>[ \t]?[^\n]+(?:\n[ \t]*>[ \t]?[^\n]+)*/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      ranges.push([index, index + match[0].length]);
    }
  }
  return ranges;
}

function hasCitationNearby(text: string, start: number, end: number): boolean {
  // Keep citation detection local to the match's sentence plus a short margin. This is
  // deliberately conservative: it is a heuristic, not a replica of Turnitin's ML model.
  const leftBoundary = Math.max(text.lastIndexOf(".", start), text.lastIndexOf("!", start), text.lastIndexOf("?", start), text.lastIndexOf("\n", start)) + 1;
  const stops = [text.indexOf(".", end), text.indexOf("!", end), text.indexOf("?", end), text.indexOf("\n", end)].filter((i) => i >= 0);
  const rightBoundary = stops.length ? Math.min(...stops) + 1 : text.length;
  const nearby = text.slice(Math.max(leftBoundary, start - 90), Math.min(rightBoundary, end + 90));
  return /\([^()]{0,100}\b(?:19|20)\d{2}[a-z]?\b[^()]{0,80}\)/i.test(nearby)
    || /\b[A-Z][\p{L}'’-]+\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/u.test(nearby)
    || /\[(?:\s*\d{1,3}(?:\s*[-,;]\s*\d{1,3})*\s*)\]/.test(nearby)
    || /\b(?:according to|as cited in|cited in)\b/i.test(nearby)
    || /\b(?:p|pp|para)\.\s*\d+/i.test(nearby)
    || /\(\s*[A-Z][\p{L}'’-]+(?:\s+et\s+al\.)?\s*,?\s*(?:p\.\s*\d+|\d{4})/u.test(nearby);
}

function classify(text: string, start: number, end: number, _inBibliography: boolean, quotes: Array<[number, number]>): SimilarityGroup {
  const quoted = insideRanges(start, end, quotes);
  const cited = hasCitationNearby(text, start, end);
  if (quoted && cited) return "cited-and-quoted";
  if (quoted) return "missing-citation";
  if (cited) return "missing-quotation";
  return "not-cited-or-quoted";
}

function percent(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function boundedExcerpt(text: string, start: number, end: number, maxChars = 600): string {
  if (end - start <= maxChars) return text.slice(start, end);
  return `${text.slice(start, start + maxChars).trimEnd()} … [excerpt shortened]`;
}

/**
 * Compares text only against the source texts passed to it. Uses normalized word shingles
 * and bridges tiny unmatched gaps for display, while counting only genuinely matched words.
 * It does not have access to Turnitin's proprietary matching engine or repositories.
 */
export function analyzeSimilarity(text: string, sources: SimilaritySource[], minimumMatchWords = 8): SimilarityAnalysis {
  const essayTokens = tokenize(text);
  const wordCount = essayTokens.length;
  const matches: SimilarityMatch[] = [];
  // Longer shingles are precise; shorter shingles recover matches after small edits.
  // The final minimum-match threshold prevents isolated short/common phrases from
  // becoming reportable matches on their own.
  const seedSizes = [7, 5, 4, 3];
  const minWords = Math.max(5, Math.min(100, Math.floor(minimumMatchWords)));
  const refs = bibliographyRanges(text);
  const quotes = quoteRanges(text);

  for (const source of sources) {
    const sourceTokens = tokenize(source.text);
    if (sourceTokens.length < 4 || essayTokens.length < 4) continue;
    const matchedPairs: Array<{ essayIndex: number; sourceIndex: number }> = [];
    let processedAnchors = 0;
    for (const seedSize of seedSizes) {
      if (sourceTokens.length < seedSize || essayTokens.length < seedSize) continue;
      const sourceNgrams = new Map<string, number[]>();
      for (let i = 0; i <= sourceTokens.length - seedSize; i++) {
        const key = sourceTokens.slice(i, i + seedSize).map((token) => token.value).join(" ");
        const positions = sourceNgrams.get(key) ?? [];
        positions.push(i);
        sourceNgrams.set(key, positions);
      }
      for (let i = 0; i <= essayTokens.length - seedSize; i++) {
        const key = essayTokens.slice(i, i + seedSize).map((token) => token.value).join(" ");
        const sourcePositions = sourceNgrams.get(key);
        if (sourcePositions?.length && sourcePositions.length <= (seedSize === 3 ? 8 : 12) && processedAnchors < 2_500) {
          // Three-word anchors recover copied passages with frequent small edits, but
          // require a stricter source occurrence cap to reduce common-phrase noise.
          // Bound candidate anchors per source so repetitive documents stay predictable.
          for (const sourceStart of sourcePositions.slice(0, 2)) {
            if (processedAnchors >= 2_500) break;
            processedAnchors++;

            // Extend the exact seed in both directions. A small number of edits are
            // tolerated, but a run of three changed words ends the alignment. Only
            // equal tokens are added to matchedIndexes, so edits never inflate the score.
            let leftEssay = i - 1;
            let leftSource = sourceStart - 1;
            let leftSpan = seedSize;
            let leftMisses = 0;
            let consecutiveMisses = 0;
            let leftSkips = 0;
            while (leftEssay >= 0 && leftSource >= 0 && leftSpan < 120) {
              const essayValue = essayTokens[leftEssay]?.value;
              const sourceValue = sourceTokens[leftSource]?.value;
              leftSpan++;
              if (essayValue === sourceValue) {
                matchedPairs.push({ essayIndex: leftEssay, sourceIndex: leftSource });
                leftMisses = Math.max(0, leftMisses - 1);
                consecutiveMisses = 0;
                leftEssay--;
                leftSource--;
              } else {
                // Look ahead up to three tokens to bridge a short insertion/deletion
                // without treating the skipped words as matches. This handles phrases
                // inserted into a copied passage, not only single-word edits.
                let essaySkip = 0;
                let sourceSkip = 0;
                for (let offset = 1; offset <= 3 && leftEssay - offset >= 0; offset++) {
                  if (essayTokens[leftEssay - offset]?.value === sourceValue) { essaySkip = offset; break; }
                }
                for (let offset = 1; offset <= 3 && leftSource - offset >= 0; offset++) {
                  if (essayValue === sourceTokens[leftSource - offset]?.value) { sourceSkip = offset; break; }
                }
                if (leftSkips < 8 && (essaySkip > 0 || sourceSkip > 0) && (!sourceSkip || (essaySkip && essaySkip <= sourceSkip))) {
                  leftSkips += essaySkip;
                  leftMisses++;
                  consecutiveMisses++;
                  leftEssay -= essaySkip;
                } else if (leftSkips < 8 && sourceSkip > 0) {
                  leftSkips += sourceSkip;
                  leftMisses++;
                  consecutiveMisses++;
                  leftSource -= sourceSkip;
                } else {
                  leftMisses++;
                  consecutiveMisses++;
                  leftEssay--;
                  leftSource--;
                }
              }
              if (consecutiveMisses >= 3 || leftMisses > Math.max(2, Math.floor(leftSpan * 0.16))) break;
            }

            let rightEssay = i + seedSize;
            let rightSource = sourceStart + seedSize;
            let rightSpan = seedSize;
            let rightMisses = 0;
            let rightSkips = 0;
            consecutiveMisses = 0;
            while (rightEssay < essayTokens.length && rightSource < sourceTokens.length && rightSpan < 120) {
              const essayValue = essayTokens[rightEssay]?.value;
              const sourceValue = sourceTokens[rightSource]?.value;
              rightSpan++;
              if (essayValue === sourceValue) {
                matchedPairs.push({ essayIndex: rightEssay, sourceIndex: rightSource });
                rightMisses = Math.max(0, rightMisses - 1);
                consecutiveMisses = 0;
                rightEssay++;
                rightSource++;
              } else {
                let essaySkip = 0;
                let sourceSkip = 0;
                for (let offset = 1; offset <= 3 && rightEssay + offset < essayTokens.length; offset++) {
                  if (essayTokens[rightEssay + offset]?.value === sourceValue) { essaySkip = offset; break; }
                }
                for (let offset = 1; offset <= 3 && rightSource + offset < sourceTokens.length; offset++) {
                  if (essayValue === sourceTokens[rightSource + offset]?.value) { sourceSkip = offset; break; }
                }
                if (rightSkips < 8 && (essaySkip > 0 || sourceSkip > 0) && (!sourceSkip || (essaySkip && essaySkip <= sourceSkip))) {
                  rightSkips += essaySkip;
                  rightMisses++;
                  consecutiveMisses++;
                  rightEssay += essaySkip;
                } else if (rightSkips < 8 && sourceSkip > 0) {
                  rightSkips += sourceSkip;
                  rightMisses++;
                  consecutiveMisses++;
                  rightSource += sourceSkip;
                } else {
                  rightMisses++;
                  consecutiveMisses++;
                  rightEssay++;
                  rightSource++;
                }
              }
              if (consecutiveMisses >= 3 || rightMisses > Math.max(2, Math.floor(rightSpan * 0.16))) break;
            }
            for (let j = i; j < i + seedSize; j++) matchedPairs.push({ essayIndex: j, sourceIndex: sourceStart + (j - i) });
          }
        }
      }
    }

    // Keep essay/source token pairs instead of collapsing by essay position alone.
    // This is important when an essay reorders two copied passages: the passages are
    // both matched, but must remain separate source alignments in the report.
    const uniquePairs = [...new Map(matchedPairs.map((pair) => [`${pair.essayIndex}:${pair.sourceIndex}`, pair] as const)).values()];
    const byOffset = new Map<number, Array<{ essayIndex: number; sourceIndex: number }>>();
    for (const pair of uniquePairs) {
      const offset = pair.sourceIndex - pair.essayIndex;
      const list = byOffset.get(offset) ?? [];
      list.push(pair);
      byOffset.set(offset, list);
    }
    type MatchRange = { start: number; end: number; sourceStart: number; sourceEnd: number; matched: number[] };
    const ranges: MatchRange[] = [];
    for (const pairs of byOffset.values()) {
      pairs.sort((a, b) => a.essayIndex - b.essayIndex || a.sourceIndex - b.sourceIndex);
      let current: MatchRange | null = null;
      for (const pair of pairs) {
        const token = essayTokens[pair.essayIndex];
        if (!token) continue;
        const isBibliography = insideRanges(token.start, token.end, refs);
        const previousIndex = current?.matched[current.matched.length - 1];
        const previousToken = previousIndex === undefined ? undefined : essayTokens[previousIndex];
        const sameBibliography = previousToken ? insideRanges(previousToken.start, previousToken.end, refs) === isBibliography : true;
        const essayGap = current ? pair.essayIndex - current.end : Number.POSITIVE_INFINITY;
        const sourceGap = current ? pair.sourceIndex - current.sourceEnd : Number.POSITIVE_INFINITY;
        if (current && essayGap <= 4 && sourceGap <= 4 && sameBibliography) {
          current.end = Math.max(current.end, pair.essayIndex + 1);
          current.sourceEnd = Math.max(current.sourceEnd, pair.sourceIndex + 1);
          current.matched.push(pair.essayIndex);
        } else {
          if (current) ranges.push(current);
          current = { start: pair.essayIndex, end: pair.essayIndex + 1, sourceStart: pair.sourceIndex, sourceEnd: pair.sourceIndex + 1, matched: [pair.essayIndex] };
        }
      }
      if (current) ranges.push(current);
    }

    // Alignments on either side of a short insertion/deletion can have a small offset
    // change. Join only when both document ranges and source ranges are adjacent and the
    // offset shift is small; reordered passages and repeated distant source locations stay separate.
    ranges.sort((a, b) => a.start - b.start || a.sourceStart - b.sourceStart);
    const mergedRanges: MatchRange[] = [];
    for (const candidate of ranges) {
      let merged = false;
      for (let i = mergedRanges.length - 1; i >= 0; i--) {
        const existing = mergedRanges[i];
        if (!existing) continue;
        if (candidate.start - existing.end > 120) break;
        const essayGap = Math.max(0, Math.max(existing.start, candidate.start) - Math.min(existing.end, candidate.end));
        const sourceGap = Math.max(0, Math.max(existing.sourceStart, candidate.sourceStart) - Math.min(existing.sourceEnd, candidate.sourceEnd));
        const offsetDifference = Math.abs((existing.sourceStart - existing.start) - (candidate.sourceStart - candidate.start));
        const existingLast = essayTokens[existing.matched[existing.matched.length - 1] ?? existing.end - 1];
        const candidateFirst = essayTokens[candidate.matched[0] ?? candidate.start];
        const sameBibliography = existingLast && candidateFirst
          ? insideRanges(existingLast.start, existingLast.end, refs) === insideRanges(candidateFirst.start, candidateFirst.end, refs)
          : false;
        if (essayGap <= 4 && sourceGap <= 4 && offsetDifference <= 3 && sameBibliography) {
          existing.start = Math.min(existing.start, candidate.start);
          existing.end = Math.max(existing.end, candidate.end);
          existing.sourceStart = Math.min(existing.sourceStart, candidate.sourceStart);
          existing.sourceEnd = Math.max(existing.sourceEnd, candidate.sourceEnd);
          existing.matched = [...new Set([...existing.matched, ...candidate.matched])].sort((a, b) => a - b);
          merged = true;
          break;
        }
      }
      if (!merged) mergedRanges.push({ ...candidate, matched: [...candidate.matched] });
    }

    for (const range of mergedRanges) {
      const matched = [...new Set(range.matched)].sort((a, b) => a - b);
      if (matched.length < minWords) continue;
      const startChar = essayTokens[range.start]?.start;
      const endChar = essayTokens[range.end - 1]?.end;
      if (startChar === undefined || endChar === undefined) continue;
      const inBibliography = insideRanges(startChar, endChar, refs);
      const sourceStartWord = Math.max(0, Math.min(sourceTokens.length - 1, range.sourceStart));
      const sourceEndWord = Math.max(sourceStartWord + 1, Math.min(sourceTokens.length, range.sourceEnd));
      const sourceStartChar = sourceTokens[sourceStartWord]?.start ?? 0;
      const sourceEndChar = sourceTokens[sourceEndWord - 1]?.end ?? sourceStartChar;
      matches.push({
        id: `${source.id}:${range.start}:${range.end}:${sourceStartWord}`,
        sourceId: source.id,
        sourceTitle: source.title,
        startWord: range.start,
        endWord: range.end,
        matchedWordIndexes: matched,
        matchedWords: matched.length,
        snippet: boundedExcerpt(text, startChar, endChar),
        sourceSnippet: boundedExcerpt(source.text, sourceStartChar, sourceEndChar),
        group: classify(text, startChar, endChar, inBibliography, quotes),
        inBibliography,
      });
    }
  }

  const allMatched = new Set<number>();
  for (const match of matches) for (const index of match.matchedWordIndexes) allMatched.add(index);
  const sourceStats: SimilaritySourceStat[] = sources.map((source) => {
    const sourceMatches = matches.filter((match) => match.sourceId === source.id);
    const indexes = new Set<number>();
    for (const match of sourceMatches) for (const index of match.matchedWordIndexes) indexes.add(index);
    return {
      id: source.id,
      title: source.title,
      kind: source.kind,
      ...(source.url ? { url: source.url } : {}),
      coverage: source.coverage ?? "provided-text",
      matchedWords: indexes.size,
      percentage: percent(indexes.size, wordCount),
      matchCount: sourceMatches.length,
    };
  }).filter((source) => source.matchCount > 0)
    .sort((a, b) => b.matchedWords - a.matchedWords || sourcePriority(a.kind) - sourcePriority(b.kind));

  return {
    wordCount,
    matches: matches.sort((a, b) => a.startWord - b.startWord || b.matchedWords - a.matchedWords),
    sources: sourceStats,
    matchedWordIndexes: [...allMatched].sort((a, b) => a - b),
    percentage: percent(allMatched.size, wordCount),
    coverageNote: "This analysis compares only the source text supplied or retrieved for this run. It does not have access to Turnitin's private/institutional repositories or proprietary matching engine; a local score is not an official Turnitin score.",
  };
}

function sourcePriority(kind: SimilaritySourceKind | undefined): number {
  // The newer Turnitin Similarity Report documents Internet, Publications, then Submitted
  // Works as its best-match priority when the exact same words match multiple source types.
  if (kind === "internet") return 0;
  if (kind === "publication") return 1;
  if (kind === "student-paper") return 2;
  return 3;
}

export function filterSimilarityMatches(matches: SimilarityMatch[], filters: SimilarityFilters): SimilarityMatch[] {
  return matches.filter((match) => {
    if (filters.excludedSourceIds.includes(match.sourceId)) return false;
    if (match.matchedWords < Math.max(1, filters.minimumMatchWords)) return false;
    if (!filters.includeQuotes && (match.group === "cited-and-quoted" || match.group === "missing-citation")) return false;
    if (!filters.includeCitations && (match.group === "cited-and-quoted" || match.group === "missing-quotation")) return false;
    if (!filters.includeBibliography && match.inBibliography) return false;
    return true;
  });
}

export function scoreFilteredMatches(matches: SimilarityMatch[], wordCount: number): { matchedWords: number; percentage: number; matchedWordIndexes: number[] } {
  const indexes = new Set<number>();
  for (const match of matches) {
    const matched = match.matchedWordIndexes ?? Array.from({ length: match.endWord - match.startWord }, (_, i) => match.startWord + i);
    for (const index of matched) indexes.add(index);
  }
  return { matchedWords: indexes.size, percentage: percent(indexes.size, wordCount), matchedWordIndexes: [...indexes].sort((a, b) => a - b) };
}

export function getHighlightedTextSegments(text: string, matches: SimilarityMatch[]): Array<{ text: string; matched: boolean }> {
  const tokens = tokenize(text);
  const charRanges = matches.flatMap((match) => {
    const indexes = match.matchedWordIndexes?.length
      ? match.matchedWordIndexes
      : Array.from({ length: Math.max(0, match.endWord - match.startWord) }, (_, i) => match.startWord + i);
    return indexes.flatMap((index) => {
      const token = tokens[index];
      return token ? [[token.start, token.end] as [number, number]] : [];
    });
  }).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of charRanges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const segments: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), matched: false });
    segments.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  if (!segments.length && text) segments.push({ text, matched: false });
  return segments;
}

export function getSimilarityHighlightSegments(text: string, matches: SimilarityMatch[]): Array<{ text: string; matched: boolean; group?: SimilarityGroup }> {
  const tokens = tokenize(text);
  const ranges = matches.flatMap((match) => {
    const indexes = match.matchedWordIndexes?.length
      ? match.matchedWordIndexes
      : Array.from({ length: Math.max(0, match.endWord - match.startWord) }, (_, i) => match.startWord + i);
    return indexes.flatMap((index) => {
      const token = tokens[index];
      return token ? [{ start: token.start, end: token.end, group: match.group }] : [];
    });
  });
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
  const segments: Array<{ text: string; matched: boolean; group?: SimilarityGroup }> = [];
  const groupPriority: SimilarityGroup[] = ["not-cited-or-quoted", "missing-quotation", "missing-citation", "cited-and-quoted"];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    const activeGroups = ranges.filter((range) => range.start < end && range.end > start).map((range) => range.group);
    const group = groupPriority.find((candidate) => activeGroups.includes(candidate));
    const matched = activeGroups.length > 0;
    const previous = segments[segments.length - 1];
    if (previous && previous.matched === matched && previous.group === group) previous.text += text.slice(start, end);
    else segments.push({ text: text.slice(start, end), matched, ...(group ? { group } : {}) });
  }
  if (!segments.length && text) segments.push({ text, matched: false });
  return segments;
}
