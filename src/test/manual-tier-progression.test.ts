import { describe, expect, it } from "vitest";
import { tierFromManualStart } from "@/components/Levels";

describe("manual tier starting point", () => {
  it("uses the saved tier exactly and ignores mastery earned before the reset", () => {
    expect(tierFromManualStart(1, 30, 30)).toBe(1);
    expect(tierFromManualStart(2, 30, 30)).toBe(2);
    expect(tierFromManualStart(1, 30, 31)).toBe(1);
    expect(tierFromManualStart(1, 30, 32)).toBe(2);
  });

  it("never adds the old tier to the new tier and clamps at Tier 50", () => {
    expect(tierFromManualStart(2, 30, 60)).toBe(17);
    expect(tierFromManualStart(49, 10, 100)).toBe(50);
    expect(tierFromManualStart(1, 80, 20)).toBe(1);
  });
});
