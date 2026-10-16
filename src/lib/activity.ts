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
    { name: "First Steps", done: s.sessions >= 1 },
    { name: "Card Starter", done: s.flashcards >= 10 },
    { name: "Card Apprentice", done: s.flashcards >= 50 },
    { name: "Card Centurion", done: s.flashcards >= 100 },
    { name: "Card Archivist", done: s.flashcards >= 500 },
    { name: "First Quiz", done: s.quizzes >= 1 },
    { name: "Quiz Regular", done: s.quizzes >= 5 },
    { name: "Quiz Veteran", done: s.quizzes >= 10 },
    { name: "Exam Ready", done: s.exams >= 1 },
    { name: "Exam Veteran", done: s.exams >= 5 },
    { name: "Recall in Motion", done: s.recall >= 5 },
    { name: "Recall Specialist", done: s.recall >= 25 },
    { name: "Three-Day Spark", done: s.longest >= 3 },
    { name: "Week of Momentum", done: s.longest >= 7 },
    { name: "Fortnight Focus", done: s.longest >= 14 },
    { name: "Monthly Momentum", done: s.longest >= 30 },
    { name: "Consistency Builder", done: s.daysStudied >= 10 },
    { name: "Seasoned Learner", done: s.daysStudied >= 30 },
    { name: "Study Session Veteran", done: s.sessions >= 25 },
    { name: "Century of Sessions", done: s.sessions >= 100 },
  ];
}
