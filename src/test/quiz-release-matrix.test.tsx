import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  from: vi.fn(),
  streamAiJson: vi.fn(),
  generateQuiz: vi.fn(),
  generateComprehensive: vi.fn(),
  prepareQuizReviewStream: vi.fn(),
  prepareGradeShortAnswersStream: vi.fn(),
  useServerFn: vi.fn((fn: unknown) => fn),
  recordResults: vi.fn(),
  logActivity: vi.fn(),
  updateLocalSetProgress: vi.fn(),
  recordStudySessionCompletion: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: mocks.useServerFn,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.authUser }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, storage: { from: () => ({}) }, auth: {} } }));
vi.mock("@/lib/ai-stream", () => ({ streamAiJson: mocks.streamAiJson, streamAiText: vi.fn() }));
vi.mock("@/lib/extract", () => ({ extractQuizVisuals: vi.fn() }));
vi.mock("@/lib/study.functions", () => ({
  generateQuiz: mocks.generateQuiz,
  generateComprehensive: mocks.generateComprehensive,
  prepareQuizReviewStream: mocks.prepareQuizReviewStream,
  prepareGradeShortAnswersStream: mocks.prepareGradeShortAnswersStream,
}));
vi.mock("@/lib/log-activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/mistakes", () => ({ recordResults: mocks.recordResults }));
vi.mock("@/lib/local-store", () => ({ updateLocalSetProgress: mocks.updateLocalSetProgress }));
vi.mock("@/components/DailyStreak", () => ({ recordStudySessionCompletion: mocks.recordStudySessionCompletion }));

import { QuizRunner } from "@/components/set/QuizRunner";
import type { StudySet } from "@/lib/queries";
import type { Attempt } from "@/lib/stats";

type Question = { type: "mc" | "tf" | "short"; question: string; options: string[]; answer: number; answerText: string; explanation: string; topic: string; setId?: string };
type AssessmentKind = "quiz" | "exam" | "comprehensive";
const setIds = ["set-a", "set-b"];
let requestedTypes: Question["type"][] = ["mc", "tf"];
let questionCursor = 0;
let lastReviewBatch: Question[] = [];
let finalizedQuestions: Question[] = [];
let simulatedTimeoutsRemaining = 0;

function makeQuestion(id: number, type: Question["type"], setId?: string): Question {
  const topic = `Topic ${((id - 1) % 6) + 1}`;
  if (type === "short") return { type, question: `Study question ${id} about ${topic}?`, options: [], answer: -1, answerText: `Expected answer ${id}`, explanation: `Specific explanation for ${id}.`, topic, ...(setId ? { setId } : {}) };
  if (type === "tf") {
    const options = ["True", "False"];
    return { type, question: `Study question ${id} about ${topic}?`, options, answer: 0, answerText: options[0]!, explanation: `Specific explanation for ${id}.`, topic, ...(setId ? { setId } : {}) };
  }
  const options = [`Correct answer ${id}`, `Wrong A ${id}`, `Wrong B ${id}`, `Wrong C ${id}`];
  return { type, question: `Study question ${id} about ${topic}?`, options, answer: 0, answerText: options[0]!, explanation: `Specific explanation for ${id}.`, topic, ...(setId ? { setId } : {}) };
}

function generateQuestions(count: number, setId?: string): Question[] {
  return Array.from({ length: count }, () => {
    const type = requestedTypes[questionCursor % requestedTypes.length]!;
    return makeQuestion(++questionCursor, type, setId);
  });
}

function readProgress(value: unknown): Question[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as { parts?: { questions?: Question[] }[]; questions?: Question[] };
    if (Array.isArray(parsed.parts)) return parsed.parts.flatMap((part) => part.questions ?? []);
    return parsed.questions ?? [];
  } catch { return []; }
}

function makeSet(id: string): StudySet {
  return { id, name: `Biology ${id}`, subject: "Biology", user_id: "test-user", material_text: Array.from({ length: 6 }, (_, i) => `Topic ${i + 1}: a distinct mechanism, definition, and relationship supported by course material.`).join("\n") } as StudySet;
}

function configureMocks(kind: AssessmentKind, count: number, types: Question["type"][] = ["mc", "tf"], interruptAfterFirstBatch = false) {
  requestedTypes = types;
  questionCursor = 0;
  lastReviewBatch = [];
  finalizedQuestions = [];
  simulatedTimeoutsRemaining = interruptAfterFirstBatch ? 3 : 0;
  mocks.from.mockImplementation(() => { throw new Error("Unexpected database access during mocked generation."); });
  mocks.prepareQuizReviewStream.mockImplementation(({ data }: { data: { questions: Question[] } }) => {
    lastReviewBatch = data.questions;
    return Promise.resolve({ system: "review", messages: [{ role: "user", content: "review question batch" }] });
  });
  mocks.prepareGradeShortAnswersStream.mockResolvedValue({ system: "grade", messages: [{ role: "user", content: "grade short answers" }] });
  mocks.streamAiJson.mockImplementation(async ({ system }: { system: string }) => {
    if (system === "review") return lastReviewBatch;
    if (system === "grade") return { grades: [{ correct: true, feedback: "The meaning is correct." }] };
    if (questionCursor >= 5 && simulatedTimeoutsRemaining > 0) {
      simulatedTimeoutsRemaining -= 1;
      throw new Error("simulated provider timeout");
    }
    const batchCount = Number(system.match(/Generate exactly (\d+) questions/)?.[1] ?? 0);
    if (!batchCount) throw new Error("The test did not find a batch count in the real generation prompt.");
    return generateQuestions(batchCount);
  });

  mocks.generateQuiz.mockImplementation(({ data }: { data: { prepareOnly?: boolean; count: number; generatedText?: string } }) => {
    const prior = readProgress(data.generatedText);
    if (data.prepareOnly) {
      const missing = Math.max(0, data.count - prior.length);
      const batchCount = Math.min(5, missing);
      return Promise.resolve({
        sourceRevision: "source-revision-a",
        databaseSourceRevision: "00000000-0000-4000-8000-000000000001",
        avoidQuestions: [],
        prompts: batchCount ? [{ partIndex: 0, batchCount, system: `Generate exactly ${batchCount} questions.`, messages: [{ role: "user", content: "six-topic test source" }] }] : [],
      });
    }
    finalizedQuestions = prior;
    return Promise.resolve({ questions: prior });
  });

  mocks.generateComprehensive.mockImplementation(({ data }: { data: { prepareOnly?: boolean; setIds: string[]; count: number; generatedBySet?: { setId: string; generatedText: string }[] } }) => {
    const perSet = new Map((data.generatedBySet ?? []).map((entry) => [entry.setId, readProgress(entry.generatedText)]));
    const base = Math.floor(data.count / data.setIds.length);
    let extras = data.count - base * data.setIds.length;
    const allocations = data.setIds.map((setId) => [setId, base + (extras-- > 0 ? 1 : 0)] as const);
    const sourceRevisions = Object.fromEntries(data.setIds.map((setId) => [setId, `revision-${setId}`]));
    const databaseSourceRevisions = Object.fromEntries(data.setIds.map((setId, index) => [setId, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
    if (data.prepareOnly) {
      const prompts = allocations.flatMap(([setId, target]) => {
        const missing = Math.max(0, target - (perSet.get(setId)?.length ?? 0));
        const batchCount = Math.min(5, missing);
        return batchCount ? [{ setId, partIndex: 0, batchCount, system: `Generate exactly ${batchCount} questions.`, messages: [{ role: "user" as const, content: `material for ${setId}` }] }] : [];
      });
      return Promise.resolve({ prompts, sourceRevisions, databaseSourceRevisions, avoidQuestionsBySet: Object.fromEntries(data.setIds.map((setId) => [setId, []])) });
    }
    finalizedQuestions = allocations.flatMap(([setId]) => (perSet.get(setId) ?? []).map((question) => ({ ...question, setId })));
    return Promise.resolve({ questions: finalizedQuestions });
  });

  return kind === "comprehensive" ? [makeSet(setIds[0]!), makeSet(setIds[1]!)] : [makeSet(setIds[0]!)];
}

function renderAssessment(kind: AssessmentKind, count: number, sets: StudySet[], attempts: Attempt[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runner = kind === "comprehensive"
    ? <QuizRunner sets={sets} kind={kind} attempts={attempts} preset={{ count, minutes: 0, types: requestedTypes }} />
    : <QuizRunner set={sets[0]!} kind={kind} attempts={attempts} preset={{ count, minutes: 0, types: requestedTypes }} />;
  return render(<QueryClientProvider client={client}>
    {runner}
  </QueryClientProvider>);
}

function assertQuestionQuality(questions: Question[], count: number) {
  expect(questions).toHaveLength(count);
  expect(new Set(questions.map((question) => question.question.normalize("NFKC").toLowerCase())).size).toBe(count);
  expect(new Set(questions.map((question) => question.topic)).size).toBe(6);
  expect(questions.every((question) => requestedTypes.includes(question.type))).toBe(true);
  for (const question of questions) {
    expect(question.explanation.length).toBeGreaterThan(10);
    expect(question.answerText).toBeTruthy();
    if (question.type === "mc") {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(question.options.length);
      expect(question.answerText).toBe(question.options[question.answer]);
    } else if (question.type === "tf") {
      expect(question.options).toEqual(["True", "False"]);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(2);
      expect(question.answerText).toBe(question.options[question.answer]);
    } else {
      expect(question.options).toEqual([]);
      expect(question.answer).toBe(-1);
    }
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  mocks.authUser = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("independent assessment workflow count matrix (mocked AI/server boundaries)", () => {
  it.each(["quiz", "exam", "comprehensive"] as const)("Regular / Practice / Comprehensive %s workflows complete at 20, 30, 40, and 60", async (kind) => {
    const counts = [20, 30, 40, 60];
    for (const count of counts) {
      const sets = configureMocks(kind, count);
      renderAssessment(kind, count, sets);
      const startLabel = kind === "quiz" ? "Start quiz" : "Start exam";
      fireEvent.click(await screen.findByRole("button", { name: startLabel }));
      if (kind === "quiz") {
        await waitFor(() => expect(screen.getAllByText(/^Study question \d+ about Topic \d\?$/)).toHaveLength(count));
      } else {
        await screen.findByRole("button", { name: new RegExp(`^Question ${count}(?:,|$)`) });
      }
      assertQuestionQuality(finalizedQuestions, count);
      if (kind === "comprehensive") {
        expect(new Set(finalizedQuestions.map((question) => question.setId))).toEqual(new Set(setIds));
      }
      cleanup();
      localStorage.clear();
      vi.clearAllMocks();
    }
  });

  it.each(["quiz", "exam", "comprehensive"] as const)("resumes %s generation after a later batch times out", async (kind) => {
    const sets = configureMocks(kind, 20, ["mc", "tf"], true);
    renderAssessment(kind, 20, sets);
    fireEvent.click(await screen.findByRole("button", { name: kind === "quiz" ? "Start quiz" : "Start exam" }));
    const resume = await screen.findByRole("button", { name: "Resume question generation" });
    expect(screen.getByRole("status")).toHaveTextContent("Completed question batches are saved");
    expect(simulatedTimeoutsRemaining).toBe(0);
    fireEvent.click(resume);
    if (kind === "quiz") await waitFor(() => expect(screen.getAllByText(/^Study question \d+ about Topic \d\?$/)).toHaveLength(20));
    else await screen.findByRole("button", { name: /^Question 20(?:,|$)/ });
    assertQuestionQuality(finalizedQuestions, 20);
  });
});

describe("assessment scoring and persistence UI", () => {
  it.each(["quiz", "exam", "comprehensive"] as const)("scores and saves a %s result without falsely reporting success", async (kind) => {
    const sets = configureMocks(kind, 20, ["mc"]);
    mocks.authUser = { id: "test-user" };
    const savedRows: Attempt[] = [];
    const query: { insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> } = {
      insert: vi.fn(async (rows: Partial<Attempt>[]) => {
        savedRows.push(...rows.map((row, index) => ({ ...row, id: `attempt-${index}`, created_at: new Date().toISOString(), duration_seconds: row.duration_seconds ?? null, results: row.results ?? [] }) as Attempt));
        return { error: null };
      }),
      update: vi.fn(),
      eq: vi.fn(),
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    mocks.from.mockReturnValue(query);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderAssessment(kind, 20, sets);
    fireEvent.click(await screen.findByRole("button", { name: kind === "quiz" ? "Start quiz" : "Start exam" }));
    if (kind === "quiz") await waitFor(() => expect(screen.getAllByText(/^Study question \d+ about Topic \d\?$/)).toHaveLength(20));
    else await screen.findByRole("button", { name: /^Question 20(?:,|$)/ });

    const firstVisibleQuestion = screen.getAllByText(/^Study question \d+ about Topic \d\?$/)[0]!;
    const firstId = Number(firstVisibleQuestion.textContent?.match(/Study question (\d+)/)?.[1]);
    fireEvent.click(screen.getByText(`Correct answer ${firstId}`));
    if (kind === "quiz") fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    else fireEvent.click(screen.getByRole("button", { name: "Submit now" }));

    expect(await screen.findByText(/saved to your progress/)).toBeInTheDocument();
    expect(screen.getAllByText(/Specific explanation for \d+\./).length).toBeGreaterThan(0);
    expect(savedRows.reduce((total, row) => total + row.total, 0)).toBe(20);
    expect(savedRows.every((row) => row.user_id === "test-user" && row.kind === kind)).toBe(true);
    expect(savedRows.reduce((total, row) => total + row.score, 0)).toBe(1);
    if (kind === "comprehensive") expect(new Set(savedRows.map((row) => row.set_id))).toEqual(new Set(setIds));
    cleanup();
    renderAssessment(kind, 20, sets, savedRows);
    expect(await screen.findByText(/1\/(10|20)/)).toBeInTheDocument();
  });

  it("shows the result as unsaved when the attempt insert fails", async () => {
    const sets = configureMocks("quiz", 20, ["mc"]);
    mocks.authUser = { id: "test-user" };
    const query = { insert: vi.fn().mockResolvedValue({ error: new Error("database unavailable") }) };
    mocks.from.mockReturnValue(query);
    renderAssessment("quiz", 20, sets);
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));
    await waitFor(() => expect(screen.getAllByText(/^Study question \d+ about Topic \d\?$/)).toHaveLength(20));
    const first = screen.getAllByText(/^Study question \d+ about Topic \d\?$/)[0]!;
    const id = Number(first.textContent?.match(/Study question (\d+)/)?.[1]);
    fireEvent.click(screen.getByText(`Correct answer ${id}`));
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(await screen.findByText(/not saved to your progress/)).toBeInTheDocument();
  });

  it("runs short-answer grading and displays provider feedback in the review", async () => {
    const sets = configureMocks("quiz", 3, ["short"]);
    renderAssessment("quiz", 3, sets);
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));
    await waitFor(() => expect(screen.getAllByText(/^Study question \d+ about Topic \d\?$/)).toHaveLength(3));
    fireEvent.change(screen.getAllByPlaceholderText("Type your answer…")[0]!, { target: { value: "A supported response" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(await screen.findByText(/1 correct/)).toBeInTheDocument();
    expect(await screen.findByText("The meaning is correct.")).toBeInTheDocument();
    expect(mocks.prepareGradeShortAnswersStream).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ expected: expect.stringMatching(/^Expected answer /), given: "A supported response" })]) }) }));
  });
});
