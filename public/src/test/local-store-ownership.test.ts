import { beforeEach, describe, expect, it } from "vitest";
import { getLocalCards, getLocalSet, getLocalSets } from "@/lib/local-store";
import type { Flashcard, StudySet } from "@/lib/queries";

describe("local fallback data ownership", () => {
  beforeEach(() => localStorage.clear());

  it("does not expose unowned legacy sets to signed-in accounts on shared devices", () => {
    const sets = [
      { id: "set-a", user_id: "user-a", name: "A" },
      { id: "set-b", user_id: "user-b", name: "B" },
      { id: "legacy", name: "Legacy" },
    ] as unknown as StudySet[];
    localStorage.setItem("momentum_local_study_sets", JSON.stringify(sets));
    localStorage.setItem("momentum_local_flashcards", JSON.stringify([]));

    expect(getLocalSets("user-a").map((set) => set.id)).toEqual(["set-a"]);
    expect(getLocalSets("user-b").map((set) => set.id)).toEqual(["set-b"]);
    expect(getLocalSets().map((set) => set.id)).toEqual(["legacy"]);
  });

  it("does not load another account's or unowned set/cards by ID", () => {
    const sets = [
      { id: "private-set", user_id: "user-b", name: "Private" },
      { id: "legacy-set", name: "Legacy" },
    ] as unknown as StudySet[];
    const cards = [
      { id: "card-b", set_id: "private-set", user_id: "user-b", position: 0 },
      { id: "legacy-card", set_id: "legacy-set", position: 0 },
    ] as unknown as Flashcard[];
    localStorage.setItem("momentum_local_study_sets", JSON.stringify(sets));
    localStorage.setItem("momentum_local_flashcards", JSON.stringify(cards));

    expect(getLocalSet("private-set", "user-a")).toBeNull();
    expect(getLocalSet("legacy-set", "user-a")).toBeNull();
    expect(getLocalCards("private-set", "user-a")).toEqual([]);
    expect(getLocalCards("legacy-set", "user-a")).toEqual([]);
  });
});
