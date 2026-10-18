import { describe, expect, it } from "vitest";
import { parseJson, splitTextIntoChunks } from "../lib/ai.server";

describe("parseJson", () => {
  it("reads JSON wrapped in prose and a Markdown fence", () => {
    expect(parseJson<{ ok: boolean }>(`Here is the result:\n\`\`\`json\n{"ok":true}\n\`\`\``)).toEqual({ ok: true });
  });

  it("handles nested values and braces inside JSON strings", () => {
    expect(parseJson<{ message: string; nested: { values: number[] } }>(
      `Result: {"message":"brace } and bracket ] are text","nested":{"values":[1,2,3]}} done`,
    )).toEqual({ message: "brace } and bracket ] are text", nested: { values: [1, 2, 3] } });
  });

  it("rejects empty and malformed responses rather than returning partial data", () => {
    expect(() => parseJson("  ")).toThrow(/empty/i);
    expect(() => parseJson(`{"items":[1,2}`)).toThrow(/read the AI response/i);
  });
});

describe("splitTextIntoChunks", () => {
  it("keeps all text and bounds chunks even when a block is oversized", () => {
    const source = `BEGIN\n\n${"x".repeat(31)}\n\nMIDDLE\n\nEND`;
    const chunks = splitTextIntoChunks(source, 10);
    expect(chunks.join("")).toContain("BEGIN");
    expect(chunks.join("")).toContain("MIDDLE");
    expect(chunks.join("")).toContain("END");
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it("uses a safe minimum for invalid chunk sizes", () => {
    expect(splitTextIntoChunks("abc", 0)).toEqual(["a", "b", "c"]);
    expect(splitTextIntoChunks("abc", Number.NaN)).toEqual(["abc"]);
    expect(splitTextIntoChunks("  ")).toEqual([]);
  });
});
