import { describe, expect, it } from "vitest";
import {
  MAX_GENERATION_ROUNDS,
  QUESTIONS_PER_BATCH,
  QUESTIONS_PER_VISION_BATCH,
  QuizQuestionRegistry,
  acceptQuestions,
  allocateAcrossSets,
  allocateQuestionTargets,
  finalizeComprehensiveQuestions,
  finalizeQuizQuestions,
  isNearDuplicate,
  planBatchRequests,
  planComprehensiveBatches,
  planQuizBatches,
  questionKey,
  readInQuizState,
  readQuestionCandidates,
  serializeInQuizState,
  validateQuestion,
  type QuizQuestion,
} from "@/lib/quiz-questions";

// ---------------------------------------------------------------------------
// Realistic mocked provider payloads (no network is used anywhere in this file)
// ---------------------------------------------------------------------------

// Genuinely distinct stems, so tests exercise de-duplication rather than a
// templated fixture that is legitimately near-identical.
const STEMS: [string, string, string][] = [
  ["Which organelle generates most of a eukaryotic cell's ATP?", "Mitochondrion", "Cell biology"],
  ["What is the net ATP yield of glycolysis per glucose molecule?", "Two ATP", "Metabolism"],
  ["Which molecule carries electrons into the electron transport chain?", "NADH", "Metabolism"],
  ["What does catalase convert hydrogen peroxide into?", "Water and oxygen", "Enzymes"],
  ["During which phase of mitosis do chromosomes align at the cell equator?", "Metaphase", "Cell cycle"],
  ["Which bond links two amino acids in a polypeptide chain?", "Peptide bond", "Proteins"],
  ["What is the primary function of the sodium-potassium pump?", "Maintain membrane potential", "Transport"],
  ["Which process produces four genetically distinct haploid cells?", "Meiosis", "Genetics"],
  ["Which property limits the rate of diffusion across a membrane?", "Surface area and gradient", "Transport"],
  ["Which enzyme unwinds the DNA double helix before replication?", "Helicase", "Genetics"],
  ["What is the role of chlorophyll during photosynthesis?", "Absorb light energy", "Photosynthesis"],
  ["Which vessel carries oxygenated blood from the lungs to the heart?", "Pulmonary vein", "Circulation"],
  ["How does an enzyme lower the activation energy of a reaction?", "Stabilising the transition state", "Enzymes"],
  ["Which product of the Krebs cycle drives oxidative phosphorylation?", "NADH and FADH2", "Metabolism"],
  ["Which structure regulates what enters and leaves a cell?", "Plasma membrane", "Cell biology"],
  ["What causes water to enter a cell by osmosis?", "A lower solute potential outside", "Transport"],
  ["Which phase of meiosis creates variation by crossing over?", "Prophase I", "Genetics"],
  ["What is the function of the rough endoplasmic reticulum?", "Protein synthesis and folding", "Cell biology"],
  ["Which hormone lowers blood glucose concentration?", "Insulin", "Homeostasis"],
  ["What describes a reaction that releases heat to its surroundings?", "Exothermic", "Thermodynamics"],
  ["Which part of the nephron filters blood plasma?", "Glomerulus", "Excretion"],
  ["What is the effect of a competitive inhibitor on an enzyme?", "It binds the active site", "Enzymes"],
  ["Which gas is released during the light-dependent reactions?", "Oxygen", "Photosynthesis"],
  ["Which channels maintain the resting potential of a neuron?", "Potassium leak channels", "Neurobiology"],
  ["Which process copies DNA into messenger RNA?", "Transcription", "Genetics"],
  ["What is the role of tRNA during translation?", "Deliver amino acids to the ribosome", "Genetics"],
  ["Why does the reaction rate rise initially with substrate concentration?", "More enzyme-substrate collisions", "Enzymes"],
  ["Which tissue conducts water up a plant stem?", "Xylem", "Plant biology"],
  ["What is the main nitrogenous waste excreted by mammals?", "Urea", "Excretion"],
  ["Which molecule is the final electron acceptor in aerobic respiration?", "Oxygen gas", "Metabolism"],
  ["What is the independent variable in an experiment measuring enzyme rate?", "The factor deliberately changed", "Experimental design"],
  ["Which organ stores bile before release into the small intestine?", "Gall bladder", "Digestion"],
  ["What is the function of the alveoli in the lungs?", "Gas exchange surface", "Respiration"],
  ["Which type of immunity is produced after infection?", "Active natural immunity", "Immunology"],
  ["What is a codon?", "Three bases coding for one amino acid", "Genetics"],
  ["Which process separates homologous chromosomes?", "Meiosis I", "Genetics"],
  ["What is the advantage of a double circulatory system?", "Higher blood pressure and faster flow", "Circulation"],
  ["Which ion triggers muscle contraction?", "Calcium", "Muscle physiology"],
  ["What is the role of decomposers in an ecosystem?", "Break down dead organic matter", "Ecology"],
  ["Which factor most increases the rate of transpiration?", "Warm dry windy conditions", "Plant biology"],
  ["What is homeostasis?", "Maintaining a stable internal environment", "Homeostasis"],
  ["Which molecule stores genetic information in most cells?", "DNA", "Genetics"],
  ["What is the effect of a non-competitive inhibitor?", "It alters the shape of the active site", "Enzymes"],
  ["Which part of the brain controls breathing rate?", "Medulla oblongata", "Neurobiology"],
  ["What is the function of the loop of Henle?", "Create a concentration gradient in the medulla", "Excretion"],
  ["Which substance is the substrate of amylase?", "Starch", "Digestion"],
  ["What limits photosynthesis at low light intensity?", "Light intensity", "Photosynthesis"],
  ["Which type of bond forms between water molecules?", "Hydrogen bond", "Biochemistry"],
  ["What is the role of the promoter region in a gene?", "Bind RNA polymerase to start transcription", "Genetics"],
  ["Which structure connects the fetus to the placenta?", "Umbilical cord", "Reproduction"],
  ["What is genetic drift?", "Random change in allele frequency", "Evolution"],
  ["Which evidence supports the theory of evolution?", "Fossil record and DNA similarity", "Evolution"],
  ["What is the function of the sinoatrial node?", "Set the heart's resting rhythm", "Circulation"],
  ["Which biome has the highest biodiversity?", "Tropical rainforest", "Ecology"],
  ["What is the purpose of a control group in an experiment?", "Provide a baseline for comparison", "Experimental design"],
  ["Which term describes organisms that make their own food?", "Autotroph", "Ecology"],
  ["What is the role of the cell wall in plant cells?", "Provide structural support", "Cell biology"],
  ["Which stage of respiration produces carbon dioxide?", "Link reaction and Krebs cycle", "Metabolism"],
  ["What is the effect of temperature above the optimum on enzymes?", "Denaturation of the active site", "Enzymes"],
  ["Which organ produces insulin?", "Pancreas", "Homeostasis"],
  ["What is the function of the placenta?", "Exchange nutrients and waste with the fetus", "Reproduction"],
  ["Which process removes carbon dioxide from the atmosphere?", "Photosynthesis", "Ecology"],
  ["What is a mutation?", "A change in the DNA base sequence", "Genetics"],
  ["Which vessel carries blood away from the heart?", "Artery", "Circulation"],
  ["What is the role of the villi in the small intestine?", "Increase surface area for absorption", "Digestion"],
];

const DISTRACTORS = [
  "Ribosome", "Cytoplasm", "Catalase", "Glycolysis", "Prophase", "Lysosome",
  "Simple diffusion", "DNA polymerase", "Chloroplast", "Anaphase", "Uric acid",
  "Glucagon", "Phloem", "Ligase", "Golgi apparatus", "Budding",
];

let seq = 0;
const nextQuestion = (overrides: Partial<Record<string, unknown>> = {}) => {
  const index = seq % STEMS.length;
  seq += 1;
  const [question, correct, topic] = STEMS[index] as [string, string, string];
  const distractors = DISTRACTORS.filter((item) => item !== correct).slice(0, 3);
  return {
    type: "mc",
    question,
    options: [correct, ...distractors],
    answer: 0,
    answerText: correct,
    explanation: `The material states this directly under ${topic}.`,
    topic,
    ...overrides,
  };
};

/** A deterministic provider that returns `n` well-formed, unique questions. */
const provider = (n: number) => JSON.stringify({ questions: Array.from({ length: n }, () => nextQuestion()) });
const SHORT_STEMS = [
  "Explain how the sodium-potassium pump maintains resting membrane potential.",
  "Describe two differences between mitosis and meiosis in cell division.",
  "Explain why an enzyme-catalysed reaction plateaus at high substrate concentration.",
];
const shortQuestion = (i: number) => ({
  type: "short",
  question: SHORT_STEMS[i % SHORT_STEMS.length],
  options: [],
  answer: -1,
  answerText: `Model answer ${i} drawn from the material.`,
  explanation: `Explanation ${i} from the material.`,
  topic: "Mechanism",
});

const payload = (questions: unknown[]) => JSON.stringify({ questions });

function buildParts(results: { partIndex: number; questions: QuizQuestion[] }[]): string {
  return serializeInQuizState(new Map(results.map((entry) => [entry.partIndex, entry.questions])));
}

// ---------------------------------------------------------------------------
// Duplicate behaviour within one quiz
// ---------------------------------------------------------------------------

describe("within-quiz duplicate detection", () => {
  it("rejects an exact duplicate inside the same batch", () => {
    const registry = new QuizQuestionRegistry();
    const repeated = nextQuestion();
    const accepted = acceptQuestions([repeated, { ...repeated }, { ...repeated }], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(1);
    expect(accepted.duplicateCount).toBe(2);
  });

  it("rejects duplicates that differ only by case, punctuation or spacing", () => {
    const registry = new QuizQuestionRegistry();
    const first = nextQuestion({ question: "What does the enzyme catalase break down?" });
    const second = nextQuestion({ question: "  what does the ENZYME catalase, break down?  " });
    const accepted = acceptQuestions([first, second], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(1);
    expect(accepted.duplicateCount).toBe(1);
  });

  it("rejects a duplicate produced in a later batch of the same quiz", () => {
    const batchOne = [nextQuestion(), nextQuestion()];
    const state = buildParts([{ partIndex: 0, questions: batchOne as QuizQuestion[] }]);
    const carried = readInQuizState(state);
    const registry = new QuizQuestionRegistry(carried.all);
    // Batch two repeats one question from batch one and adds a genuinely new one.
    const accepted = acceptQuestions([batchOne[0], nextQuestion()], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(1);
    expect(accepted.duplicateCount).toBe(1);
    expect(readInQuizState(state).all).toHaveLength(2);
  });

  it("keeps questions that share vocabulary but test different things", () => {
    const registry = new QuizQuestionRegistry();
    const a = nextQuestion({ question: "Which enzyme breaks down hydrogen peroxide in liver cells?" });
    const b = nextQuestion({ question: "Which enzyme builds glycogen from glucose in liver cells?" });
    const accepted = acceptQuestions([a, b], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(2);
    expect(isNearDuplicate(a.question as string, b.question as string)).toBe(false);
  });

  it("does not treat word-order reversal as a duplicate on its own", () => {
    const a = "Why does increasing substrate concentration raise the reaction rate initially?";
    const b = "Initially the reaction rate rises when substrate concentration increases, why?";
    expect(questionKey(a)).not.toBe(questionKey(b));
    expect(isNearDuplicate(a, b)).toBe(false);
    expect(isNearDuplicate(a, a)).toBe(true);
  });

  it("does not reject unrelated questions that happen to share answer choices", () => {
    const registry = new QuizQuestionRegistry();
    const options = ["Mitochondria", "Ribosome", "Nucleus", "Golgi"];
    const a = { ...nextQuestion({ options }), answer: 0 };
    const b = { ...nextQuestion({ options }), answer: 2 };
    const accepted = acceptQuestions([a, b], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// History must never be a hard filter
// ---------------------------------------------------------------------------

describe("questions from earlier quizzes stay reusable", () => {
  it("allows a question from a previously completed quiz in a new quiz", () => {
    const previous = nextQuestion();
    // A brand new quiz starts with an empty registry: nothing from history is loaded.
    const registry = new QuizQuestionRegistry();
    const accepted = acceptQuestions([previous], registry, { limit: 10 });
    expect(accepted.questions).toHaveLength(1);
  });

  it("allows reuse across Practice Exam and Regular Quiz in both directions", () => {
    const practiceExamQuestion = nextQuestion();
    const regularQuizQuestion = nextQuestion();
    const quizRun = acceptQuestions([practiceExamQuestion], new QuizQuestionRegistry(), { limit: 5 });
    const examRun = acceptQuestions([regularQuizQuestion], new QuizQuestionRegistry(), { limit: 5 });
    expect(quizRun.questions).toHaveLength(1);
    expect(examRun.questions).toHaveLength(1);
  });

  it("allows a Comprehensive Exam question to appear in a later quiz", () => {
    const comprehensiveQuestion = nextQuestion();
    const registry = new QuizQuestionRegistry();
    const accepted = acceptQuestions([comprehensiveQuestion], registry, { limit: 5 });
    expect(accepted.questions).toHaveLength(1);
  });

  it("never exhausts a study set when many quizzes reused the same pool", () => {
    const pool = Array.from({ length: 12 }, () => nextQuestion());
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const registry = new QuizQuestionRegistry();
      const accepted = acceptQuestions(pool, registry, { limit: 12 });
      expect(accepted.questions).toHaveLength(12);
    }
  });

  it("resumes an unfinished quiz without duplicating its existing questions", () => {
    const first = nextQuestion();
    const second = nextQuestion();
    const state = buildParts([{ partIndex: 0, questions: [first, second] as QuizQuestion[] }]);
    const resume = finalizeQuizQuestions({ count: 2, generatedText: state });
    expect(resume.map((question) => question.question)).toEqual([
      first.question as string,
      second.question as string,
    ]);
  });

  it("de-duplicates across different study sets inside one comprehensive exam", () => {
    const shared = nextQuestion();
    const uniqueA = nextQuestion();
    const uniqueB = nextQuestion();
    const generatedBySet = [
      { setId: "set-a", generatedText: payload([shared, uniqueA]) },
      { setId: "set-b", generatedText: payload([shared, uniqueB]) },
    ];
    const questions = finalizeComprehensiveQuestions({
      count: 3,
      setIds: ["set-a", "set-b"],
      generatedBySet,
    });
    expect(questions).toHaveLength(3);
    const keys = questions.map((question) => questionKey(question.question));
    expect(new Set(keys).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Only validated, accepted questions count toward the requested total
// ---------------------------------------------------------------------------

describe("validation before counting", () => {
  it("rejects malformed questions instead of counting them", () => {
    const registry = new QuizQuestionRegistry();
    const accepted = acceptQuestions(
      [
        nextQuestion(),
        { ...nextQuestion(), type: "essay" },
        { ...nextQuestion(), options: ["only one"] },
        { ...nextQuestion(), explanation: "" },
        { ...nextQuestion(), question: "" },
        null,
        "not a question",
      ],
      registry,
      { limit: 5 },
    );
    expect(accepted.questions).toHaveLength(1);
    expect(accepted.invalidCount).toBe(6);
  });

  it("normalises the answer text from the indexed option", () => {
    const validated = validateQuestion({
      ...nextQuestion(),
      options: ["A", "B", "C", "D"],
      answer: 2,
      answerText: "wrong text from the model",
    });
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.question.answerText).toBe("C");
  });

  it("rejects a type the student did not ask for", () => {
    const validated = validateQuestion({ ...nextQuestion(), type: "tf", options: ["True", "False"], answer: 0 }, {
      types: ["mc"],
    });
    expect(validated.ok).toBe(false);
  });

  it("salvages complete questions from a truncated provider response", () => {
    const text = `{"questions":[${JSON.stringify(nextQuestion())},${JSON.stringify(nextQuestion())},{"type":"mc","question":"cut off mid`;
    const candidates = readQuestionCandidates(text);
    expect(candidates.length).toBe(2);
    const accepted = acceptQuestions(candidates, new QuizQuestionRegistry(), { limit: 5 });
    expect(accepted.questions).toHaveLength(2);
  });

  it("reads a bare array payload", () => {
    const candidates = readQuestionCandidates(JSON.stringify([nextQuestion(), nextQuestion()]));
    expect(candidates).toHaveLength(2);
  });

  it("reads a fenced parts payload", () => {
    const text = "```json\n" + JSON.stringify({ parts: [{ questions: [nextQuestion()] }] }) + "\n```";
    expect(readQuestionCandidates(text)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Batch accounting for 10..60 questions
// ---------------------------------------------------------------------------

describe("large-question generation accounting", () => {
  for (const count of [10, 20, 30, 40, 50, 60]) {
    it(`fills exactly ${count} questions across batches`, () => {
      const registry = new QuizQuestionRegistry();
      const perPart = new Map<number, QuizQuestion[]>();
      const partCount = 3;
      let round = 0;
      while (registry.size < count && round < MAX_GENERATION_ROUNDS) {
        const plan = planQuizBatches({
          partCount,
          count,
          batchCap: QUESTIONS_PER_BATCH,
          round,
          ...(registry.size ? { generatedText: serializeInQuizState(perPart) } : {}),
        });
        expect(plan.remaining).toBe(count - registry.size);
        if (!plan.requests.length) break;
        for (const request of plan.requests) {
          expect(request.batchCount).toBeLessThanOrEqual(QUESTIONS_PER_BATCH);
          const accepted = acceptQuestions(
            readQuestionCandidates(provider(request.batchCount)),
            registry,
            { limit: request.batchCount },
          );
          perPart.set(request.unit, [...(perPart.get(request.unit) ?? []), ...accepted.questions]);
        }
        round += 1;
      }
      expect(registry.size).toBe(count);
      const final = finalizeQuizQuestions({ count, generatedText: serializeInQuizState(perPart) });
      expect(final).toHaveLength(count);
      expect(new Set(final.map((question) => questionKey(question.question))).size).toBe(count);
    });
  }

  it("asks for replacements when a batch is duplicate-heavy", () => {
    const registry = new QuizQuestionRegistry();
    const repeated = nextQuestion();
    const first = acceptQuestions([repeated], registry, { limit: 1 });
    expect(first.questions).toHaveLength(1);
    const second = acceptQuestions([repeated, repeated, repeated], registry, { limit: 5 });
    expect(second.questions).toHaveLength(0);
    // The planner still reports the true shortfall, so another round is requested.
    const plan = planQuizBatches({
      partCount: 1,
      count: 5,
      batchCap: QUESTIONS_PER_BATCH,
      generatedText: buildParts([{ partIndex: 0, questions: [repeated as QuizQuestion] }]),
    });
    expect(plan.remaining).toBe(4);
    expect(plan.requests).toHaveLength(1);
  });

  it("keeps requesting the shortfall when a batch returns invalid JSON only", () => {
    const registry = new QuizQuestionRegistry();
    const accepted = acceptQuestions(readQuestionCandidates("I could not comply."), registry, { limit: 5 });
    expect(accepted.questions).toHaveLength(0);
    const plan = planQuizBatches({ partCount: 2, count: 20, batchCap: QUESTIONS_PER_BATCH, round: 1 });
    expect(plan.remaining).toBe(20);
    expect(plan.requests.length).toBeGreaterThan(0);
  });

  it("recovers from a partial batch failure and keeps the successful questions", () => {
    const registry = new QuizQuestionRegistry();
    const perPart = new Map<number, QuizQuestion[]>();
    // Round 1: part 0 answers, part 1 throws (provider timeout) and is skipped.
    const roundOne = planBatchRequests({
      targets: allocateQuestionTargets(20, 2),
      accepted: [0, 0],
      remaining: 20,
      batchCap: QUESTIONS_PER_BATCH,
      round: 0,
    });
    for (const request of roundOne) {
      if (request.unit === 1) continue; // simulated failure
      const accepted = acceptQuestions(readQuestionCandidates(provider(request.batchCount)), registry, {
        limit: request.batchCount,
      });
      perPart.set(request.unit, [...(perPart.get(request.unit) ?? []), ...accepted.questions]);
    }
    expect(registry.size).toBeGreaterThan(0);
    const saved = registry.size;
    // Round 2 redistributes the remaining work to the healthy part.
    const roundTwo = planBatchRequests({
      targets: allocateQuestionTargets(20, 2),
      accepted: [perPart.get(0)?.length ?? 0, 0],
      remaining: 20 - saved,
      batchCap: QUESTIONS_PER_BATCH,
      round: 1,
    });
    expect(roundTwo.reduce((sum, item) => sum + item.batchCount, 0)).toBe(20 - saved);
    for (const request of roundTwo) {
      const accepted = acceptQuestions(readQuestionCandidates(provider(request.batchCount)), registry, {
        limit: request.batchCount,
      });
      perPart.set(request.unit, [...(perPart.get(request.unit) ?? []), ...accepted.questions]);
    }
    const final = finalizeQuizQuestions({ count: 20, generatedText: serializeInQuizState(perPart) });
    expect(final).toHaveLength(20);
  });

  it("does not ask an exhausted part forever and still fills the quiz", () => {
    // Part 1 is empty material: it never returns anything usable.
    const registry = new QuizQuestionRegistry();
    const perPart = new Map<number, QuizQuestion[]>();
    const exhausted: number[] = [];
    let round = 0;
    let stalledRounds = 0;
    while (registry.size < 20 && round < MAX_GENERATION_ROUNDS && stalledRounds < 3) {
      const plan = planBatchRequests({
        targets: allocateQuestionTargets(20, 2),
        accepted: [perPart.get(0)?.length ?? 0, 0],
        remaining: 20 - registry.size,
        batchCap: QUESTIONS_PER_BATCH,
        round,
        exhausted,
      });
      if (!plan.length) break;
      let acceptedThisRound = 0;
      for (const request of plan) {
        const text = request.unit === 1 ? "" : provider(request.batchCount);
        const accepted = acceptQuestions(readQuestionCandidates(text), registry, { limit: request.batchCount });
        if (accepted.questions.length) {
          perPart.set(request.unit, [...(perPart.get(request.unit) ?? []), ...accepted.questions]);
          acceptedThisRound += accepted.questions.length;
        } else if (stalledRounds >= 1 && !exhausted.includes(request.unit)) {
          exhausted.push(request.unit);
        }
      }
      round += 1;
      if (!acceptedThisRound) stalledRounds += 1;
      else stalledRounds = 0;
    }
    expect(registry.size).toBe(20);
    expect(exhausted).toContain(1);
    expect(finalizeQuizQuestions({ count: 20, generatedText: serializeInQuizState(perPart) })).toHaveLength(20);
  });

  it("reports a precise shortfall instead of silently returning fewer questions", () => {
    const state = buildParts([{ partIndex: 0, questions: Array.from({ length: 8 }, () => nextQuestion() as QuizQuestion) }]);
    expect(() => finalizeQuizQuestions({ count: 20, generatedText: state })).toThrow(/8 of 20/);
  });

  it("returns the saved progress so a retry resumes rather than restarting", () => {
    const savedQuestions = Array.from({ length: 14 }, () => nextQuestion() as QuizQuestion);
    const state = buildParts([{ partIndex: 0, questions: savedQuestions }]);
    const resumed = planQuizBatches({ partCount: 2, count: 20, generatedText: state, batchCap: QUESTIONS_PER_BATCH, round: 0 });
    expect(resumed.accepted).toBe(14);
    expect(resumed.remaining).toBe(6);
    expect(resumed.requests.reduce((sum, item) => sum + item.batchCount, 0)).toBe(6);
  });

  it("keeps vision batches small enough for one provider response", () => {
    const plan = planQuizBatches({ partCount: 1, count: 20, batchCap: QUESTIONS_PER_VISION_BATCH });
    for (const request of plan.requests) expect(request.batchCount).toBeLessThanOrEqual(QUESTIONS_PER_VISION_BATCH);
    expect(QUESTIONS_PER_VISION_BATCH).toBeLessThan(QUESTIONS_PER_BATCH);
  });

  it("still delivers a full quiz when source material is thin", () => {
    // Only 4 distinct facts exist, so the provider repeats itself every round.
    const facts = Array.from({ length: 4 }, () => nextQuestion());
    const registry = new QuizQuestionRegistry();
    const perPart = new Map<number, QuizQuestion[]>();
    let round = 0;
    while (round < 6) {
      const plan = planQuizBatches({
        partCount: 1,
        count: 4,
        batchCap: QUESTIONS_PER_BATCH,
        round,
      });
      if (!plan.requests.length) break;
      for (const request of plan.requests) {
        const accepted = acceptQuestions(facts, registry, { limit: request.batchCount });
        perPart.set(request.unit, [...(perPart.get(request.unit) ?? []), ...accepted.questions]);
      }
      round += 1;
      if (registry.size >= 4) break;
    }
    expect(registry.size).toBe(4);
    expect(finalizeQuizQuestions({ count: 4, generatedText: serializeInQuizState(perPart) })).toHaveLength(4);
  });

  it("mixes true/false and short-answer types in the same quiz", () => {
    const registry = new QuizQuestionRegistry();
    const accepted = acceptQuestions(
      [
        nextQuestion(),
        { type: "tf", question: "Osmosis requires energy from ATP.", options: ["True", "False"], answer: 1, answerText: "False", explanation: "Osmosis is passive.", topic: "Transport" },
        shortQuestion(1),
        shortQuestion(2),
      ],
      registry,
      { limit: 10 },
    );
    expect(accepted.questions.map((question) => question.type)).toEqual(["mc", "tf", "short", "short"]);
    expect(accepted.questions.find((question) => question.type === "short")?.answer).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Comprehensive exam accounting
// ---------------------------------------------------------------------------

describe("comprehensive exam accounting", () => {
  it("splits the requested count across every selected set", () => {
    expect(allocateAcrossSets(20, ["a", "b", "c"]).map((allocation) => allocation.count)).toEqual([7, 7, 6]);
    expect(allocateAcrossSets(60, ["a", "b", "c"]).reduce((sum, item) => sum + item.count, 0)).toBe(60);
  });

  for (const count of [10, 20, 30, 40, 50, 60]) {
    it(`fills exactly ${count} comprehensive questions`, () => {
      const sets = [{ id: "set-a", partCount: 2 }, { id: "set-b", partCount: 2 }];
      const registry = new QuizQuestionRegistry();
      const bySet = new Map<string, Map<number, QuizQuestion[]>>();
      let round = 0;
      while (registry.size < count && round < MAX_GENERATION_ROUNDS) {
        const plan = planComprehensiveBatches({
          sets,
          count,
          batchCap: QUESTIONS_PER_BATCH,
          round,
          generatedBySet: [...bySet.entries()].map(([setId, parts]) => ({
            setId,
            generatedText: serializeInQuizState(parts),
          })),
        });
        if (!plan.requests.length) break;
        for (const request of plan.requests) {
          const accepted = acceptQuestions(readQuestionCandidates(provider(request.batchCount)), registry, {
            limit: request.batchCount,
          });
          const parts = bySet.get(request.setId) ?? new Map<number, QuizQuestion[]>();
          parts.set(request.partIndex, [...(parts.get(request.partIndex) ?? []), ...accepted.questions]);
          bySet.set(request.setId, parts);
        }
        round += 1;
      }
      const final = finalizeComprehensiveQuestions({
        count,
        setIds: sets.map((set) => set.id),
        generatedBySet: [...bySet.entries()].map(([setId, parts]) => ({
          setId,
          generatedText: serializeInQuizState(parts),
        })),
      });
      expect(final).toHaveLength(count);
      expect(new Set(final.map((question) => questionKey(question.question))).size).toBe(count);
      expect(new Set(final.map((question) => question.setId)).size).toBe(2);
    });
  }

  it("redistributes when one set cannot fill its share", () => {
    const plan = planComprehensiveBatches({
      sets: [{ id: "rich", partCount: 3 }, { id: "empty", partCount: 3 }],
      count: 20,
      batchCap: QUESTIONS_PER_BATCH,
      exhaustedSets: ["empty"],
    });
    const onlyRich = plan.requests.every((request) => request.setId === "rich");
    expect(onlyRich).toBe(true);
    expect(plan.requests.reduce((sum, item) => sum + item.batchCount, 0)).toBeGreaterThanOrEqual(plan.remaining);
  });

  it("backfills from sets that produced more than their allocation", () => {
    const generatedBySet = [
      { setId: "set-a", generatedText: payload(Array.from({ length: 15 }, () => nextQuestion())) },
      { setId: "set-b", generatedText: payload(Array.from({ length: 2 }, () => nextQuestion())) },
    ];
    const final = finalizeComprehensiveQuestions({ count: 10, setIds: ["set-a", "set-b"], generatedBySet });
    expect(final).toHaveLength(10);
  });
});
