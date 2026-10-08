import type { Tables } from "@/integrations/supabase/types";

export type Flashcard = Tables<"flashcards">;
export type Attempt = Tables<"quiz_attempts">;
export type Rating = "again" | "hard" | "good" | "easy" | "know";
export type AttemptResult = { topic: string; correct: boolean; q?: string; grade?: string };

export const QUIZ_KINDS = ["quiz", "adaptive"];
export const EXAM_KINDS = ["exam", "comprehensive"];

const DAY = 86400000;

export interface SRSCardState {
  interval_days: number;
  reps: number;
  lapses: number;
  status: string;
  due_at: string;
  last_reviewed_at: string;
  ease_factor?: number;
}

/**
 * SuperMemo SM-2 Spaced Repetition Algorithm:
 * - Again (1): Reset interval to 10 minutes, increment lapses, decrease ease factor.
 * - Hard (2): Shorter interval (~1.2x or 1 day), slight decrease in ease factor.
 * - Good / Know (3): Standard graduated interval (1 day -> 6 days -> interval * easeFactor).
 * - Easy (4): Bonus interval boost (~1.3x on top of easeFactor), increases ease factor.
 */
export function schedule(
  card: Pick<Flashcard, "interval_days" | "reps" | "lapses"> & { ease_factor?: number | null },
  rating: Rating,
  now = new Date(),
) {
  const currentEase = typeof card.ease_factor === "number" && card.ease_factor >= 1.3 ? card.ease_factor : 2.5;
  let interval = card.interval_days || 0;
  let reps = card.reps || 0;
  let lapses = card.lapses || 0;
  let newEase = currentEase;
  let status: string;
  let due: Date;

  if (rating === "again") {
    interval = 0;
    reps = 0;
    lapses += 1;
    newEase = Math.max(1.3, currentEase - 0.2);
    status = "learning";
    due = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
  } else if (rating === "hard") {
    newEase = Math.max(1.3, currentEase - 0.15);
    if (reps === 0) {
      interval = 1;
    } else {
      interval = Math.max(1, Math.round(interval * 1.2 * 10) / 10);
    }
    reps += 1;
    status = "learning";
    due = new Date(now.getTime() + interval * DAY);
  } else if (rating === "easy") {
    newEase = Math.min(3.2, currentEase + 0.15);
    if (reps === 0) {
      interval = 4;
    } else if (reps === 1) {
      interval = 7;
    } else {
      interval = Math.round(interval * newEase * 1.3 * 10) / 10;
    }
    reps += 1;
    status = "known";
    due = new Date(now.getTime() + interval * DAY);
  } else {
    // "good" or legacy "know"
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * newEase * 10) / 10;
    }
    reps += 1;
    status = reps >= 2 ? "known" : "learning";
    due = new Date(now.getTime() + interval * DAY);
  }

  return {
    interval_days: Math.max(0, Math.round(interval * 10) / 10),
    status,
    due_at: due.toISOString(),
    reps,
    lapses,
    last_reviewed_at: now.toISOString(),
    ease_factor: Math.round(newEase * 100) / 100,
  };
}

export function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export const isDue = (c: Pick<Flashcard, "due_at">, by = endOfToday()) => new Date(c.due_at) <= by;

export function cardStats(cards: Flashcard[]) {
  const total = cards.length;
  const reviewed = cards.filter((c) => c.reps > 0 || c.status !== "new").length;
  const mastered = cards.filter((c) => c.status === "known").length;
  const learning = cards.filter((c) => c.status === "learning" || c.status === "review").length;
  const due = cards.filter((c) => isDue(c)).length;
  return {
    total,
    reviewed,
    mastered,
    learning,
    due,
    masteryPct: total ? Math.round((mastered / total) * 100) : 0,
  };
}

const pct = (a: Attempt) => (a.total ? Math.round((a.score / a.total) * 100) : 0);

export type TopicStatus = "Needs review" | "Improving" | "Strong";
export type TopicRow = { topic: string; accuracy: number; samples: number; status: TopicStatus };

export type Mistake = Tables<"mistakes">;

export function topicStats(
  cards: Flashcard[],
  attempts: Attempt[],
  mistakes: Pick<Mistake, "topic" | "wrong_count" | "status">[] = [],
): TopicRow[] {
  const map = new Map<string, { c: number; t: number; recentC: number; recentT: number }>();
  const add = (topic: string, correct: boolean, w = 1, recent = false) => {
    const key = topic.trim();
    if (!key) return;
    const m = map.get(key) ?? { c: 0, t: 0, recentC: 0, recentT: 0 };
    m.t += w;
    if (correct) m.c += w;
    if (recent) {
      m.recentT += w;
      if (correct) m.recentC += w;
    }
    map.set(key, m);
  };
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const recentCut = Date.now() - 3 * 86400000;
  const tests = sorted.filter((a) => a.kind !== "recall");
  const lastTwo = new Set(tests.slice(-2).map((a) => a.id));
  sorted.forEach((a) => {
    const recent = a.kind === "recall" ? Date.parse(a.created_at) >= recentCut : lastTwo.has(a.id);
    for (const r of (a.results as AttemptResult[] | null) ?? [])
      add(r.topic, !!r.correct, 1, recent);
  });
  for (const c of cards) {
    if (!c.topic || c.reps === 0) continue;
    add(c.topic, c.status === "known", 0.5);
    for (let k = 0; k < Math.min(c.lapses, 3); k++) add(c.topic, false, 0.5);
  }
  // Mistake Bank: repeated misses on the same concept weigh the topic down extra (first miss is already in attempts).
  for (const m of mistakes) {
    if (m.status === "mastered") continue;
    const extra = Math.min(3, Math.max(0, m.wrong_count - 1));
    if (extra) add(m.topic, false, extra * 0.5);
  }
  return [...map.entries()]
    .map(([topic, m]) => {
      const accuracy = Math.round((m.c / m.t) * 100);
      const recentAcc = m.recentT ? m.recentC / m.recentT : null;
      let status: TopicStatus =
        accuracy >= 80 ? "Strong" : accuracy >= 60 ? "Improving" : "Needs review";
      if (status === "Needs review" && recentAcc != null && recentAcc * 100 >= accuracy + 15)
        status = "Improving";
      return { topic, accuracy, samples: m.t, status };
    })
    .filter((r) => r.samples >= 1)
    .sort((a, b) => a.accuracy - b.accuracy);
}

export function setStats(
  cards: Flashcard[],
  attempts: Attempt[],
  mistakes: Pick<Mistake, "topic" | "wrong_count" | "status">[] = [],
) {
  const cs = cardStats(cards);
  const quizzes = attempts
    .filter((a) => QUIZ_KINDS.includes(a.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const exams = attempts
    .filter((a) => EXAM_KINDS.includes(a.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const quizAvg = quizzes.length
    ? Math.round(quizzes.reduce((s, a) => s + pct(a), 0) / quizzes.length)
    : null;
  const quizBest = quizzes.length ? Math.max(...quizzes.map(pct)) : null;
  const recentQuiz = quizzes.length
    ? Math.round(quizzes.slice(0, 3).reduce((s, a) => s + pct(a), 0) / Math.min(3, quizzes.length))
    : null;
  const examLatest = exams[0] ? pct(exams[0]) : null;
  const examBest = exams.length ? Math.max(...exams.map(pct)) : null;
  const topics = topicStats(cards, attempts, mistakes);
  const repeated = mistakes.filter((m) => m.status === "review" && m.wrong_count >= 2).length;
  const openMistakes = mistakes.filter((m) => m.status !== "mastered").length;
  const weak = topics.filter((t) => t.status === "Needs review");

  const parts: [number, number][] = [];
  if (recentQuiz != null) parts.push([recentQuiz, 0.35]);
  if (examLatest != null) parts.push([examLatest, 0.35]);
  if (cs.reviewed > 0) parts.push([cs.masteryPct, 0.3]);
  const recall = attempts
    .filter((a) => a.kind === "recall")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
  const recallPct = recall.length
    ? Math.round(
        (recall.reduce((s, a) => s + a.score, 0) / recall.reduce((s, a) => s + a.total, 0)) * 100,
      )
    : null;
  if (recallPct != null) parts.push([recallPct, 0.2]);
  let readiness: number | null = null;
  if (parts.length) {
    const w = parts.reduce((s, [, x]) => s + x, 0);
    readiness = Math.round(parts.reduce((s, [v, x]) => s + v * x, 0) / w);
    readiness = Math.max(
      0,
      Math.min(100, readiness - Math.min(15, weak.length * 3) - Math.min(8, repeated * 2)),
    );
  }
  const names = weak.slice(0, 2).map((t) => t.topic);
  let readinessNote = "Take a quiz or review some flashcards to get your first estimate.";
  if (readiness != null) {
    const review = names.length ? ` You should review ${names.join(" and ")}.` : "";
    if (readiness >= 80)
      readinessNote = `You're doing well overall.${review || " Keep reviewing due cards to stay sharp."}`;
    else if (readiness >= 60)
      readinessNote = `You're making good progress.${review || " A practice exam would help confirm you're ready."}`;
    else
      readinessNote = `There's still work to do.${review || " Focus on flashcards and quizzes to build up your knowledge."}`;
    if (repeated > 0)
      readinessNote += ` ${repeated} question${repeated === 1 ? " keeps" : "s keep"} tripping you up — check your Mistake Bank.`;
    if (examLatest == null) readinessNote += " Try a practice exam for a better estimate.";
  }

  const overall = readiness ?? cs.masteryPct;
  return {
    ...cs,
    recallPct,
    recallCount: attempts.filter((a) => a.kind === "recall").length,
    quizCount: quizzes.length,
    quizAvg,
    quizBest,
    exams,
    examLatest,
    examBest,
    topics,
    weak,
    readiness,
    readinessNote,
    overall,
    openMistakes,
    repeatedMistakes: repeated,
  };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Adaptive allocation: weak topics get more questions, strong ones fewer but never zero. */
export function adaptivePlan(
  topics: TopicRow[],
  count: number,
): { topic: string; count: number }[] {
  if (!topics.length) return [];
  const w = topics.map((t) => ({
    topic: t.topic,
    w: t.status === "Strong" ? 0.6 : 0.6 + ((100 - t.accuracy) / 100) * 3,
  }));
  const total = w.reduce((s, x) => s + x.w, 0);
  const out = w.map((x) => ({
    topic: x.topic,
    count: Math.floor((x.w / total) * count),
    r: ((x.w / total) * count) % 1,
  }));
  let left = count - out.reduce((s, x) => s + x.count, 0);
  [...out]
    .sort((a, b) => b.r - a.r)
    .forEach((x) => {
      if (left > 0) {
        x.count++;
        left--;
      }
    });
  return out.filter((x) => x.count > 0).map(({ topic, count }) => ({ topic, count }));
}
