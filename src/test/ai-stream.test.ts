import { describe, expect, it } from "vitest";
import { parseStreamedJson } from "../lib/ai-stream.client";

describe("parseStreamedJson", () => {
  it("parses plain JSON", () => {
    expect(parseStreamedJson('{"cards":[{"q":"Q","a":"A"}]}', (value) => value)).toEqual({
      cards: [{ q: "Q", a: "A" }],
    });
  });

  it("parses fenced JSON with optional language labels", () => {
    expect(parseStreamedJson('```json\n{"ok":true}\n```', (value) => value)).toEqual({ ok: true });
    expect(parseStreamedJson('```\n{"ok":true}\n```', (value) => value)).toEqual({ ok: true });
  });

  it("extracts JSON when the model adds a short preamble or trailing text", () => {
    expect(parseStreamedJson('Here are the cards:\n{"cards":[{"q":"Q","a":"A"}]}\nDone.', (value) => value)).toEqual({
      cards: [{ q: "Q", a: "A" }],
    });
  });

  it("ignores a reasoning block before the final JSON payload", () => {
    expect(parseStreamedJson('<think>Let me reason this through.</think>\n{"ok":true}', (value) => value)).toEqual({ ok: true });
  });

  it("runs feature validation after parsing", () => {
    expect(() => parseStreamedJson('{"cards":[]}', (value) => {
      const cards = (value as { cards?: unknown }).cards;
      if (!Array.isArray(cards) || cards.length === 0) throw new Error("No cards");
      return cards;
    })).toThrow("No cards");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseStreamedJson('{"cards":[}', (value) => value)).toThrow(/malformed structured data/i);
  });
});
