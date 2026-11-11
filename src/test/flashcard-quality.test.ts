import { describe, expect, it } from "vitest";
import { deduplicateFlashcards, isValidClozePrompt, readGeneratedFlashcards, targetFlashcardCount } from "@/lib/flashcard-quality";

describe("flashcard quality controls", () => {
  it("normalizes common AI response wrappers and field names", () => {
    expect(readGeneratedFlashcards({ flashcards: [{ question: "What is ATP?", answer: "Cell energy currency", topic: "Cellular energy", type: "qa" }] })).toEqual([
      { q: "What is ATP?", a: "Cell energy currency", t: "Cellular energy", kind: "qa" },
    ]);
    expect(readGeneratedFlashcards({ data: { cards: [{ q: "Respiration uses {{c1::oxygen}} as the final electron acceptor in aerobic cells.", a: "Oxygen", kind: "cloze" }] } })).toHaveLength(1);
    expect(readGeneratedFlashcards('[{"q":"Question","a":"Answer"}]')).toHaveLength(1);
  });

  it("reports a useful error when no card list is present", () => {
    expect(() => readGeneratedFlashcards({ message: "no cards" })).toThrow(/did not contain a flashcard list/i);
  });
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
