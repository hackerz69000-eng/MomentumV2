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

  it("leaves ordinary prose and lists intact", () => {
    const input = "# Guide\n\nA short overview.\n\n- **Term** — definition\n- Second item";
    expect(formatStudyGuideMarkdown(input)).toBe(input);
  });

  it("does not convert a table unless a separator row is present", () => {
    const input = "This sentence has | a pipe | but is not a table.";
    expect(formatStudyGuideMarkdown(input)).toBe(input);
  });
});
