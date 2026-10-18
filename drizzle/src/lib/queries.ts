import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getLocalSets, getLocalSet, getLocalCards } from "./local-store";

export type StudySet = Tables<"study_sets">;
export type Flashcard = Tables<"flashcards">;
export type SetWithCards = StudySet & { flashcards: Pick<Flashcard, "status">[] };

const REMOTE_SET_MAP_KEY = "momentum_remote_set_map";

async function currentUserId(): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id;
  } catch {
    return undefined;
  }
}

function getRemoteSetId(localId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const map = JSON.parse(localStorage.getItem(REMOTE_SET_MAP_KEY) || "{}") as Record<string, string>;
    return map[localId] || null;
  } catch {
    return null;
  }
}

function saveRemoteSetId(localId: string, remoteId: string) {
  if (typeof window === "undefined") return;
  try {
    const map = JSON.parse(localStorage.getItem(REMOTE_SET_MAP_KEY) || "{}") as Record<string, string>;
    map[localId] = remoteId;
    localStorage.setItem(REMOTE_SET_MAP_KEY, JSON.stringify(map));
  } catch {
    // Non-critical migration metadata.
  }
}

/**
 * Older versions could create a local-only set when the Supabase insert failed.
 * Migrate that set once so server-side study modes can use the same real UUID.
 */
async function migrateLocalSet(localId: string, local: StudySet): Promise<StudySet | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  // A local record belonging to another signed-in account must never be copied
  // into the current account during the legacy-data migration.
  if (local.user_id && local.user_id !== userId) return null;

  const mapped = getRemoteSetId(localId);
  if (mapped) {
    const { data } = await supabase.from("study_sets").select("*").eq("id", mapped).eq("user_id", userId).single();
    if (data) return data as StudySet;
  }

  const { data: remote, error } = await supabase
    .from("study_sets")
    .insert({
      user_id: userId,
      name: local.name,
      subject: local.subject ?? "",
      description: local.description ?? "",
      custom_instructions: local.custom_instructions ?? "",
      material_text: local.material_text ?? "",
      material_source: local.material_source ?? "text",
      material_filename: local.material_filename ?? null,
      notes: local.notes ?? null,
      status: local.status ?? "ready",
      error: local.error ?? null,
      quiz_score: local.quiz_score ?? null,
      quiz_total: local.quiz_total ?? null,
    })
    .select("*")
    .single();

  if (error || !remote) return null;

  const localCards = getLocalCards(localId, userId);
  if (localCards.length) {
    const { error: cardError } = await supabase.from("flashcards").insert(
      localCards.map((c, i) => ({
        set_id: remote.id,
        user_id: userId,
        question: c.question,
        answer: c.answer,
        topic: c.topic ?? "",
        position: i,
        status: c.status ?? "new",
      })),
    );
    if (cardError) {
      // The set is still usable; the cards can be regenerated from its notes.
      console.warn("Local flashcards could not be migrated:", cardError.message);
    }
  }

  saveRemoteSetId(localId, remote.id);
  return remote as StudySet;
}

export async function fetchSets(): Promise<SetWithCards[]> {
  const userId = await currentUserId();
  const local = getLocalSets(userId);
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
  const userId = await currentUserId();
  const mapped = getRemoteSetId(id);
  const lookupId = mapped || id;
  try {
    let query = supabase.from("study_sets").select("*").eq("id", lookupId);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.single();
    if (data) return data as StudySet;

    const local = getLocalSet(id, userId);
    if (local) {
      const migrated = await migrateLocalSet(id, local);
      if (migrated) return migrated;
    }
    throw error || new Error("Study set not found");
  } catch (err) {
    const local = getLocalSet(id, userId);
    if (local) {
      const migrated = await migrateLocalSet(id, local);
      if (migrated) return migrated;
    }
    throw err;
  }
}

export async function fetchCards(setId: string): Promise<Flashcard[]> {
  const userId = await currentUserId();
  const remoteId = getRemoteSetId(setId) || setId;
  try {
    const { data, error } = await supabase
      .from("flashcards")
      .select("*")
      .eq("set_id", remoteId)
      .order("position");

    if (!error && data && data.length > 0) return data as Flashcard[];

    const local = getLocalCards(setId, userId);
    if (local.length > 0) return local;
    return (data ?? []) as Flashcard[];
  } catch {
    return getLocalCards(setId, userId);
  }
}
