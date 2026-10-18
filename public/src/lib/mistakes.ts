// Mistake Bank: client-side recording of right/wrong answers. Lives on top of quiz_attempts, never replaces it.
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Mistake } from "./stats";

export type MistakeStatus = "review" | "improving" | "mastered";
export const MASTERED_AFTER = 3; // correct answers in a row after the last miss

export type ResultItem = {
  setId: string;
  question: string;
  correct: boolean;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
  topic: string;
  kind: string;
  data?: Json | null;
};

export const mistakeKey = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

export function nextStatus(streak: number): MistakeStatus {
  return streak >= MASTERED_AFTER ? "mastered" : streak >= 1 ? "improving" : "review";
}

/** Wrong answers add/increment a mistake; correct answers to a known mistake advance it toward mastered. */
export async function recordResults(userId: string, items: ResultItem[], qc?: QueryClient) {
  if (!items.length) return;
  const keys = [...new Set(items.map((i) => mistakeKey(i.question)))];
  const setIds = [...new Set(items.map((i) => i.setId))];
  const { data: existing } = await supabase
    .from("mistakes")
    .select("*")
    .in("set_id", setIds)
    .in("key", keys);
  const byKey = new Map((existing ?? []).map((m) => [`${m.set_id}|${m.key}`, m as Mistake]));
  const now = new Date().toISOString();
  const rows: Partial<Mistake>[] = [];
  for (const it of items) {
    const key = mistakeKey(it.question);
    if (!key) continue;
    const prev = byKey.get(`${it.setId}|${key}`);
    if (it.correct) {
      if (!prev) continue;
      const streak = prev.right_streak + 1;
      rows.push({ ...prev, right_streak: streak, status: nextStatus(streak), last_seen_at: now });
    } else {
      rows.push({
        ...(prev ?? {}),
        user_id: userId,
        set_id: it.setId,
        key,
        question: it.question.slice(0, 2000),
        student_answer: (it.studentAnswer || "(no answer)").slice(0, 2000),
        correct_answer: it.correctAnswer.slice(0, 2000),
        explanation: it.explanation.slice(0, 2000),
        topic: (it.topic || "General").slice(0, 80),
        source_kind: it.kind,
        question_data: it.data ?? prev?.question_data ?? null,
        wrong_count: (prev?.wrong_count ?? 0) + 1,
        right_streak: 0,
        status: "review",
        last_wrong_at: now,
        last_seen_at: now,
      });
    }
    byKey.set(`${it.setId}|${key}`, rows[rows.length - 1] as Mistake);
  }
  if (!rows.length) return;
  const { error } = await supabase
    .from("mistakes")
    .upsert(rows as never, { onConflict: "user_id,set_id,key", defaultToNull: false });
  if (error) console.error("mistake bank", error.message);
  for (const s of setIds) qc?.invalidateQueries({ queryKey: ["mistakes", s] });
  qc?.invalidateQueries({ queryKey: ["mistakes", "all"] });
}

export async function fetchMistakes(setId: string): Promise<Mistake[]> {
  try {
    const { data, error } = await supabase
      .from("mistakes")
      .select("*")
      .eq("set_id", setId)
      .order("wrong_count", { ascending: false })
      .order("last_wrong_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as Mistake[];
  } catch {
    return [];
  }
}
