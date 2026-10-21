import { describe, expect, it } from "vitest";
import { isNearDuplicateQuestion } from "@/lib/question-quality";

describe("isNearDuplicateQuestion", () => {
  it("detects identical questions despite punctuation and casing", () => {
    expect(isNearDuplicateQuestion("What causes cellular respiration?", "what causes cellular respiration")).toBe(true);
  });

  it("detects near-identical paraphrases that test the same idea", () => {
    expect(isNearDuplicateQuestion(
      "What is the main function of mitochondria in cellular respiration?",
      "Explain the primary function of mitochondria in cellular respiration.",
    )).toBe(true);
  });

  it("keeps distinct questions about the same broad topic", () => {
    expect(isNearDuplicateQuestion(
      "How does glycolysis produce ATP in the cytoplasm?",
      "Where does the electron transport chain create a proton gradient?",
    )).toBe(false);
  });
});
