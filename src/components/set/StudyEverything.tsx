import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Headphones, Loader2, SkipForward, Sparkles, Square } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { planSession, type SessionStep } from "@/lib/study.functions";
import { dayKey } from "@/lib/activity";
import { logActivity } from "@/lib/log-activity";
import type { StudySet } from "@/lib/queries";
import type { Flashcard, setStats } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, Chips, ErrorBox } from "./ui";
import { Flashcards } from "./Flashcards";
import { ActiveRecall } from "./ActiveRecall";
import { QuizRunner } from "./QuizRunner";
import type { Attempt, Mistake } from "@/lib/stats";
import { MistakeBank } from "./MistakeBank";

type Stats = ReturnType<typeof setStats>;
type Plan = { headline: string; reason: string; steps: SessionStep[] };
type Summary = {
  flashcards: number;
  questions: number;
  correct: number;
  steps: string[];
  topics: string[];
  before: number | null;
};

const KIND_LABEL: Record<SessionStep["kind"], string> = {
  flashcards: "Flashcards",
  recall: "Active Recall",
  adaptive: "Adaptive Quiz",
  exam: "Practice questions",
  guide: "Study guide review",
  mistakes: "Mistake Bank",
  audio: "Audio Study",
};

function weakSection(guide: string | null, topics: string[]) {
  if (!guide) return null;
  const sections = guide.split(/\n(?=## )/);
  const weak = sections.find((s) => /^## Weak Areas/i.test(s));
  const extra = sections
    .filter((s) => topics.some((t) => s.toLowerCase().includes(t.toLowerCase())) && s !== weak)
    .slice(0, 1);
  return [weak, ...extra].filter(Boolean).join("\n\n");
}

export function StudyEverything({
  set,
  stats,
  cards,
  attempts,
  onOpenGuide,
  mistakes = [],
}: {
  mistakes?: Mistake[];
  set: StudySet;
  stats: Stats;
  cards: Flashcard[];
  attempts: Attempt[];
  onOpenGuide: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const plan = useServerFn(planSession);
  const [minutes, setMinutes] = useState(
    set.minutes_per_day && [15, 30, 60].includes(set.minutes_per_day) ? set.minutes_per_day : 30,
  );
  const [p, setP] = useState<Plan | null>(null);
  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const startedAt = useRef<string>("");
  const done = useRef<string[]>([]);
  const before = useRef<number | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const r = await plan({
        data: {
          setId: set.id,
          minutes,
          today: dayKey(new Date().toISOString()),
          tzOffset: new Date().getTimezoneOffset(),
        },
      });
      setP(r);
      setStep(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't plan a session");
    }
    setBusy(false);
  };

  const begin = () => {
    startedAt.current = new Date().toISOString();
    done.current = [];
    before.current = stats.readiness;
    setStep(0);
  };

  const next = (completed: boolean) => {
    if (!p) return;
    if (completed) done.current.push(p.steps[step]!.title);
    if (step + 1 >= p.steps.length) void finish();
    else setStep(step + 1);
  };

  const finish = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const { data } = await supabase
        .from("study_activity")
        .select("kind, count, score, total")
        .eq("set_id", set.id)
        .gte("created_at", startedAt.current);
      const rows = data ?? [];
      const flashcards = rows
        .filter((r) => r.kind === "flashcard")
        .reduce((s, r) => s + r.count, 0);
      const qRows = rows.filter((r) => ["recall", "quiz", "adaptive", "exam"].includes(r.kind));
      const questions = qRows.reduce((s, r) => s + (r.total ?? r.count), 0);
      const correct = qRows.reduce((s, r) => s + (r.score ?? 0), 0);
      const topics = [...new Set(p.steps.flatMap((s) => s.topics))];
      const sum: Summary = {
        flashcards,
        questions,
        correct,
        steps: done.current,
        topics,
        before: before.current,
      };
      if (flashcards + questions > 0 || done.current.length) {
        await logActivity("session", set.id, 1, qc, {
          score: correct,
          total: questions,
          duration_seconds: Math.round((Date.now() - Date.parse(startedAt.current)) / 1000),
          meta: { steps: done.current, flashcards, topics, mode: "study-everything" },
        });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["attempts", set.id] }),
        qc.invalidateQueries({ queryKey: ["cards", set.id] }),
      ]);
      setSummary(sum);
      setStep(-1);
      setP(null);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't wrap up the session — your progress is saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    const weakNow = stats.weak.map((t) => t.topic);
    const nextRec = weakNow.length
      ? `Next time, focus on ${weakNow.slice(0, 2).join(" and ")} with Active Recall.`
      : stats.examLatest == null
        ? "Next time, try a practice exam to check your readiness."
        : "Next time, review due flashcards and take a harder adaptive quiz.";
    return (
      <div className="max-w-2xl mx-auto rounded-2xl dpanel p-6 md:p-8 space-y-5">
        <div>
          <p className="eyebrow text-cool2">Session complete · saved to history</p>
          <h2 className="font-display text-3xl uppercase mt-1">Nice work</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-foreground/5 p-3">
            <p className="font-display text-2xl text-mint">{summary.flashcards}</p>
            <p className="text-[11px] uppercase tracking-wider text-soft">cards reviewed</p>
          </div>
          <div className="rounded-xl bg-foreground/5 p-3">
            <p className="font-display text-2xl text-cool2">{summary.questions}</p>
            <p className="text-[11px] uppercase tracking-wider text-soft">questions</p>
          </div>
          <div className="rounded-xl bg-foreground/5 p-3">
            <p className="font-display text-2xl">
              {summary.before ?? "—"}
              {summary.before != null ? "%" : ""} → {stats.readiness ?? "—"}
              {stats.readiness != null ? "%" : ""}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-soft">readiness (estimate)</p>
          </div>
        </div>
        <div className="text-sm space-y-2">
          <p>
            <span className="text-soft">What you studied: </span>
            {summary.steps.join(", ") || "—"}
          </p>
          <p>
            <span className="text-soft">Weak topics worked on: </span>
            {summary.topics.join(", ") || "—"}
          </p>
          <p>
            <span className="text-soft">Recommended next session: </span>
            {nextRec}
          </p>
        </div>
        <button onClick={() => setSummary(null)} className={btnPrimary}>
          Done
        </button>
      </div>
    );
  }

  if (busy)
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">
          {p ? "Wrapping up" : "Analyzing your progress"}
        </h2>
      </div>
    );

  if (!p)
    return (
      <div className="max-w-2xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 md:p-8 space-y-5">
        <div>
          <p className="eyebrow text-mint">Study Everything</p>
          <h2 className="font-display text-3xl uppercase mt-1">Let Momentum decide</h2>
          <p className="text-sm text-soft mt-1">
            Uses your weak topics, due cards, results, exam date and history to build the most
            useful session.
          </p>
        </div>
        <Chips
          label="Time available"
          value={minutes}
          onChange={setMinutes}
          options={[15, 30, 60].map((v) => ({ v, l: `${v} min` }))}
        />
        {error && <ErrorBox msg={error} />}
        <div className="flex gap-2">
          <button onClick={build} className={btnPrimary}>
            <Sparkles className="size-4" /> Build my session
          </button>
          <button
            onClick={() =>
              navigate({ to: "/sets/$id", params: { id: set.id }, search: { tab: "audio" } })
            }
            className={btnGhost}
          >
            <Headphones className="size-4" /> Audio Study
          </button>
        </div>
      </div>
    );

  if (step < 0)
    return (
      <div className="max-w-2xl mx-auto rounded-2xl dpanel p-6 md:p-8 space-y-5">
        <div>
          <p className="eyebrow text-cool2">Here's what Momentum thinks you should work on</p>
          <h2 className="font-display text-2xl uppercase mt-1">{p.headline}</h2>
          {p.reason && <p className="text-sm mt-2">{p.reason}</p>}
        </div>
        <ol className="space-y-2">
          {p.steps.map((s, i) => (
            <li
              key={i}
              className="rounded-xl bg-foreground/5 p-3 text-sm flex justify-between gap-3"
            >
              <span>
                <span className="font-semibold">
                  {i + 1}. {s.title}
                </span>{" "}
                <span className="text-soft">
                  · {KIND_LABEL[s.kind]}
                  {s.topics.length ? ` · ${s.topics.join(", ")}` : ""}
                </span>
                <br />
                <span className="text-soft text-xs">{s.why}</span>
              </span>
              <span className="text-soft shrink-0">~{s.minutes} min</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button onClick={begin} className={btnPrimary}>
            Start session
          </button>
          <button onClick={() => setP(null)} className={btnGhost}>
            Change time
          </button>
        </div>
      </div>
    );

  const s = p.steps[step]!;
  const guideText = s.kind === "guide" ? weakSection(set.study_guide, s.topics) : null;
  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3 rounded-xl bg-panel border border-line/70 px-4 py-3">
        <div className="text-sm">
          <span className="eyebrow text-cool2">
            Step {step + 1}/{p.steps.length}
          </span>{" "}
          <span className="font-semibold ml-2">{s.title}</span>
          <span className="text-soft"> · {s.why}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => next(false)} className={cn(btnGhost, "py-1.5")}>
            <SkipForward className="size-4" /> Skip
          </button>
          {(s.kind === "flashcards" || s.kind === "guide") && (
            <button onClick={() => next(true)} className={cn(btnPrimary, "py-1.5")}>
              Next activity
            </button>
          )}
          <button
            onClick={() => {
              done.current.push(s.title);
              void finish();
            }}
            className={cn(btnGhost, "py-1.5")}
          >
            <Square className="size-4" /> End session
          </button>
        </div>
      </div>
      <div key={step}>
        {s.kind === "mistakes" && (
          <MistakeBank
            setId={set.id}
            mistakes={mistakes}
            limit={Math.max(1, s.count || 5)}
            onDone={() => next(true)}
          />
        )}
        {s.kind === "audio" && (
          <div className="max-w-xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 text-center space-y-3">
            <Headphones className="size-8 text-cool2 mx-auto" />
            <h3 className="font-display text-2xl uppercase">Audio Study</h3>
            <p className="text-sm text-soft">
              Listen to a guided lesson, pause for questions, and quiz yourself without leaving the
              study set.
            </p>
            <button
              onClick={() =>
                navigate({ to: "/sets/$id", params: { id: set.id }, search: { tab: "audio" } })
              }
              className={btnPrimary}
            >
              Open Audio Study
            </button>
          </div>
        )}
        {s.kind === "flashcards" && <Flashcards setId={set.id} cards={cards} />}
        {s.kind === "recall" && (
          <ActiveRecall
            setId={set.id}
            topics={stats.topics}
            preset={{ count: Math.max(3, s.count || 5), focus: s.topics, difficulty: s.difficulty }}
            onDone={() => next(true)}
          />
        )}
        {s.kind === "adaptive" && (
          <QuizRunner
            set={set}
            kind="quiz"
            attempts={attempts}
            topics={stats.topics}
            autoStart
            preset={{
              adaptive: true,
              count: Math.max(3, Math.min(30, s.count || 10)),
              difficulty: s.difficulty,
            }}
          />
        )}
        {s.kind === "exam" && (
          <QuizRunner
            set={set}
            kind="exam"
            attempts={attempts}
            autoStart
            preset={{
              count: Math.max(5, Math.min(30, s.count || 10)),
              difficulty: s.difficulty,
              minutes: 0,
            }}
          />
        )}
        {s.kind === "guide" &&
          (guideText ? (
            <article className="max-w-3xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 prose prose-invert max-w-none prose-headings:font-display prose-headings:uppercase prose-h2:text-cool2">
              <ReactMarkdown>{guideText}</ReactMarkdown>
            </article>
          ) : (
            <div className="max-w-xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 text-center text-sm space-y-3">
              <p>
                You don't have a study guide yet. Generate one to get a personalized Weak Areas
                section.
              </p>
              <button onClick={onOpenGuide} className={btnGhost}>
                Open Study Guide
              </button>
            </div>
          ))}
        {(s.kind === "adaptive" || s.kind === "exam") && (
          <div className="max-w-3xl mx-auto mt-4 flex justify-end">
            <button onClick={() => next(true)} className={btnPrimary}>
              Next activity
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
