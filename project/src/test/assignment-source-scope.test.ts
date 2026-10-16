import { describe, expect, it } from "vitest";
import { restrictAssignmentSource } from "@/lib/assignment-source-scope";

describe("assignment source permission limits", () => {
  const pages = [1, 2, 3, 4].map((n) => `## Page ${n}\nContent from page ${n}`).join("\n\n");

  it("includes only the first N labeled document pages", () => {
    const result = restrictAssignmentSource(pages, "Use only the first 2 pages");
    expect(result.text).toContain("Content from page 1");
    expect(result.text).toContain("Content from page 2");
    expect(result.text).not.toContain("Content from page 3");
    expect(result.note).toContain("Verify that these page labels match");
  });

  it("isolates an explicitly identified PDF page range", () => {
    const result = restrictAssignmentSource(pages, "PDF pages 2-3 only");
    expect(result.text).toContain("Content from page 2");
    expect(result.text).toContain("Content from page 3");
    expect(result.text).not.toContain("Content from page 1");
    expect(result.text).not.toContain("Content from page 4");
  });

  it("fails closed when page restrictions cannot be isolated", () => {
    const result = restrictAssignmentSource("Unpaginated source text", "pages 2-3 only");
    expect(result.text).toBe("");
    expect(result.note).toContain("Do not use this source");
  });

  it("does not send the full source for an unrecognized scope", () => {
    const result = restrictAssignmentSource("Whole book contents", "only the assigned subsection");
    expect(result.text).toBe("");
    expect(result.note).toContain("cannot be reliably isolated");
  });

  it("isolates requested chapters or fails closed if chapter labels are missing", () => {
    const text = "## Chapter 1\nOne\n## Chapter 2\nTwo\n## Chapter 3\nThree";
    const result = restrictAssignmentSource(text, "Chapter 2 only");
    expect(result.text).toContain("Two");
    expect(result.text).not.toContain("One");
    expect(result.text).not.toContain("Three");
    expect(restrictAssignmentSource("No chapter markers", "Chapter 2 only").text).toBe("");
  });
});
