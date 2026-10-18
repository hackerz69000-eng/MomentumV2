import { beforeEach, describe, expect, it, vi } from "vitest";
import { addXp, levelFromXp, MAX_LEVEL, xpIntoLevel } from "@/lib/gamification";

describe("100-level progression", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses the documented square XP thresholds", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(50 * 99 * 99)).toBe(MAX_LEVEL);
    expect(xpIntoLevel(50 * 99 * 99).maxed).toBe(true);
  });

  it("caps the level at 100 and treats max-level progress as complete", () => {
    expect(levelFromXp(10_000_000)).toBe(100);
    expect(xpIntoLevel(10_000_000)).toMatchObject({ level: 100, maxed: true, current: 0 });
  });

  it("handles malformed XP values without producing NaN levels", () => {
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(Number.POSITIVE_INFINITY)).toBe(1);
    expect(levelFromXp(-100)).toBe(1);
    localStorage.setItem("momentum_xp_v1", "not-a-number");
    expect(addXp(Number.POSITIVE_INFINITY)).toBe(0);
    expect(localStorage.getItem("momentum_xp_v1")).toBe("0");
  });

  it("announces each ten-level reward milestone", () => {
    const handler = vi.fn();
    window.addEventListener("momentum_celebration", handler);
    localStorage.setItem("momentum_xp_v1", String(50 * 9 * 9 - 1));
    addXp(1);
    expect(handler.mock.calls.some(([event]) => (event as CustomEvent).detail?.kind === "level-milestone")).toBe(true);
    expect(handler.mock.calls.some(([event]) => (event as CustomEvent).detail?.id === "level-reward-10")).toBe(true);
    window.removeEventListener("momentum_celebration", handler);
  });
});
