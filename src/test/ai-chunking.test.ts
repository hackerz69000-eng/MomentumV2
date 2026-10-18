import { describe, expect, it } from "vitest";
import { splitTextIntoChunks } from "../lib/ai.server";

describe("splitTextIntoChunks", () => {
  it("keeps text from the beginning, middle, and end of long material", () => {
    const source = `BEGIN_SENTINEL\n\n${"paragraph content ".repeat(1200)}\n\nMIDDLE_SENTINEL\n\n${"more source text ".repeat(1200)}\n\nEND_SENTINEL`;
    const chunks = splitTextIntoChunks(source, 4000);
    const joined = chunks.join("\n\n");
    expect(chunks.length).toBeGreaterThan(1);
    expect(joined).toContain("BEGIN_SENTINEL");
    expect(joined).toContain("MIDDLE_SENTINEL");
    expect(joined).toContain("END_SENTINEL");
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
  });

  it("returns no chunks for blank input and preserves a short source", () => {
    expect(splitTextIntoChunks("  ")).toEqual([]);
    expect(splitTextIntoChunks("alpha\n\nbeta", 100)).toEqual(["alpha\n\nbeta"]);
  });
});
