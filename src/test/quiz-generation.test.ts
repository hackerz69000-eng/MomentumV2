import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertGenerationSourceRevision } from "@/lib/study-generation-guards";
import { normalizeQuizQuestionText, quizBatchSize, validateQuizBatch, withQuizBatchRetries, type GeneratedQuizQuestion } from "@/lib/quiz-generation";

const studyFunctions = readFileSync(resolve(process.cwd(), "src/lib/study.functions.ts"), "utf8");
const quizRunner = readFileSync(resolve(process.cwd(), "src/components/set/QuizRunner.tsx"), "utf8");

function question(index: number): GeneratedQuizQuestion {
  return { type: "mc", question: `Question ${index}?`, options: ["A", "B", "C", "D"], answer: 0, answerText: "A", explanation: "The material supports A.", topic: "Topic" };
}

describe("reliable quiz batches", () => {
  it.each([20, 30, 40, 50, 60])("fills exactly %i supported questions through small sequential batches", (requested) => {
    const batchSize = quizBatchSize("5");
    const accepted: GeneratedQuizQuestion[] = [];
    let cursor = 0;
    let requests = 0;
    while (accepted.length < requested) {
      const target = Math.min(batchSize, requested - accepted.length);
      const raw = Array.from({ length: target }, () => question(cursor++));
      accepted.push(...validateQuizBatch(raw, accepted.map((item) => item.question)));
      requests += 1;
    }
    expect(accepted).toHaveLength(requested);
    expect(requests).toBe(Math.ceil(requested / batchSize));
    expect(requests).toBeGreaterThan(1);
  });

  it("bounds the configurable batch size and rejects malformed or duplicate questions", () => {
    expect(quizBatchSize("99")).toBe(6);
    expect(quizBatchSize("1")).toBe(3);
    expect(quizBatchSize("bad")).toBe(5);
    const result = validateQuizBatch([
      question(1),
      { ...question(1), question: "Question 1" },
      { ...question(2), options: ["same", "SAME", "C", "D"] },
    ]);
    expect(result).toHaveLength(1);
    expect(normalizeQuizQuestionText("Question 1?! ")).toBe("question 1");
  });

  it("retries a failed or malformed batch without replacing previously completed questions", async () => {
    const completed = [question(1), question(2)];
    const operation = vi.fn().mockRejectedValueOnce(new Error("Malformed JSON")).mockResolvedValueOnce([question(3)]);
    const result = await withQuizBatchRetries(operation, { delay: async () => undefined });
    expect(result).toEqual([question(3)]);
    expect(completed).toHaveLength(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("preserves a completed batch when a later batch times out, then resumes with missing questions", async () => {
    const completed = [question(1), question(2), question(3)];
    const failed = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(withQuizBatchRetries(failed, { attempts: 2, delay: async () => undefined })).rejects.toThrow("timeout");
    const resumed = validateQuizBatch([question(4), question(5)], completed.map((item) => item.question));
    expect([...completed, ...resumed]).toHaveLength(5);
    expect(completed).toHaveLength(3);
  });

  it("deduplicates retries and rejects stale progress after a source edit", () => {
    const completed = [question(1)];
    const retry = validateQuizBatch([question(1), question(2)], completed.map((item) => item.question));
    expect(retry.map((item) => item.question)).toEqual(["Question 2?"]);
    expect(() => assertGenerationSourceRevision("source-before", "source-after")).toThrow(/outdated result was not saved/i);
  });

  it("uses configurable small batches, persists progress, validates before counting, and checks the source again at finalization", () => {
    expect(studyFunctions).toMatch(/quizBatchSize\(process\.env\["QUIZ_GENERATION_BATCH_SIZE"\]\)/);
    expect(studyFunctions).toMatch(/count: z\.number\(\)\.int\(\)\.min\(3\)\.max\(60\)/);
    expect(studyFunctions).toMatch(/already = validPriorParts\.get\(partIndex\)/);
    expect(studyFunctions).toMatch(/currentQuizSeen\.has\(key\)/);
    expect(quizRunner).toMatch(/saveParts\(progressKey, sourceRevision, generatedByPart\)/);
    expect(quizRunner).toMatch(/validateQuizBatch\(raw, seen\)/);
    expect(quizRunner).toMatch(/generatedText, sourceRevision/);
    expect(quizRunner).toMatch(/sourceRevisions, generatedBySet/);
    expect(quizRunner).toMatch(/\[5, 10, 20, 30, 40, 50, 60\]/);
  });
});
