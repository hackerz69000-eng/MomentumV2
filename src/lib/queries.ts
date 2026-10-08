import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getLocalSets, getLocalSet, getLocalCards } from "./local-store";

export type StudySet = Tables<"study_sets">;
export type Flashcard = Tables<"flashcards">;
export type SetWithCards = StudySet & { flashcards: Pick<Flashcard, "status">[] };

export async function fetchSets(): Promise<SetWithCards[]> {
  const local = getLocalSets();
  try {
    const { data, error } = await supabase
      .from("study_sets")
      .select("*, flashcards(status)")
      .order("updated_at", { ascending: false });

    if (error || !data) {
      return local;
    }

    const remoteSets = data as SetWithCards[];
    // Merge remote and local (avoiding duplicates by id)
    const remoteIds = new Set(remoteSets.map((s) => s.id));
    const uniqueLocal = local.filter((s) => !remoteIds.has(s.id));
    return [...remoteSets, ...uniqueLocal];
  } catch {
    return local;
  }
}

export async function fetchSet(id: string): Promise<StudySet> {
  try {
    const { data, error } = await supabase.from("study_sets").select("*").eq("id", id).single();
    if (error || !data) {
      const local = getLocalSet(id);
      if (local) return local;
      throw error || new Error("Study set not found");
    }
    return data;
  } catch (err) {
    const local = getLocalSet(id);
    if (local) return local;
    throw err;
  }
}

export async function fetchCards(setId: string): Promise<Flashcard[]> {
  try {
    const { data, error } = await supabase
      .from("flashcards")
      .select("*")
      .eq("set_id", setId)
      .order("position");

    if (error || !data || data.length === 0) {
      const local = getLocalCards(setId);
      if (local.length > 0) return local;
      return (data ?? []) as Flashcard[];
    }
    return data as Flashcard[];
  } catch {
    return getLocalCards(setId);
  }
}
