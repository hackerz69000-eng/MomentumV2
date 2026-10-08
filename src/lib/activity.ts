import type { Tables } from "@/integrations/supabase/types";

export type Activity = Tables<"study_activity">;
export type ActivityKind =
  | "flashcard"
  | "quiz"
  | "adaptive"
  | "exam"
  | "comprehensive"
  | "recall"
  | "guide"
  | "session"
  | "mistake"
  | "lecture"
  | "audio";

/** Local YYYY-MM-DD for a timestamp, shifted by the viewer's timezone offset (minutes, as from getTimezoneOffset). */
export function dayKey(iso: string, tzOffsetMin = new Date().getTimezoneOffset()) {
  return new Date(new Date(iso).getTime() - tzOffsetMin * 60000).toISOString().slice(0, 10);
}

const prevDay = (k: string) =>
  new Date(Date.parse(k + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

export function activityStats(
  rows: Pick<Activity, "kind" | "count" | "created_at">[],
  tzOffsetMin = new Date().getTimezoneOffset(),
) {
  const days = [...new Set(rows.map((r) => dayKey(r.created_at, tzOffsetMin)))].sort();
  const today = dayKey(new Date().toISOString(), tzOffsetMin);
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && prevDay(d) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const set = new Set(days);
  let current = 0;
  let cursor = set.has(today) ? today : prevDay(today);
  while (set.has(cursor)) {
    current++;
    cursor = prevDay(cursor);
  }
  // sessions: activity bursts separated by 30+ minutes
  const times = rows.map((r) => Date.parse(r.created_at)).sort((a, b) => a - b);
  let sessions = 0;
  let last = -Infinity;
  for (const t of times) {
    if (t - last > 30 * 60000) sessions++;
    last = t;
  }
  const sum = (k: ActivityKind) =>
    rows.filter((r) => r.kind === k).reduce((s, r) => s + r.count, 0);
  return {
    current,
    longest,
    daysStudied: days.length,
    studiedToday: set.has(today),
    sessions,
    flashcards: sum("flashcard"),
    quizzes: sum("quiz") + sum("adaptive"),
    exams: sum("exam") + sum("comprehensive"),
    recall: sum("recall"),
  };
}

export type ActivityStats = ReturnType<typeof activityStats>;

export function achievements(s: ActivityStats) {
  return [
    { name: "First Study Session", done: s.sessions >= 1 },
    { name: "10 Flashcards Reviewed", done: s.flashcards >= 10 },
    { name: "First Quiz Completed", done: s.quizzes >= 1 },
    { name: "First Practice Exam", done: s.exams >= 1 },
    { name: "3 Day Streak", done: s.longest >= 3 },
    { name: "7 Day Streak", done: s.longest >= 7 },
    { name: "14 Day Streak", done: s.longest >= 14 },
    { name: "30 Day Streak", done: s.longest >= 30 },
    { name: "100 Flashcards Reviewed", done: s.flashcards >= 100 },
    { name: "10 Quizzes Completed", done: s.quizzes >= 10 },
  ];
}
