import { describe, expect, it } from "vitest";
import { formatStudyGuideMarkdown } from "@/lib/study-guide-format";

describe("formatStudyGuideMarkdown", () => {
  it("turns escaped, collapsed Markdown tables into readable labeled lists", () => {
    const input = String.raw`## Topic Map

\| Topic \| Source(s) \| Key Focus \| \|-------\|-----------\|-----------\| \| Neolithic Revolution \| 1 \| Transition to farming \| \| Urban Revolution \| 1 \| Irrigation and surplus \|`;
    const result = formatStudyGuideMarkdown(input);

    expect(result).toContain("## Topic Map");
    expect(result).toContain("- **Neolithic Revolution**");
    expect(result).toContain("**Source(s):** 1");
    expect(result).toContain("**Key Focus:** Transition to farming");
    expect(result).toContain("- **Urban Revolution**");
    expect(result).not.toContain("|-------|");
  });

  it("cleans escaped line breaks and converts the Assignment Helper's flattened tables", () => {
    const input = String.raw`## Requirements

\| Deliverable \| What it means \| \|-------------\|----------------\| \| **Clear position** \| State your view\<br>and explain it \|`;
    const result = formatStudyGuideMarkdown(input);

    expect(result).toContain("- **Clear position**");
    expect(result).toContain("**What it means:** State your view");
    expect(result).toContain("and explain it");
    expect(result).not.toContain("|-------------|");
    expect(result).not.toContain("<br>");
  });

  it("leaves ordinary prose and lists intact", () => {
    const input = "# Guide\n\nA short overview.\n\n- **Term** — definition\n- Second item";
    expect(formatStudyGuideMarkdown(input)).toBe(input);
  });

  it("does not convert a table unless a separator row is present", () => {
    const input = "This sentence has | a pipe | but is not a table.";
    expect(formatStudyGuideMarkdown(input)).toBe(input);
  });
});
