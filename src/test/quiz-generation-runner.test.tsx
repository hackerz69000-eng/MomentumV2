import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  streamAiText: vi.fn(),
  streamAiJson: vi.fn(),
  generateQuiz: vi.fn(),
  generateComprehensive: vi.fn(),
  prepareQuizReviewStream: vi.fn(),
  prepareGradeShortAnswersStream: vi.fn(),
  useServerFn: vi.fn((fn: unknown) => fn),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: mocks.useServerFn,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, storage: { from: () => ({ download: vi.fn(), createSignedUrl: vi.fn() }) }, auth: {} },
}));
vi.mock("@/lib/ai-stream", () => ({ streamAiText: mocks.streamAiText, streamAiJson: mocks.streamAiJson }));
vi.mock("@/lib/study.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/study.functions")>();
  return {
    ...actual,
    generateQuiz: mocks.generateQuiz,
    generateComprehensive: mocks.generateComprehensive,
    prepareQuizReviewStream: mocks.prepareQuizReviewStream,
    prepareGradeShortAnswersStream: mocks.prepareGradeShortAnswersStream,
  };
});

import { QuizRunner } from "@/components/set/QuizRunner";
import type { StudySet } from "@/lib/queries";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

// Distinct stems: a templated fixture would legitimately be flagged as
// near-duplicate, which is the behaviour under test, not the fixture's job.
const STEMS = [
  "Which organelle generates most of a eukaryotic cell's ATP?",
  "What is the net ATP yield of glycolysis per glucose molecule?",
  "Which molecule carries electrons into the electron transport chain?",
  "What does catalase convert hydrogen peroxide into?",
  "During which phase of mitosis do chromosomes align at the cell equator?",
  "Which bond links two amino acids in a polypeptide chain?",
  "What is the primary function of the sodium-potassium pump?",
  "Which process produces four genetically distinct haploid cells?",
  "Which property limits the rate of diffusion across a membrane?",
  "Which enzyme unwinds the DNA double helix before replication?",
  "What is the role of chlorophyll during photosynthesis?",
  "Which vessel carries oxygenated blood from the lungs to the heart?",
  "How does an enzyme lower the activation energy of a reaction?",
  "Which product of the Krebs cycle drives oxidative phosphorylation?",
  "Which structure regulates what enters and leaves a cell?",
  "What causes water to enter a cell by osmosis?",
  "Which phase of meiosis creates variation by crossing over?",
  "What is the function of the rough endoplasmic reticulum?",
  "Which hormone lowers blood glucose concentration?",
  "What describes a reaction that releases heat to its surroundings?",
  "Which part of the nephron filters blood plasma?",
  "What is the effect of a competitive inhibitor on an enzyme?",
  "Which gas is released during the light-dependent reactions?",
  "Which channels maintain the resting potential of a neuron?",
  "Which process copies DNA into messenger RNA?",
  "What is the role of tRNA during translation?",
  "Why does the reaction rate rise initially with substrate concentration?",
  "Which tissue conducts water up a plant stem?",
  "What is the main nitrogenous waste excreted by mammals?",
  "Which molecule is the final electron acceptor in aerobic respiration?",
  "What is the independent variable in an experiment measuring enzyme rate?",
  "Which organ stores bile before release into the small intestine?",
  "What is the function of the alveoli in the lungs?",
  "Which type of immunity is produced after infection?",
  "What is a codon?",
  "Which process separates homologous chromosomes?",
  "What is the advantage of a double circulatory system?",
  "Which ion triggers muscle contraction?",
  "What is the role of decomposers in an ecosystem?",
  "Which factor most increases the rate of transpiration?",
  "What is homeostasis?",
  "Which molecule stores genetic information in most cells?",
  "What is the effect of a non-competitive inhibitor?",
  "Which part of the brain controls breathing rate?",
  "What is the function of the loop of Henle?",
  "Which substance is the substrate of amylase?",
  "What limits photosynthesis at low light intensity?",
  "Which type of bond forms between water molecules?",
  "What is the role of the promoter region in a gene?",
  "Which structure connects the fetus to the placenta?",
  "What is genetic drift?",
  "Which evidence supports the theory of evolution?",
  "What is the function of the sinoatrial node?",
  "Which biome has the highest biodiversity?",
  "What is the purpose of a control group in an experiment?",
  "Which term describes organisms that make their own food?",
  "What is the role of the cell wall in plant cells?",
  "Which stage of respiration produces carbon dioxide?",
  "What is the effect of temperature above the optimum on enzymes?",
  "Which organ produces insulin?",
  "What is the function of the placenta?",
  "Which process removes carbon dioxide from the atmosphere?",
  "What is a mutation?",
  "Which vessel carries blood away from the heart?",
  "What is the role of the villi in the small intestine?",
];
const DISTRACTORS = ["Ribosome", "Cytoplasm", "Catalase", "Glycolysis", "Prophase", "Lysosome", "Anaphase", "Uric acid"];

let seq = 0;
const question = (overrides: Record<string, unknown> = {}) => {
  const stem = STEMS[seq % STEMS.length] as string;
  seq += 1;
  return {
    type: "mc",
    question: stem,
    options: [DISTRACTORS[0], DISTRACTORS[1], DISTRACTORS[2], DISTRACTORS[3]],
    answer: 1,
    answerText: String(DISTRACTORS[1]),
    explanation: `The material states this directly.`,
    topic: "Core",
    ...overrides,
  };
};
const payload = (n: number) => JSON.stringify({ questions: Array.from({ length: n }, () => question()) });

const set = { id: "set-1", name: "Biology", user_id: "user-1", material_text: "Cells" } as StudySet;

function renderRunner(preset: Record<string, unknown> = { count: 20 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuizRunner set={set} kind="quiz" attempts={[]} preset={preset} />
    </QueryClientProvider>,
  );
}

/**
 * Server-function mock that behaves like the real handler: it reports the true
 * remaining count from the questions the browser has already accumulated, and
 * finalizes once enough valid questions exist.
 */
function mockServerPipeline(options: {
  batchCap: number;
  respond: (partIndex: number, batchCount: number, call: number) => string | Error;
  /** Reject one batch to simulate a provider timeout. */
  failOnCall?: number;
}) {
  mocks.generateQuiz.mockImplementation(async (args: any) => {
    const data = (args && args.data ? args.data : args ?? {}) as Record<string, any>;
    const generatedText = data["generatedText"] as string | undefined;
    const parts: { partIndex: number; questions: unknown[] }[] = generatedText
      ? (JSON.parse(generatedText) as { parts: { partIndex: number; questions: unknown[] }[] }).parts
      : [];
    const accepted = parts.flatMap((part) => part.questions);
    const count = data["count"] as number;
    if (!data["prepareOnly"]) {
      return { questions: accepted.slice(0, count) };
    }
    const remaining = count - accepted.length;
    if (remaining <= 0) return { prompts: [], complete: true, remaining: 0, accepted: accepted.length };
    const batchCount = Math.min(options.batchCap, remaining);
    return {
      prompts: [
        {
          partIndex: 0,
          batchCount,
          system: "quiz",
          messages: [{ role: "user", content: "material" }],
        },
      ],
      complete: false,
      remaining,
      accepted: accepted.length,
    };
  });
  let call = 0;
  mocks.streamAiText.mockImplementation(async (args: any) => {
    const system = String(args?.system ?? "");
    if (system.startsWith("review")) return payload(0);
    call += 1;
    if (options.failOnCall === call) throw new Error("The NVIDIA NIM request timed out.");
    const text = options.respond(0, 0, call);
    if (text instanceof Error) throw text;
    return text;
  });
  mocks.prepareQuizReviewStream.mockResolvedValue({ system: "review", messages: [{ role: "user", content: "review" }] });
}

/** Calls the runner made to the server pipeline, split by purpose. */
function callStats() {
  const calls = (mocks.generateQuiz.mock.calls as any[]).map((call) => (call[0]?.data ?? call[0] ?? {}) as Record<string, unknown>);
  const prepare = calls.filter((data) => Boolean(data["prepareOnly"]));
  const finalize = calls.filter((data) => !data["prepareOnly"]);
  const streamed = (mocks.streamAiText.mock.calls as any[]).filter(
    (call) => !String(call[0]?.system ?? "").startsWith("review"),
  ).length;
  const lastFinalize = finalize.at(-1);
  const rawText = lastFinalize ? lastFinalize["generatedText"] : undefined;
  const generated = rawText
    ? (JSON.parse(String(rawText)) as { parts: { questions: unknown[] }[] }).parts[0]?.questions ?? []
    : [];
  return { prepare: prepare.length, finalize: finalize.length, streamed, finalizedQuestions: generated.length };
}

/**
 * Poll until generation produces its first requests, then until it stops
 * changing, so each test inspects a settled pipeline without fixed sleeps.
 */
async function settle() {
  await waitFor(() => expect(callStats().prepare).toBeGreaterThan(0), { timeout: 3000 });
  // The runner backs off briefly between batch retries, so "unchanged" must be
  // measured over a window longer than that pause.
  let stableFor = 0;
  let last = JSON.stringify(callStats());
  while (stableFor < 20) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const current = JSON.stringify(callStats());
    if (current === last) stableFor += 1;
    else {
      stableFor = 0;
      last = current;
    }
  }
  return callStats();
}

function snapshotHasQuestions() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) ?? "";
    if (!key.includes(":gen:")) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as { single?: { questions?: unknown[] }[] };
      const total = (parsed.single ?? []).reduce((sum, part) => sum + (part.questions?.length ?? 0), 0);
      if (total > 0) return total;
    } catch {
      /* ignore malformed entries */
    }
  }
  return 0;
}

describe("quiz generation pathway", () => {
  it("produces all 20 questions across multiple batches", async () => {
    mockServerPipeline({ batchCap: 8, respond: () => payload(8) });
    renderRunner({ count: 20 });
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));

    const stats = await settle();
    // 20 questions at a cap of 8 needs at least three provider batches, and the
    // browser only finalizes once it holds 20 validated questions.
    expect(stats.streamed).toBeGreaterThanOrEqual(3);
    expect(stats.finalize).toBe(1);
    expect(stats.finalizedQuestions).toBe(20);
  });

  it("keeps requesting replacements when the provider repeats itself", async () => {
    const repeated = question();
    let call = 0;
    mockServerPipeline({
      batchCap: 8,
      respond: () => {
        call += 1;
        // The first two batches are duplicate-heavy; later batches are fresh.
        return call <= 2 ? JSON.stringify({ questions: [repeated, repeated, repeated] }) : payload(8);
      },
    });
    renderRunner({ count: 10 });
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));

    const stats = await settle();
    // Extra replacement rounds were requested beyond the first batch.
    expect(stats.streamed).toBeGreaterThan(2);
    expect(stats.finalize).toBe(1);
    expect(stats.finalizedQuestions).toBe(10);
  });

  it("survives a provider timeout and still fills the quiz", async () => {
    mockServerPipeline({ batchCap: 5, respond: () => payload(5), failOnCall: 2 });
    renderRunner({ count: 10 });
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));

    const stats = await settle();
    // The failed round is retried instead of aborting the whole quiz.
    expect(stats.finalize).toBe(1);
    expect(stats.finalizedQuestions).toBe(10);
  });

  it("persists partial progress so a retry resumes instead of restarting", async () => {
    mockServerPipeline({ batchCap: 5, respond: () => payload(5) });
    let calls = 0;
    mocks.streamAiText.mockImplementation(async (args: any) => {
      const system = String(args?.system ?? "");
      if (system.startsWith("review")) return payload(0);
      calls += 1;
      if (calls === 4) throw new Error("The AI stream ended before the response was complete.");
      return payload(5);
    });
    renderRunner({ count: 20 });
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));
    // Accepted questions are written to storage while generation is still running.
    await waitFor(() => expect(snapshotHasQuestions()).toBeGreaterThan(0), { timeout: 8000 });
  });
});
