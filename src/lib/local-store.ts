// Local persistence for study sets, flashcards, and study activity using localStorage.
import type { StudySet, Flashcard, SetWithCards } from "./queries";

const SETS_KEY = "momentum_local_study_sets";
const CARDS_KEY = "momentum_local_flashcards";

export function getLocalSets(userId?: string): SetWithCards[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SETS_KEY);
    const sets: StudySet[] = raw ? JSON.parse(raw) : [];
    const rawCards = localStorage.getItem(CARDS_KEY);
    const cards: Flashcard[] = rawCards ? JSON.parse(rawCards) : [];

    const currentUserId = userId;

    // Legacy local-auth records use usr_* IDs and cannot be sent to Supabase.
    const filteredSets = currentUserId
      ? sets.filter((s) => s.user_id === currentUserId || !s.user_id)
      : sets.filter((s) => !s.user_id);

    return filteredSets.map((s) => {
      const setCards = cards.filter((c) => c.set_id === s.id);
      return {
        ...s,
        flashcards: setCards.map((c) => ({ status: c.status })),
      };
    });
  } catch (err) {
    console.error("Failed to read local sets:", err);
    return [];
  }
}

export function getLocalSet(id: string): StudySet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETS_KEY);
    const sets: StudySet[] = raw ? JSON.parse(raw) : [];
    return sets.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}

export function getLocalCards(setId: string): Flashcard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    const cards: Flashcard[] = raw ? JSON.parse(raw) : [];
    return cards.filter((c) => c.set_id === setId).sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}

export function saveLocalSet(
  set: Partial<StudySet> & { id: string; name: string },
  cards: Array<{ question: string; answer: string; topic?: string; position?: number }>,
): { set: StudySet; cards: Flashcard[] } {
  if (typeof window === "undefined") throw new Error("Window not available");

  const rawSets = localStorage.getItem(SETS_KEY);
  const sets: StudySet[] = rawSets ? JSON.parse(rawSets) : [];
  const rawCards = localStorage.getItem(CARDS_KEY);
  const allCards: Flashcard[] = rawCards ? JSON.parse(rawCards) : [];

  const now = new Date().toISOString();
  const userId = set.user_id;
  if (!userId || userId.startsWith("usr_")) {
    throw new Error("A real Supabase Auth user is required to save study data.");
  }

  const fullSet: StudySet = {
    id: set.id,
    user_id: userId,
    name: set.name,
    subject: set.subject ?? null,
    description: set.description ?? null,
    custom_instructions: set.custom_instructions ?? null,
    material_text: set.material_text ?? null,
    material_source: set.material_source ?? "local",
    material_filename: set.material_filename ?? null,
    notes: set.notes ?? null,
    status: set.status ?? "ready",
    error: null,
    quiz_score: set.quiz_score ?? null,
    quiz_total: set.quiz_total ?? null,
    created_at: set.created_at ?? now,
    updated_at: now,
    folder_id: set.folder_id ?? null,
  };

  const existingIdx = sets.findIndex((s) => s.id === set.id);
  if (existingIdx >= 0) {
    sets[existingIdx] = fullSet;
  } else {
    sets.unshift(fullSet);
  }
  localStorage.setItem(SETS_KEY, JSON.stringify(sets));

  // Replace cards for this set
  const otherCards = allCards.filter((c) => c.set_id !== set.id);
  const newCards: Flashcard[] = cards.map((c, idx) => ({
    id: `card_${set.id}_${idx}_${Date.now()}`,
    set_id: set.id,
    user_id: userId,
    question: c.question,
    answer: c.answer,
    topic: c.topic ?? null,
    position: c.position ?? idx,
    status: "new",
    interval_days: 0,
    reps: 0,
    lapses: 0,
    due_at: now,
    last_reviewed_at: null,
    is_custom: false,
    created_at: now,
  }));

  localStorage.setItem(CARDS_KEY, JSON.stringify([...otherCards, ...newCards]));
  return { set: fullSet, cards: newCards };
}

export function updateLocalCardStatus(
  cardId: string,
  patch: string | Partial<Flashcard>,
) {
  if (typeof window === "undefined") return;
  try {
    const rawCards = localStorage.getItem(CARDS_KEY);
    const cards: Flashcard[] = rawCards ? JSON.parse(rawCards) : [];
    const card = cards.find((c) => c.id === cardId);
    if (card) {
      if (typeof patch === "string") {
        card.status = patch;
      } else {
        Object.assign(card, patch);
      }
      localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
    }
  } catch (err) {
    console.error("Failed to update card status:", err);
  }
}

export function updateLocalSetProgress(setId: string, score: number, total: number) {
  if (typeof window === "undefined") return;
  try {
    const rawSets = localStorage.getItem(SETS_KEY);
    const sets: StudySet[] = rawSets ? JSON.parse(rawSets) : [];
    const s = sets.find((item) => item.id === setId);
    if (s) {
      s.quiz_score = score;
      s.quiz_total = total;
      s.updated_at = new Date().toISOString();
      localStorage.setItem(SETS_KEY, JSON.stringify(sets));
    }
  } catch (err) {
    console.error("Failed to update set progress:", err);
  }
}

export function deleteLocalSet(setId: string) {
  if (typeof window === "undefined") return;
  try {
    const rawSets = localStorage.getItem(SETS_KEY);
    const sets: StudySet[] = rawSets ? JSON.parse(rawSets) : [];
    const filteredSets = sets.filter((s) => s.id !== setId);
    localStorage.setItem(SETS_KEY, JSON.stringify(filteredSets));

    const rawCards = localStorage.getItem(CARDS_KEY);
    const cards: Flashcard[] = rawCards ? JSON.parse(rawCards) : [];
    const filteredCards = cards.filter((c) => c.set_id !== setId);
    localStorage.setItem(CARDS_KEY, JSON.stringify(filteredCards));
  } catch (err) {
    console.error("Failed to delete local set:", err);
  }
}
