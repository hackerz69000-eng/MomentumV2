import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Target, Layers, AlertTriangle, TrendingUp, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setStats, type Flashcard, type Attempt, type Mistake } from "@/lib/stats";
import type { SetWithCards } from "@/lib/queries";

type Rec = {
  set: SetWithCards;
  stats: ReturnType<typeof setStats>;
  daysToExam: number | null;
  score: number;
  reason: string;
  action: { tab: string; label: string };
  minutes: number;
};

async function fetchAll() {
  const [c, a, m] = await Promise.all([
    supabase.from("flashcards").select("id,set_id,status,due_at,topic,reps,lapses,interval_days"),
    supabase
      .from("quiz_attempts")
      .select("id,set_id,kind,score,total,results,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("mistakes")
      .select("id,set_id,topic,wrong_count,status,question,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  if (c.error) throw c.error;
  if (a.error) throw a.error;
  if (m.error) throw m.error;
  return {
    cards: (c.data ?? []) as unknown as Flashcard[],
    attempts: (a.data ?? []) as unknown as Attempt[],
    mistakes: (m.data ?? []) as unknown as Mistake[],
  };
}

function recommend(set: SetWithCards, stats: ReturnType<typeof setStats>): Rec {
  const daysToExam = set.exam_date
    ? Math.ceil((Date.parse(set.exam_date) - Date.now()) / 86400000)
    : null;
  const examSoon = daysToExam != null && daysToExam >= 0 ? Math.max(0, 30 - daysToExam) / 30 : 0;
  const readinessGap = stats.readiness == null ? 0.5 : (100 - stats.readiness) / 100;
  // Balanced: exam priority, spaced review, weak areas, and maintenance (not just "weakest").
  const score =
    examSoon * 3 +
    Math.min(stats.due, 30) / 10 +
    readinessGap * 1.5 +
    Math.min(stats.weak.length, 4) * 0.25 +
    stats.repeatedMistakes * 0.2;
  let reason = "Keep your knowledge fresh";
  let action = { tab: "flashcards", label: "Review flashcards" };
  const weak = stats.weak[0]?.topic;
  if (stats.quizCount === 0 && stats.examLatest == null) {
    reason = "No quiz yet — find out what you know";
    action = { tab: "quiz", label: "Take a quiz" };
  } else if (stats.due >= 5) {
    reason = `${stats.due} flashcards due for spaced review`;
    action = { tab: "flashcards", label: "Review due cards" };
  } else if (stats.repeatedMistakes > 0) {
    reason = `${stats.repeatedMistakes} repeated mistake${stats.repeatedMistakes === 1 ? "" : "s"} to fix`;
    action = { tab: "mistakes", label: "Open Mistake Bank" };
  } else if (weak) {
    reason = `Weak topic: ${weak}`;
    action = { tab: "quiz", label: "Practice weak topics" };
  } else if (daysToExam != null && daysToExam <= 7 && daysToExam >= 0) {
    reason = "Exam this week — confirm you're ready";
    action = { tab: "exam", label: "Take practice exam" };
  }
  const minutes = Math.max(
    10,
    Math.min(45, Math.round(stats.due * 0.6 + stats.weak.length * 4 + 8)),
  );
  return { set, stats, daysToExam, score, reason, action, minutes };
}

export function CommandCenter({ sets }: { sets: SetWithCards[] }) {
  const ready = sets.filter((s) => s.status === "ready");
  const { data } = useQuery({ queryKey: ["command-center"], queryFn: fetchAll, staleTime: 30_000 });
  if (!data || !ready.length) return null;

  const recs = ready
    .map((s) =>
      recommend(
        s,
        setStats(
          data.cards.filter((c) => c.set_id === s.id),
          data.attempts.filter((a) => a.set_id === s.id),
          data.mistakes.filter((m) => m.set_id === s.id),
        ),
      ),
    )
    .sort((a, b) => b.score - a.score);
  const top = recs[0]!;
  const totalDue = recs.reduce((n, r) => n + r.stats.due, 0);
  const upcoming = recs
    .filter((r) => r.daysToExam != null && r.daysToExam >= 0)
    .sort((a, b) => a.daysToExam! - b.daysToExam!)[0];
  const weakTopics = recs
    .flatMap((r) => r.stats.weak.slice(0, 2).map((w) => ({ ...w, set: r.set })))
    .slice(0, 4);
  const recentMistakes = data.mistakes.filter((m) => m.status !== "mastered").slice(0, 3);
  const lastAttempt = data.attempts[0];
  const lastSet = lastAttempt ? ready.find((s) => s.id === lastAttempt.set_id) : undefined;

  return (
    <section className="px-5 md:px-8 pt-8" aria-labelledby="cc-title">
      <h2 id="cc-title" className="sr-only">
        Study command center
      </h2>
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5">
        <div className="rounded-2xl p-6 bg-panel border border-cool/40">
          <p className="eyebrow text-cool2 flex items-center gap-2">
            <Compass className="size-4" aria-hidden /> Recommended now
          </p>
          <h3 className="font-display text-3xl md:text-4xl uppercase mt-3 leading-tight">
            {top.set.name}
          </h3>
          <p className="text-soft mt-2 text-sm">{top.reason}</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-foreground/5 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-soft">Due cards</dt>
              <dd className="font-display text-lg text-cool2">{top.stats.due}</dd>
            </div>
            <div className="rounded-lg bg-foreground/5 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-soft">Readiness</dt>
              <dd className="font-display text-lg text-mint">
                {top.stats.readiness != null ? `${top.stats.readiness}%` : "—"}
              </dd>
            </div>
            <div className="rounded-lg bg-foreground/5 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-soft">Est. time</dt>
              <dd className="font-display text-lg">{top.minutes} min</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3 mt-5">
            <Link
              to="/sets/$id"
              params={{ id: top.set.id }}
              search={{ tab: top.action.tab } as never}
              className="font-semibold text-sm bg-brand text-ink px-5 py-2.5 rounded-lg"
            >
              {top.action.label}
            </Link>
            <Link
              to="/sets/$id"
              params={{ id: top.set.id }}
              search={{ tab: "everything" } as never}
              className="font-semibold text-sm border border-foreground/25 px-5 py-2.5 rounded-lg"
            >
              Study Everything
            </Link>
            <Link
              to="/coach"
              className="font-semibold text-sm border border-foreground/25 px-5 py-2.5 rounded-lg"
            >
              Ask the Coach
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Tile
            icon={CalendarClock}
            label="Next exam"
            value={
              upcoming
                ? upcoming.daysToExam === 0
                  ? "Today"
                  : `${upcoming.daysToExam}d`
                : "Not set"
            }
            sub={upcoming?.set.name ?? "Add a date in a set's Plan"}
          />
          <Tile icon={Layers} label="Cards due" value={String(totalDue)} sub="across all sets" />
          <Tile
            icon={TrendingUp}
            label="Last result"
            value={
              lastAttempt && lastAttempt.total
                ? `${Math.round((lastAttempt.score / lastAttempt.total) * 100)}%`
                : "—"
            }
            sub={lastSet ? `${lastAttempt!.kind} · ${lastSet.name}` : "No attempts yet"}
          />
          <Tile
            icon={Target}
            label="Open mistakes"
            value={String(data.mistakes.filter((m) => m.status !== "mastered").length)}
            sub={recentMistakes[0]?.topic || "Nice — none open"}
          />
        </div>
      </div>
      {(weakTopics.length > 0 || lastSet) && (
        <div className="grid md:grid-cols-2 gap-5 mt-5">
          {weakTopics.length > 0 && (
            <div className="rounded-2xl p-5 bg-panel border border-line/70">
              <p className="eyebrow text-soft flex items-center gap-2">
                <AlertTriangle className="size-4" aria-hidden /> Weak topics
              </p>
              <ul className="mt-3 space-y-2">
                {weakTopics.map((w) => (
                  <li key={w.set.id + w.topic}>
                    <Link
                      to="/sets/$id"
                      params={{ id: w.set.id }}
                      search={{ tab: "quiz" } as never}
                      className="flex justify-between gap-3 text-sm hover:text-cool2"
                    >
                      <span className="truncate">
                        {w.topic} <span className="text-soft">· {w.set.name}</span>
                      </span>
                      <span className="text-soft shrink-0">{w.accuracy}% accuracy</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastSet && (
            <div className="rounded-2xl p-5 bg-panel border border-line/70">
              <p className="eyebrow text-soft">Continue where you left off</p>
              <p className="font-display text-xl uppercase mt-2">{lastSet.name}</p>
              <p className="text-soft text-sm mt-1">
                Last activity: {lastAttempt!.kind} on{" "}
                {new Date(lastAttempt!.created_at).toLocaleDateString()}
              </p>
              <Link
                to="/sets/$id"
                params={{ id: lastSet.id }}
                className="inline-block mt-3 text-sm font-semibold text-cool2 hover:underline"
              >
                Open set →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Target;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl p-4 bg-panel border border-line/70 min-w-0">
      <p className="eyebrow text-soft flex items-center gap-1.5 text-[10px]">
        <Icon className="size-3.5" aria-hidden /> {label}
      </p>
      <p className="font-display text-2xl mt-2">{value}</p>
      <p className="text-xs text-soft truncate mt-1">{sub}</p>
    </div>
  );
}
