import { describe, expect, it } from "vitest";
import { attachQuizVisuals, scoreQuizAnswer, serializeQuizAnswer } from "@/lib/quiz-results";
import { topicStats } from "@/lib/stats";
import type { QuizQuestion } from "@/lib/study.functions";
import type { Attempt } from "@/lib/stats";

const question = (type: QuizQuestion["type"], imageIndex = 0): QuizQuestion => ({
  type,
  question: "What does the figure show?",
  options: type === "short" ? [] : ["A", "B"],
  answer: 1,
  answerText: "B",
  explanation: "The source labels this as B.",
  topic: "Cell structure",
  imageIndex,
});

const visual = { data: "data:image/jpeg;base64,encoded-image", name: "Lecture — figure 1", path: "user/set/lecture.docx", kind: "docx" as const, sourceIndex: 0 };

describe("image-supported quiz results", () => {
  it.each(["mc", "tf", "short"] as const)("attaches a grounded visual to %s questions", (type) => {
    const [result] = attachQuizVisuals([question(type)], [visual]);
    expect(result?.imagePath).toBe(visual.path);
    expect(result?.imageName).toBe(visual.name);
    expect(result?.imageKind).toBe("docx");
    expect(result?.imageDataUrl).toBe(visual.data);
  });

  it("leaves invalid image references unattached", () => {
    const result = attachQuizVisuals([question("mc", 3)], [visual]);
    expect(result[0]?.imagePath).toBeUndefined();
  });

  it("scores multiple-choice and true/false by selected option, and uses the short-answer grade", () => {
    expect(scoreQuizAnswer(question("mc"), 1).correct).toBe(true);
    expect(scoreQuizAnswer(question("tf"), 0).correct).toBe(false);
    expect(scoreQuizAnswer(question("short"), "B", { correct: true, feedback: "Equivalent wording." })).toEqual({ correct: true, feedback: "Equivalent wording." });
  });

  it("saves a compact review snapshot with image references, then exposes it to topic analytics", () => {
    const attached = attachQuizVisuals([question("mc")], [visual])[0]!;
    const snapshot = serializeQuizAnswer(attached, 1, { correct: true });
    expect(snapshot).toMatchObject({ topic: "Cell structure", questionType: "mc", correct: true, imagePath: visual.path, imageKind: "docx", imageSourceIndex: 0 });
    expect(snapshot.studentAnswer).toBe("B");
    expect(JSON.stringify(snapshot)).not.toContain("encoded-image");
    const attempt = {
      id: "attempt-image", user_id: "user-1", set_id: "set-1", kind: "quiz", difficulty: "easy",
      score: 1, total: 1, duration_seconds: 30, results: [snapshot], created_at: new Date().toISOString(),
    } as unknown as Attempt;
    expect(topicStats([], [attempt]).find((row) => row.topic === "Cell structure")).toMatchObject({ accuracy: 100, samples: 1, status: "Strong" });
  });
});
