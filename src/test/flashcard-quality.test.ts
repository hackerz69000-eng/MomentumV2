import { describe, expect, it } from "vitest";
import { deduplicateFlashcards, isValidClozePrompt, targetFlashcardCount } from "@/lib/flashcard-quality";

describe("flashcard quality controls", () => {
  it("requires a complete contextual sentence for cloze cards", () => {
    expect(isValidClozePrompt("During aerobic respiration, the electron transport chain drives {{c1::ATP synthase}} to produce ATP." )).toBe(true);
    expect(isValidClozePrompt("________")).toBe(false);
    expect(isValidClozePrompt("{{c1::ATP}}")).toBe(false);
  });

  it("removes exact and near-duplicate prompts", () => {
    const cards = deduplicateFlashcards([
      { q: "What is ATP?", a: "The cell's main energy currency.", kind: "qa" as const },
      { q: "What is ATP?!", a: "The cell's main energy currency.", kind: "qa" as const },
      { q: "How does ATP synthase work in oxidative phosphorylation?", a: "It uses a proton gradient to make ATP.", kind: "qa" as const },
    ]);
    expect(cards).toHaveLength(2);
  });

  it("does not keep malformed cloze cards as ordinary Q&A cards", () => {
    const cards = deduplicateFlashcards([
      { q: "________", a: "ATP", kind: "cloze" as const },
      { q: "A complete contextual sentence about how cells use {{c1::ATP synthase}} during respiration.", a: "ATP synthase", kind: "cloze" as const },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.kind).toBe("cloze");
  });

  it("scales the requested deck size with source length", () => {
    expect(targetFlashcardCount("word ".repeat(100))).toBe(5);
    expect(targetFlashcardCount("word ".repeat(1000))).toBe(14);
    expect(targetFlashcardCount("word ".repeat(5000))).toBe(34);
  });
});
