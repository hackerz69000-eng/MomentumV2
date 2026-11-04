import { describe, expect, it } from "vitest";
import { splitSpeechChunks } from "@/lib/speech-text";

describe("splitSpeechChunks", () => {
  it("removes common Markdown formatting while preserving readable text", () => {
    expect(splitSpeechChunks("## Key idea\n\n**Photosynthesis** is important.\n\n- It uses light."))
      .toEqual(["Key idea\n\nPhotosynthesis is important.\nIt uses light."]);
  });

  it("keeps every chunk within the requested character limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} explains the concept in detail.`).join(" ");
    const chunks = splitSpeechChunks(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.join(" ")).toContain("Sentence 40");
  });

  it("handles a single oversized paragraph without dropping its tail", () => {
    const text = "x".repeat(1000);
    const chunks = splitSpeechChunks(text, 250);
    expect(chunks).toHaveLength(4);
    expect(chunks.join("")).toBe(text);
  });

  it("returns no chunks for empty input", () => {
    expect(splitSpeechChunks("  \n\n  ")).toEqual([]);
  });
});
