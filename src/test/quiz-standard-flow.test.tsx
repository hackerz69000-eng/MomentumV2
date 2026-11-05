import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  extractQuizVisuals: vi.fn(),
  streamAiJson: vi.fn(),
  streamAiText: vi.fn(),
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
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, storage: { from: () => ({ download: mocks.download, createSignedUrl: mocks.createSignedUrl }) }, auth: {} } }));
vi.mock("@/lib/ai-stream", () => ({ streamAiJson: mocks.streamAiJson, streamAiText: mocks.streamAiText }));
vi.mock("@/lib/extract", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/extract")>()), extractQuizVisuals: mocks.extractQuizVisuals }));
vi.mock("@/lib/study.functions", () => ({
  generateQuiz: mocks.generateQuiz,
  generateComprehensive: mocks.generateComprehensive,
  prepareQuizReviewStream: mocks.prepareQuizReviewStream,
  prepareGradeShortAnswersStream: mocks.prepareGradeShortAnswersStream,
}));

import { QuizRunner } from "@/components/set/QuizRunner";
import type { StudySet } from "@/lib/queries";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("standard quiz generation when image questions are off", () => {
  it("uses the text-only generation and review path by default", async () => {
    const questions = Array.from({ length: 3 }, (_, index) => ({
      type: "mc", question: `Question ${index + 1}`, options: ["A", "B", "C", "D"], answer: 1,
      answerText: "B", explanation: "Source grounded.", topic: "Cell biology",
    }));
    mocks.from.mockImplementation(() => { throw new Error("The standard quiz path must not read uploaded image files."); });
    mocks.generateQuiz.mockImplementation(({ data }: { data: { prepareOnly?: boolean; generatedText?: string } }) => {
      if (data.prepareOnly) return Promise.resolve({ sourceRevision: "source-version-1", databaseSourceRevision: "00000000-0000-4000-8000-000000000001", avoidQuestions: [], prompts: data.generatedText ? [] : [{ partIndex: 0, batchCount: 3, system: "quiz", messages: [{ role: "user", content: "lecture text" }] }] });
      return Promise.resolve({ questions });
    });
    mocks.prepareQuizReviewStream.mockResolvedValue({ system: "review", messages: [{ role: "user", content: "review these" }] });
    mocks.streamAiJson.mockImplementation(async ({ system }: { system: string }) => system === "quiz"
      ? questions
      : questions);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const set = { id: "set-1", name: "Biology", user_id: "user-1", material_text: "Cells" } as StudySet;
    render(<QueryClientProvider client={client}><QuizRunner set={set} kind="quiz" attempts={[]} preset={{ count: 3 }} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Start quiz" }));

    expect(await screen.findByText("Question 1")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ includeImages: false }) }));
    expect(mocks.streamAiJson).toHaveBeenCalledWith(expect.objectContaining({ task: "fast" }));
    expect(mocks.streamAiJson).not.toHaveBeenCalledWith(expect.objectContaining({ task: "vision" }));
    expect(mocks.prepareQuizReviewStream).toHaveBeenCalledTimes(1);
  });

  it("passes a selected lecture visual to the vision model and displays it with the generated question", async () => {
    const question = { type: "short", question: "Identify the labeled cell part.", options: [], answer: -1, answerText: "Nucleus", explanation: "The figure labels the nucleus.", topic: "Cell structure", imageIndex: 0 };
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: [{ id: "file-1", name: "cell.png", path: "u/cell.png", mime: "image/png", size: 10 }], error: null });
    mocks.from.mockReturnValue(query);
    mocks.download.mockResolvedValue({ data: new Blob(["image"]), error: null });
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/cell.png" }, error: null });
    mocks.extractQuizVisuals.mockResolvedValue([{ data: "data:image/jpeg;base64,figure", name: "cell.png", kind: "image", sourceIndex: 0 }]);
    mocks.generateQuiz.mockImplementation(({ data }: { data: { prepareOnly?: boolean; generatedText?: string } }) => {
      if (data.prepareOnly) return Promise.resolve({ sourceRevision: "source-version-1", databaseSourceRevision: "00000000-0000-4000-8000-000000000001", avoidQuestions: [], prompts: data.generatedText ? [] : [{ partIndex: 0, batchCount: 3, system: "vision-quiz", messages: [{ role: "user", content: "lecture text" }] }] });
      return Promise.resolve({ questions: Array.from({ length: 3 }, (_, index) => ({ ...question, question: `${question.question} ${index + 1}` })) });
    });
    mocks.streamAiJson.mockResolvedValue([question, { ...question, question: "Question 2" }, { ...question, question: "Question 3" }]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const set = { id: "set-1", name: "Biology", user_id: "user-1", material_text: "Cells" } as StudySet;
    render(<QueryClientProvider client={client}><QuizRunner set={set} kind="quiz" attempts={[]} preset={{ count: 3, includeImages: true, types: ["short"] }} /></QueryClientProvider>);
    expect(await screen.findByText(/1 saved file can be checked for visuals/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));

    expect(await screen.findAllByRole("img", { name: "Lecture image: cell.png" })).not.toHaveLength(0);
    expect(mocks.generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ includeImages: true }) }));
    expect(mocks.streamAiJson).toHaveBeenCalledWith(expect.objectContaining({ task: "vision" }));
    expect(mocks.prepareQuizReviewStream).not.toHaveBeenCalled();
  });
});

describe("exam generation entry points", () => {
  const makeQuestions = (count: number) => Array.from({ length: count }, (_, index) => ({
    type: "mc" as const, question: `Exam question ${index + 1}?`, options: ["A", "B", "C", "D"], answer: 1,
    answerText: "B", explanation: "Supported by the source.", topic: "Cell biology",
  }));
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const set = (id: string): StudySet => ({ id, name: `Biology ${id}`, user_id: "user-1", material_text: "Cells and their parts" }) as StudySet;

  it("creates a Practice Exam through the exam-configured regular batch path", async () => {
    const questions = makeQuestions(3);
    mocks.from.mockImplementation(() => { throw new Error("Practice Exams without visual questions must not query image storage."); });
    mocks.generateQuiz.mockImplementation(({ data }: { data: { prepareOnly?: boolean; exam?: boolean; generatedText?: string } }) => {
      if (data.prepareOnly) return Promise.resolve({ sourceRevision: "source-version-1", databaseSourceRevision: "00000000-0000-4000-8000-000000000001", avoidQuestions: [], prompts: data.generatedText ? [] : [{ partIndex: 0, batchCount: 3, system: "exam", messages: [{ role: "user", content: "lecture text" }] }] });
      return Promise.resolve({ questions });
    });
    mocks.streamAiJson.mockResolvedValue(questions);

    render(<QueryClientProvider client={client()}><QuizRunner set={set("set-practice")} kind="exam" attempts={[]} preset={{ count: 3, minutes: 0, types: ["mc"] }} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));

    expect(await screen.findByText(/Exam question \d+\?/)).toBeInTheDocument();
    expect(mocks.generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ exam: true, count: 3 }) }));
    expect(mocks.prepareQuizReviewStream).not.toHaveBeenCalled();
  });

  it("builds a Comprehensive Exam from both selected sets and finalizes the requested total", async () => {
    const questions = makeQuestions(5).map((question, index) => ({ ...question, setId: index < 3 ? "set-a" : "set-b" }));
    mocks.from.mockImplementation(() => { throw new Error("Comprehensive Exams do not load image questions."); });
    mocks.generateComprehensive.mockImplementation(({ data }: { data: { prepareOnly?: boolean; count: number; generatedBySet?: { setId: string; generatedText: string }[] } }) => {
      if (!data.prepareOnly) return Promise.resolve({ questions });
      if (data.generatedBySet?.length) return Promise.resolve({ prompts: [], sourceRevisions: { "set-a": "rev-a", "set-b": "rev-b" }, databaseSourceRevisions: { "set-a": "00000000-0000-4000-8000-000000000001", "set-b": "00000000-0000-4000-8000-000000000002" }, avoidQuestionsBySet: {} });
      return Promise.resolve({ prompts: [
        { setId: "set-a", partIndex: 0, batchCount: 3, system: "comprehensive", messages: [{ role: "user", content: "set A material" }] },
        { setId: "set-b", partIndex: 0, batchCount: 2, system: "comprehensive", messages: [{ role: "user", content: "set B material" }] },
      ], sourceRevisions: { "set-a": "rev-a", "set-b": "rev-b" }, databaseSourceRevisions: { "set-a": "00000000-0000-4000-8000-000000000001", "set-b": "00000000-0000-4000-8000-000000000002" }, avoidQuestionsBySet: { "set-a": [], "set-b": [] } });
    });
    mocks.streamAiJson.mockResolvedValueOnce(questions.slice(0, 3)).mockResolvedValueOnce(questions.slice(3));

    render(<QueryClientProvider client={client()}><QuizRunner sets={[set("set-a"), set("set-b")]} kind="comprehensive" attempts={[]} preset={{ count: 5, minutes: 0, types: ["mc"] }} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));

    expect(await screen.findByText(/Exam question \d+\?/)).toBeInTheDocument();
    expect(mocks.generateComprehensive).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ setIds: ["set-a", "set-b"], count: 5 }) }));
    expect(mocks.streamAiJson).toHaveBeenCalledTimes(2);
    expect(mocks.generateComprehensive).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceRevisions: { "set-a": "rev-a", "set-b": "rev-b" } }) }));
  });
});
