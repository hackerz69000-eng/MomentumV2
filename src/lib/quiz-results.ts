import type { QuizQuestion } from "@/lib/study.functions";

export type QuizAnswer = number | string | null | undefined;
export type QuizGrade = { correct: boolean; feedback?: string };
export type QuizVisualReference = {
  data: string;
  name: string;
  path: string;
  kind: "image" | "pdf" | "pptx" | "docx";
  sourceIndex: number;
};

export function attachQuizVisuals<T extends QuizQuestion>(questions: T[], visuals: QuizVisualReference[]): T[] {
  return questions.map((question) => {
    const index = question.imageIndex;
    if (!Number.isInteger(index) || index == null || index < 0 || index >= visuals.length) return question;
    const visual = visuals[index];
    if (!visual) return question;
    return {
      ...question,
      ...(visual.kind === "pptx" || visual.kind === "docx" ? { imageDataUrl: visual.data } : {}),
      imageKind: visual.kind,
      imageSourceIndex: visual.sourceIndex,
      imageName: visual.name,
      imagePath: visual.path,
    };
  });
}

export function scoreQuizAnswer(question: QuizQuestion, answer: QuizAnswer, shortAnswerGrade: QuizGrade | boolean = false): QuizGrade {
  if (question.type !== "short") return { correct: answer === question.answer };
  return typeof shortAnswerGrade === "boolean" ? { correct: shortAnswerGrade } : shortAnswerGrade;
}

export function serializeQuizAnswer(question: QuizQuestion, answer: QuizAnswer, grade: QuizGrade) {
  const studentAnswer = answer == null || String(answer).trim() === ""
    ? "Not answered"
    : question.type === "short"
      ? String(answer)
      : (question.options[Number(answer)] ?? "");
  const correctAnswer = question.type === "short" ? question.answerText || "" : question.options[question.answer] ?? "";
  return {
    topic: question.topic,
    correct: grade.correct,
    q: question.question,
    question: question.question,
    questionType: question.type,
    options: question.options,
    studentAnswer,
    correctAnswer,
    explanation: question.explanation || grade.feedback || "",
    ...(question.imageName ? { imageName: question.imageName } : {}),
    ...(question.imagePath ? { imagePath: question.imagePath } : {}),
    ...(question.imageKind ? { imageKind: question.imageKind } : {}),
    ...(question.imageSourceIndex != null ? { imageSourceIndex: question.imageSourceIndex } : {}),
  };
}
