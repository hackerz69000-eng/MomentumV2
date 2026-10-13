import { beforeEach, describe, expect, it } from "vitest";
import { getLocalCards, getLocalSet, getLocalSets } from "@/lib/local-store";
import type { Flashcard, StudySet } from "@/lib/queries";

describe("local fallback data ownership", () => {
  beforeEach(() => localStorage.clear());

  it("only returns local study sets owned by the active account plus legacy unowned sets", () => {
    const sets = [
      { id: "set-a", user_id: "user-a", name: "A" },
      { id: "set-b", user_id: "user-b", name: "B" },
      { id: "legacy", name: "Legacy" },
    ] as unknown as StudySet[];
    localStorage.setItem("momentum_local_study_sets", JSON.stringify(sets));
    localStorage.setItem("momentum_local_flashcards", JSON.stringify([]));

    expect(getLocalSets("user-a").map((set) => set.id)).toEqual(["set-a", "legacy"]);
    expect(getLocalSets("user-b").map((set) => set.id)).toEqual(["set-b", "legacy"]);
  });

  it("does not load another account's set or cards by ID", () => {
    const sets = [{ id: "private-set", user_id: "user-b", name: "Private" }] as unknown as StudySet[];
    const cards = [{ id: "card-b", set_id: "private-set", user_id: "user-b", position: 0 }] as unknown as Flashcard[];
    localStorage.setItem("momentum_local_study_sets", JSON.stringify(sets));
    localStorage.setItem("momentum_local_flashcards", JSON.stringify(cards));

    expect(getLocalSet("private-set", "user-a")).toBeNull();
    expect(getLocalCards("private-set", "user-a")).toEqual([]);
  });
});
