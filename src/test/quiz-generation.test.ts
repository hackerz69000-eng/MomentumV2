import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertGenerationSourceRevision } from "@/lib/study-generation-guards";
import { extractNumberedQuestionSection, generateValidatedQuizBatch, inspectQuizBatch, isDuplicateQuestionText, normalizeQuizQuestionText, quizBatchSize, sanitizeQuizResumeParts, uniqueQuestionTexts, validateQuizBatch, withQuizBatchRetries, type GeneratedQuizQuestion } from "@/lib/quiz-generation";

const studyFunctions = readFileSync(resolve(process.cwd(), "src/lib/study.functions.ts"), "utf8");
const quizRunner = readFileSync(resolve(process.cwd(), "src/components/set/QuizRunner.tsx"), "utf8");
const activeRecall = readFileSync(resolve(process.cwd(), "src/components/set/ActiveRecall.tsx"), "utf8");
const mistakeBank = readFileSync(resolve(process.cwd(), "src/components/set/MistakeBank.tsx"), "utf8");
const audioStudy = readFileSync(resolve(process.cwd(), "src/lib/audio-study.functions.ts"), "utf8");
const lectureCards = readFileSync(resolve(process.cwd(), "src/lib/lecture.functions.ts"), "utf8");
const readingCards = readFileSync(resolve(process.cwd(), "src/lib/reading.functions.ts"), "utf8");
const flashcardComponent = readFileSync(resolve(process.cwd(), "src/components/set/Flashcards.tsx"), "utf8");
const readingCompanion = readFileSync(resolve(process.cwd(), "src/components/set/ReadingCompanion.tsx"), "utf8");
const questionRegistryMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261106000000_generated_question_registry.sql"), "utf8");
const aiStreamClient = readFileSync(resolve(process.cwd(), "src/lib/ai-stream.client.ts"), "utf8");
const aiStreamRoute = readFileSync(resolve(process.cwd(), "src/routes/api/ai-stream.ts"), "utf8");

function question(index: number): GeneratedQuizQuestion {
  return { type: "mc", question: `Question ${index}?`, options: ["A", "B", "C", "D"], answer: 0, answerText: "A", explanation: "The material supports A.", topic: "Topic" };
}

describe("reliable quiz batches", () => {
  it.each([20, 30, 40, 50, 60])("fills exactly %i supported questions through small sequential batches", async (requested) => {
    const batchSize = quizBatchSize("5");
    const accepted: GeneratedQuizQuestion[] = [];
    let cursor = 0;
    let requests = 0;
    while (accepted.length < requested) {
      const target = Math.min(batchSize, requested - accepted.length);
      const batch = await generateValidatedQuizBatch(target, accepted, [], async () => {
        requests += 1;
        return { questions: Array.from({ length: target }, () => question(cursor++)) };
      });
      accepted.push(...batch);
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

  it("catches punctuation, choice-order, and close-paraphrase duplicates but allows distinct aspects of one topic", () => {
    expect(uniqueQuestionTexts(Array.from({ length: 20 }, (_, index) => ({ question: `Study question ${index + 1} about Topic ${((index) % 6) + 1}?` })))).toHaveLength(20);
    expect(isDuplicateQuestionText("WHAT causes osmosis?!", ["What causes osmosis?"])).toBe(true);
    expect(isDuplicateQuestionText("Explain the role of mitochondria in ATP production", ["Describe mitochondria's function in producing ATP."])).toBe(true);
    expect(isDuplicateQuestionText("Which organelle produces ATP?", ["Which organelle stores genetic information?"])).toBe(false);
    expect(isDuplicateQuestionText("How does ATP affect glycolysis?", ["What is ATP?"])).toBe(false);
    expect(isDuplicateQuestionText("What is ATP?", ["Define ATP"])).toBe(true);
    expect(uniqueQuestionTexts([
      { question: "Define osmosis" },
      { question: "What is osmosis?" },
      { question: "How does temperature affect osmosis?" },
    ])).toHaveLength(2);
  });

  it("rejects paraphrased duplicates across earlier batches and recovered progress", () => {
    const prior = [question(1)];
    prior[0]!.question = "What causes osmosis across a membrane?";
    const recovered = validateQuizBatch([
      { ...question(2), question: "Explain what causes osmosis across membranes." },
      { ...question(3), question: "How does temperature affect osmosis?" },
    ], prior.map((item) => item.question));
    expect(recovered.map((item) => item.question)).toEqual(["How does temperature affect osmosis?"]);
  });

  it("wires all current structured question generators through the shared uniqueness guard", () => {
    expect(quizRunner).toMatch(/generateValidatedQuizBatch/);
    expect(activeRecall).toMatch(/uniqueQuestionTexts/);
    expect(mistakeBank).toMatch(/generateValidatedQuizBatch/);
    expect(audioStudy).toMatch(/isDuplicateQuestionText/);
    expect(lectureCards).toMatch(/uniqueQuestionTexts/);
    expect(readingCards).toMatch(/uniqueQuestionTexts/);
    expect(flashcardComponent).toMatch(/uniqueQuestionTexts/);
    expect(readingCompanion).toMatch(/uniqueQuestionTexts/);
    expect(studyFunctions).toMatch(/extractGuidePracticeQuestions/);
    expect(studyFunctions).toMatch(/uniqueQuestionTexts\(practiceQuestions/);
    expect(studyFunctions).toMatch(/isDuplicateQuestionText\(question\.question/);
  });

  it("extracts questions only from the named Markdown practice section", () => {
    expect(extractNumberedQuestionSection("## Overview\n1. not a question\n## Check your understanding\n1. What causes X?\n2. How does Y work?\n## Answer key\n1. Answer", "Check your understanding")).toEqual(["What causes X?", "How does Y work?"]);
  });

  it("accepts equivalent JSON wrappers and provider field names only after strict normalization", () => {
    const payload = { data: { items: [{
      question_type: "multiple_choice", prompt: "What is the cell's control center?", choices: { A: "Nucleus", B: "Membrane", C: "Ribosome", D: "Wall" },
      correct_answer: "A", rationale: "The source identifies the nucleus as the control center.", category: "Cell biology",
    }] } };
    const result = inspectQuizBatch(payload);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({ type: "mc", answer: 0, answerText: "Nucleus", explanation: expect.stringContaining("source") });
    expect(inspectQuizBatch(JSON.stringify(payload)).questions).toHaveLength(1);
    expect(inspectQuizBatch({ questions: [{ question: "incomplete", type: "mc" }] }).invalidCount).toBe(1);
  });

  it("retries malformed JSON with corrective instructions", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("The AI returned incomplete or malformed structured data."))
      .mockResolvedValueOnce({ questions: [question(1)] });
    const result = await generateValidatedQuizBatch(1, [], [], async (feedback) => {
      if (feedback) expect(feedback).toMatch(/previous reply could not be parsed/i);
      return request(feedback);
    });
    expect(result).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps retry feedback focused on current questions and the newest history", async () => {
    const history = Array.from({ length: 100 }, (_, index) => `Historical question ${index}`);
    const current = question(900);
    current.question = "Current batch question";
    await generateValidatedQuizBatch(2, [current], history, async (feedback, attempt) => {
      if (attempt === 1) {
        expect(feedback).toContain("Current batch question");
        expect(feedback).toContain("Historical question 0");
        expect(feedback).not.toContain("Historical question 99");
        return { questions: [question(901)] };
      }
      return { questions: [{ ...question(900), question: "Current batch question" }, question(902)] };
    });
  });

  it("keeps valid questions from a partly invalid response and asks only for missing replacements", async () => {
    const request = vi.fn();
    const result = await generateValidatedQuizBatch(3, [], [], async (feedback, attempt) => {
      request(feedback, attempt);
      if (attempt === 0) return { questions: [question(1), { question: "Bad", type: "mc" }, question(1)] };
      expect(feedback).toContain("1 invalid item(s)");
      expect(feedback).toContain("1 duplicate item(s)");
      expect(feedback).toContain("exactly 2 replacement question(s)");
      return { questions: [question(2), question(3)] };
    });
    expect(result.map((item) => item.question)).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries structurally valid questions whose type was not selected", async () => {
    const trueFalse = { type: "tf", question: "Is this a test?", options: ["True", "False"], answer: 0, answerText: "True", explanation: "Supported.", topic: "Topic" };
    const result = await generateValidatedQuizBatch(2, [], [], async (feedback, attempt) => {
      if (attempt === 1) {
        expect(feedback).toContain("exactly 1 replacement question");
        expect(feedback).toContain("only these requested question types: mc");
        return { questions: [question(2)] };
      }
      return { questions: [question(1), trueFalse] };
    }, { allowedTypes: ["mc"] });
    expect(result.map((item) => item.type)).toEqual(["mc", "mc"]);
  });

  it("reports normalized recent duplicates without rejecting distinct Unicode questions", () => {
    const result = inspectQuizBatch([question(1), { ...question(2), question: "¿Qué es la célula?" }], ["question 1?", "¿Qué es otra cosa?"]);
    expect(result.duplicateCount).toBe(1);
    expect(result.questions.map((item) => item.question)).toEqual(["¿Qué es la célula?"]);
  });

  it("separates exact, near, and semantic duplicate counters", () => {
    const seen = [
      "WHAT causes osmosis?!",
      "Which sequence of events occurs during aerobic cellular respiration in mitochondria and produces the most ATP energy?",
      "Define osmosis",
    ];
    const result = inspectQuizBatch([
      { ...question(1), question: "What causes osmosis?" },
      { ...question(2), question: "Which sequence of stages occurs during aerobic cellular respiration in mitochondria and produces the most ATP energy?" },
      { ...question(3), question: "What is osmosis?" },
    ], seen);
    expect(result).toMatchObject({ duplicateCount: 3, exactDuplicateCount: 1, nearDuplicateCount: 1, semanticDuplicateCount: 1 });
    expect(result.duplicateFingerprints).toHaveLength(3);
  });

  it("recovers the reported 2-of-20 stall when later source parts receive live accepted-question context", async () => {
    const restoreLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    localStorage.setItem("momentum:quiz-diagnostics", "enabled");
    const completed: GeneratedQuizQuestion[] = [];
    let cursor = 3;
    const makeSupported = (index: number) => ({
      ...question(index),
      question: `Which mechanism best explains how concept ${index} changes the outcome in its study example?`,
      topic: `Topic ${Math.ceil(index / 4)}`,
      explanation: `The source describes mechanism ${index} and its specific outcome.`,
    });
    try {
      // First source part: the model returns two supported items, then repeats
      // them on both replacement requests, reproducing the accepted 2/5 state.
      const partial = await generateValidatedQuizBatch(5, completed, [], async (_feedback, attempt) => {
        if (attempt === 0) return { questions: [makeSupported(1), makeSupported(2)] };
        return { questions: [makeSupported(1), makeSupported(2), makeSupported(1)] };
      }, { diagnostics: { requestedTotal: 20, completedCount: 0, sourcePartIndex: 0, sourceChars: 900, sourceFingerprint: "source-part-0" } });
      expect(partial).toHaveLength(2);
      completed.push(...partial);

      // The following pre-planned source parts are generated after part zero.
      // Their first response must be given the questions already accepted.
      for (let partIndex = 1; partIndex < 4; partIndex += 1) {
        const batch = await generateValidatedQuizBatch(5, completed, [], async (_feedback, attempt, requestId, usedQuestions) => {
          expect(attempt).toBe(0);
          expect(requestId).toContain("-");
          expect(usedQuestions).toEqual(expect.arrayContaining(completed.map((item) => item.question)));
          return { questions: Array.from({ length: 5 }, () => makeSupported(cursor++)) };
        }, { diagnostics: { requestedTotal: 20, completedCount: completed.length, sourcePartIndex: partIndex, sourceChars: 800, sourceFingerprint: `source-part-${partIndex}` } });
        completed.push(...batch);
      }

      // Planner revisits the unfinished part and requests its exact remainder.
      const remainder = await generateValidatedQuizBatch(3, completed, [], async (_feedback, attempt, _requestId, usedQuestions) => {
        expect(attempt).toBe(0);
        expect(usedQuestions).toHaveLength(17);
        return { questions: Array.from({ length: 3 }, () => makeSupported(cursor++)) };
      }, { diagnostics: { requestedTotal: 20, completedCount: completed.length, sourcePartIndex: 0, sourceChars: 900, sourceFingerprint: "source-part-0" } });
      completed.push(...remainder);
      expect(completed).toHaveLength(20);
      expect(new Set(completed.map((item) => item.question)).size).toBe(20);
      const responseEvents = restoreLog.mock.calls.map(([, event]) => event as { event?: string; requestId?: string; responseFingerprint?: string; responseFresh?: boolean; completedBeforeBatch?: number; usedQuestionContextCount?: number });
      expect(responseEvents.filter((event) => event.event === "quiz_batch_response").length).toBeGreaterThan(4);
      expect(responseEvents.every((event) => !!event.requestId && !!event.responseFingerprint)).toBe(true);
      expect(responseEvents.some((event) => event.responseFresh === false)).toBe(true);
      expect(responseEvents.some((event) => (event.usedQuestionContextCount ?? 0) >= 2)).toBe(true);
    } finally {
      localStorage.removeItem("momentum:quiz-diagnostics");
      restoreLog.mockRestore();
    }
  });

  it("retries alternative grouped response shapes and reports malformed JSON payloads", async () => {
    const response = { multiple_choice_questions: [{ prompt: "What is 2 + 2?", choices: ["4", "3", "5", "6"], correct_answer: "4", explanation: "Arithmetic." }] };
    const result = await generateValidatedQuizBatch(1, [], [], async () => response);
    expect(result[0]).toMatchObject({ question: "What is 2 + 2?", answer: 0 });
    expect(inspectQuizBatch("{ malformed json").formatError).toMatch(/malformed JSON/i);
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

  it("bounds resumed progress to real source parts and each part's allocation", () => {
    const result = sanitizeQuizResumeParts([
      { partIndex: -1, questions: [question(1)] },
      { partIndex: 8, questions: [question(2)] },
      { partIndex: 0, questions: [question(3), question(4), question(5)] },
      { partIndex: 1, questions: [question(3), question(6)] },
    ], [2, 2], [], ["mc"]);
    expect(result.get(0)?.map((item) => item.question)).toEqual(["Question 3?", "Question 4?"]);
    expect(result.get(1)?.map((item) => item.question)).toEqual(["Question 6?"]);
    expect([...result.values()].flat()).toHaveLength(3);
  });

  it("uses configurable small batches, persists progress, validates before counting, and checks the source again at finalization", () => {
    expect(studyFunctions).toMatch(/quizBatchSize\(process\.env\["QUIZ_GENERATION_BATCH_SIZE"\]\)/);
    expect(studyFunctions).toMatch(/count: z\.number\(\)\.int\(\)\.min\(3\)\.max\(60\)/);
    expect(studyFunctions).toMatch(/already = validPriorParts\.get\(partIndex\)/);
    expect(studyFunctions).toMatch(/isDuplicateQuestionText\(question\.question/);
    expect(quizRunner).toMatch(/saveParts\(progressKey, sourceRevision, generationId, generatedByPart\)/);
    expect(quizRunner).toMatch(/generateValidatedQuizBatch\(prompt\.batchCount/);
    expect(quizRunner).toMatch(/extractQuizQuestionArray\(value\)/);
    expect(quizRunner).toMatch(/generatedText, sourceRevision/);
    expect(quizRunner).toMatch(/sourceRevisions, databaseSourceRevisions, generatedBySet/);
    expect(quizRunner).toMatch(/\[5, 10, 20, 30, 40, 50, 60\]/);
  });

  it("uses an atomic, user-scoped database reservation for finalized quizzes", () => {
    expect(studyFunctions).toMatch(/reserve_assessment_questions/);
    expect(studyFunctions).toMatch(/generated_assessment_questions/);
    expect(quizRunner).toMatch(/generationId/);
    expect(questionRegistryMigration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(questionRegistryMigration).toMatch(/pg_advisory_xact_lock/);
    expect(questionRegistryMigration).toMatch(/ON CONFLICT \(user_id, set_id, normalized_question\) DO NOTHING/);
    expect(questionRegistryMigration).toMatch(/REVOKE INSERT, UPDATE, DELETE/);
  });

  it("sends accepted questions with every later pre-planned batch and correlates uncached provider requests", () => {
    expect(quizRunner).toMatch(/QUESTIONS ALREADY GENERATED OR USED FOR THIS MATERIAL/);
    expect(quizRunner).toContain("diagnosticFingerprint(typeof prompt.messages[0]?.content");
    expect(studyFunctions).toMatch(/MATERIAL PART \$\{partIndex \+ 1\}/);
    expect(studyFunctions).toMatch(/\$\{part\}/);
    expect(aiStreamClient).toMatch(/cache: "no-store"/);
    expect(aiStreamClient).toMatch(/X-Momentum-Request-ID/);
    expect(aiStreamClient).toMatch(/response\.headers\.get\("x-momentum-request-id"\)/);
    expect(aiStreamRoute).toMatch(/"cache-control": "no-store, no-cache, no-transform"/);
    expect(aiStreamRoute).toMatch(/"x-momentum-request-id": requestId/);
  });
});
