import { describe, expect, it } from "vitest";
import { analyzeSimilarity, filterSimilarityMatches, scoreFilteredMatches, getSimilarityHighlightSegments, type SimilaritySource } from "@/lib/similarity-report";

describe("local similarity pre-check", () => {
  const essay = "The quick brown fox jumps over the lazy dog and then runs across the green field. This second sentence is entirely original to the essay.";
  const sources: SimilaritySource[] = [
    { id: "s1", title: "Reference A", text: "A note: the quick brown fox jumps over the lazy dog and then runs across the green field. Additional source material." },
    { id: "s2", title: "Reference B", text: "Another text says the quick brown fox jumps over the lazy dog and then runs across the green field too." },
  ];

  it("finds exact phrase matches and counts overlapping-source words only once in the overall score", () => {
    const report = analyzeSimilarity(essay, sources, 8);
    expect(report.matches.length).toBeGreaterThanOrEqual(2);
    expect(report.sources).toHaveLength(2);
    expect(report.percentage).toBeGreaterThan(0);
    expect(report.percentage).toBeLessThanOrEqual(100);
    expect(report.coverageNote).toContain("does not search Turnitin's");
  });

  it("filters short matches and recalculates the visible match rate", () => {
    const report = analyzeSimilarity(essay, sources, 8);
    const visible = filterSimilarityMatches(report.matches, {
      includeQuotes: true,
      includeCitations: true,
      includeBibliography: true,
      minimumMatchWords: 20,
      excludedSourceIds: [],
    });
    const score = scoreFilteredMatches(visible, report.wordCount);
    expect(visible.every((match) => match.matchedWords >= 20)).toBe(true);
    expect(score.percentage).toBeLessThanOrEqual(report.percentage);
  });

  it("supports quote and bibliography filters without calling similarity plagiarism", () => {
    const phrase = "democracy requires citizens to participate in public life and deliberate about common political questions";
    const source = [{ id: "quoted", title: "Reference", text: `Intro ${phrase} conclusion` }];
    const quoted = analyzeSimilarity(`The author writes “${phrase}” (Smith, 2020).`, source);
    expect(quoted.matches[0]?.group).toBe("cited-and-quoted");
    expect(filterSimilarityMatches(quoted.matches, { includeQuotes: false, includeCitations: true, includeBibliography: true, minimumMatchWords: 8, excludedSourceIds: [] })).toHaveLength(0);
    const bibliography = analyzeSimilarity(`References\n${phrase}.`, source);
    expect(bibliography.matches[0]?.inBibliography).toBe(true);
    expect(filterSimilarityMatches(bibliography.matches, { includeQuotes: true, includeCitations: true, includeBibliography: false, minimumMatchWords: 8, excludedSourceIds: [] })).toHaveLength(0);
  });

  it("does not invent matches when no supplied source contains the essay phrases", () => {
    const report = analyzeSimilarity(essay, [{ id: "x", title: "Unrelated", text: "Plants require sunlight, water, soil, and nutrients to grow healthy roots." }]);
    expect(report.matches).toHaveLength(0);
    expect(report.percentage).toBe(0);
  });
});

describe("similarity matching quality", () => {
  it("normalizes capitalization and diacritics before comparing word shingles", () => {
    const essayText = "Representative government requires citizens to participate in public debate and deliberate about shared political questions every day.";
    const sourceText = "REPRESENTATIVE government requires citizens to participate in public debate and déliberate about shared political questions every day.";
    const report = analyzeSimilarity(essayText, [{ id: "normalized", title: "Normalized source", text: sourceText }]);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.percentage).toBeGreaterThan(0);
  });

  it("bridges a tiny changed-word gap for display without counting the changed word as matched", () => {
    const essayText = "The representative government depends on citizens participating actively in public debate and political deliberation among the population.";
    const sourceText = "The representative government depends on citizens participating regularly in public debate and political deliberation among the population.";
    const report = analyzeSimilarity(essayText, [{ id: "near", title: "Near match", text: sourceText }]);
    const match = report.matches[0];
    expect(match).toBeDefined();
    expect(match!.matchedWords).toBeLessThan(match!.endWord - match!.startWord);
    expect(match!.matchedWordIndexes.length).toBe(match!.matchedWords);
    expect(match!.sourceSnippet).toContain("regularly");
  });

  it("recovers a long near-match when one changed word breaks five-word shingles", () => {
    const essayText = "careful researchers compare multiple independent sources before drawing reliable conclusions about complex historical events";
    const sourceText = "careful researchers compare multiple different sources before drawing reliable conclusions about complex historical events";
    const report = analyzeSimilarity(essayText, [{ id: "near-edit", title: "Near edit", text: sourceText }], 8);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]?.matchedWords).toBeGreaterThanOrEqual(8);
    expect(report.percentage).toBeGreaterThan(0);
  });

  it("stops bibliography exclusion at an appendix heading", () => {
    const phrase = "democracy requires citizens to participate in public life and deliberate about common political questions";
    const text = `References\n${phrase}\nAppendix\n${phrase}`;
    const report = analyzeSimilarity(text, [{ id: "source", title: "Source", text: phrase }]);
    expect(report.matches.some((match) => match.inBibliography)).toBe(true);
    expect(report.matches.some((match) => !match.inBibliography)).toBe(true);
  });
});

describe("similarity regression benchmarks", () => {
  it("recovers a long passage after several isolated word substitutions without counting substitutions", () => {
    const essayText = "Researchers should compare multiple independent sources before they draw reliable conclusions about complex historical events and public policy decisions.";
    const sourceText = "Researchers must compare multiple independent sources before they reach reliable conclusions about complex historical events and public policy decisions.";
    const report = analyzeSimilarity(essayText, [{ id: "edited", title: "Edited source", text: sourceText }], 10);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]!.matchedWords).toBeLessThan(report.matches[0]!.endWord - report.matches[0]!.startWord);
    expect(report.matches[0]!.matchedWords).toBeGreaterThanOrEqual(10);
  });

  it("does not highlight changed words that were bridged only to display a near-match span", () => {
    const essayText = "Researchers compare multiple independent sources before drawing reliable conclusions about history.";
    const sourceText = "Researchers compare multiple different sources before drawing reliable conclusions about history.";
    const report = analyzeSimilarity(essayText, [{ id: "edited", title: "Edited source", text: sourceText }], 7);
    const segments = getSimilarityHighlightSegments(essayText, report.matches);
    const changedWord = segments.find((segment) => segment.text.includes("independent"));
    expect(changedWord?.matched).toBe(false);
  });

  it("continues a passage across a single inserted source word without counting the insertion", () => {
    const essayText = "Careful researchers compare multiple independent sources before drawing reliable conclusions about complex historical events and public policy decisions.";
    const sourceText = "Careful researchers compare multiple independent primary sources before drawing reliable conclusions about complex historical events and public policy decisions.";
    const report = analyzeSimilarity(essayText, [{ id: "inserted", title: "Source with inserted word", text: sourceText }], 10);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]!.matchedWords).toBeGreaterThanOrEqual(10);
    expect(report.percentage).toBeGreaterThan(50);
  });

  it("continues a passage when the essay inserts a short phrase into otherwise matching text", () => {
    const essayText = "Careful researchers compare multiple independent sources systematically before drawing reliable conclusions about complex historical events and public policy decisions.";
    const sourceText = "Careful researchers compare multiple independent sources before drawing reliable conclusions about complex historical events and public policy decisions.";
    const report = analyzeSimilarity(essayText, [{ id: "essay-insertion", title: "Source without inserted phrase", text: sourceText }], 10);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]!.matchedWords).toBeGreaterThanOrEqual(10);
    const segments = getSimilarityHighlightSegments(essayText, report.matches);
    expect(segments.find((segment) => segment.text.includes("systematically"))?.matched).toBe(false);
  });

  it("bridges a short inserted phrase while leaving its words unhighlighted", () => {
    const essayText = "Careful researchers compare multiple independent sources using a consistent and transparent method before drawing reliable conclusions about complex historical events and public policy decisions.";
    const sourceText = "Careful researchers compare multiple independent sources before drawing reliable conclusions about complex historical events and public policy decisions.";
    const report = analyzeSimilarity(essayText, [{ id: "phrase-insertion", title: "Source", text: sourceText }], 10);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]!.matchedWords).toBeGreaterThanOrEqual(10);
    const segments = getSimilarityHighlightSegments(essayText, report.matches);
    expect(segments.find((segment) => segment.text.includes("consistent"))?.matched).toBe(false);
  });

  it("keeps unrelated text at zero similarity even when it shares ordinary academic vocabulary", () => {
    const essayText = "Researchers should compare multiple independent sources before they draw reliable conclusions about complex historical events and public policy decisions.";
    const unrelated = "Students often develop useful study habits through practice, reflection, organization, and regular review of course materials.";
    const report = analyzeSimilarity(essayText, [{ id: "unrelated", title: "Unrelated source", text: unrelated }], 8);
    expect(report.matches).toHaveLength(0);
    expect(report.percentage).toBe(0);
  });

  it("matches reordered copied passages without requiring the original sentence order", () => {
    const first = "Climate adaptation requires local planning, resilient infrastructure, reliable public data, and long-term investment in vulnerable communities.";
    const second = "Effective emergency preparation depends on clear communication, trusted institutions, accessible evacuation routes, and coordinated response teams.";
    const essayText = `${second} ${first}`;
    const report = analyzeSimilarity(essayText, [{ id: "reordered", title: "Source with both passages", text: `${first} ${second}` }], 8);
    expect(report.matches.length).toBeGreaterThanOrEqual(2);
    expect(report.percentage).toBeGreaterThan(60);
  });

  it("does not promote highly repeated boilerplate shingles into source matches", () => {
    const boilerplate = Array.from({ length: 40 }, () => "The results of this study show that the findings are important for future research and practical applications.").join(" ");
    const essayText = "Students improve their understanding by reviewing feedback, testing their knowledge, organizing notes, and revisiting difficult concepts throughout the semester.";
    const report = analyzeSimilarity(essayText, [{ id: "boilerplate", title: "Repeated boilerplate", text: boilerplate }], 8);
    expect(report.matches).toHaveLength(0);
    expect(report.percentage).toBe(0);
  });

  it("counts overlapping source matches once in the overall score but preserves each source attribution", () => {
    const essayText = "A distinctive passage contains several uncommon terms that make source attribution easier and demonstrate how repeated wording can be detected across documents.";
    const phrase = "distinctive passage contains several uncommon terms that make source attribution easier and demonstrate how repeated wording can be detected";
    const report = analyzeSimilarity(essayText, [
      { id: "source-a", title: "Source A", text: phrase },
      { id: "source-b", title: "Source B", text: `An example: ${phrase}.` },
    ], 8);
    expect(report.sources.length).toBeGreaterThanOrEqual(2);
    const attributedWordTotal = report.sources.reduce((sum, source) => sum + source.matchedWords, 0);
    expect(attributedWordTotal).toBeGreaterThanOrEqual(report.matchedWordIndexes.length);
    expect(report.percentage).toBeLessThanOrEqual(100);
  });

  it("recovers a long copied passage when frequent small edits break every four-word shingle", () => {
    const essayText = "Careful researchers systematically compare multiple independent sources before drawing reliable conclusions about complex historical events and important public policy decisions.";
    const sourceText = "Careful analysts compare multiple independent records before drawing reliable conclusions about complex historical events and important public policy decisions.";
    const report = analyzeSimilarity(essayText, [{ id: "frequent-edits", title: "Frequently edited source", text: sourceText }], 8);
    expect(report.matches.length).toBeGreaterThan(0);
    expect(report.matches[0]!.matchedWords).toBeGreaterThanOrEqual(8);
    expect(report.percentage).toBeGreaterThan(0);
  });

  it("does not report a short common phrase just because three-word anchors are enabled", () => {
    const essayText = "This is a simple way to learn faster.";
    const sourceText = "This is a simple method to learn better.";
    const report = analyzeSimilarity(essayText, [{ id: "common-phrase", title: "Common phrase source", text: sourceText }], 8);
    expect(report.matches).toHaveLength(0);
    expect(report.percentage).toBe(0);
  });

});
