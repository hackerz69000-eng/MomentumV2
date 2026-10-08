import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Lightbulb, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  generateRecall,
  gradeRecall,
  recallHint,
  type RecallGrade,
  type RecallQuestion,
} from "@/lib/study.functions";
import { logActivity } from "@/lib/log-activity";
import { recordResults } from "@/lib/mistakes";
import { recordStudySessionCompletion } from "@/components/DailyStreak";
import { ExplainWhy } from "./ExplainWhy";
import type { TopicRow } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, Chips, ErrorBox, inputCls } from "./ui";

const GRADE: Record<RecallGrade, { l: string; tone: string; score: number }> = {
  correct: { l: "Correct", tone: "text-mint border-mint/40 bg-mint/10", score: 4 },
  mostly: { l: "Mostly correct", tone: "text-mint border-mint/30 bg-mint/5", score: 3 },
  partial: {
    l: "Partially correct · partial credit",
    tone: "text-cool2 border-cool/40 bg-cool/10",
    score: 2,
  },
  incorrect: {
    l: "Incorrect",
    tone: "text-destructive border-destructive/40 bg-destructive/10",
    score: 0,
  },
};

export function ActiveRecall({
  setId,
  topics,
  preset,
  onDone,
  lectureId,
}: {
  lectureId?: string;
  setId: string;
  topics: TopicRow[];
  preset?: { count: number; focus: string[]; difficulty?: "easy" | "medium" | "hard" | "mixed" };
  onDone?: (r: { done: number; good: number }) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const gen = useServerFn(generateRecall);
  const gradeFn = useServerFn(gradeRecall);
  const hintFn = useServerFn(recallHint);
  const [count, setCount] = useState(preset?.count ?? 10);
  const [qs, setQs] = useState<RecallQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<{
    grade: RecallGrade;
    feedback: string;
    model: string;
  } | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [busy, setBusy] = useState<null | "gen" | "grade" | "hint">(null);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState({ done: 0, good: 0 });

  const weak = preset?.focus.length
    ? preset.focus
    : topics
        .filter((t) => t.status !== "Strong")
        .map((t) => t.topic)
        .slice(0, 6);
  const auto = useRef(false);
  useEffect(() => {
    if (preset && !auto.current) {
      auto.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const q = qs?.[i];
  const recordedRef = useRef(false);

  useEffect(() => {
    if (qs && !q && tally.done > 0 && !recordedRef.current) {
      recordedRef.current = true;
      recordStudySessionCompletion(Math.max(10, Math.round(tally.done * 1.5)), "Active Recall Practice");
    }
    if (qs && q) {
      recordedRef.current = false;
    }
  }, [qs, q, tally]);

  const start = async () => {
    setBusy("gen");
    setError(null);
    try {
      const r = await gen({
        data: {
          setId,
          count: Math.max(1, count),
          focus: weak,
          lectureId,
          ...(preset?.difficulty ? { difficulty: preset.difficulty } : {}),
        },
      });
      setQs(r.questions);
      setI(0);
      reset();
      setTally({ done: 0, good: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
    setBusy(null);
  };
  const reset = () => {
    setAnswer("");
    setHint(null);
    setResult(null);
    setShowModel(false);
  };

  const save = async (g: RecallGrade, r: { feedback: string; model: string }, given: string) => {
    if (!user || !q) return;
    const score = GRADE[g].score;
    setTally((t) => ({ done: t.done + 1, good: t.good + (score >= 3 ? 1 : 0) }));
    await supabase.from("quiz_attempts").insert({
      set_id: setId,
      user_id: user.id,
      kind: "recall",
      difficulty: "mixed",
      score,
      total: 4,
      results: [{ topic: q.topic, correct: score >= 3, grade: g, q: q.question.slice(0, 200) }],
    });
    void recordResults(
      user.id,
      [
        {
          setId,
          question: q.question,
          correct: score >= 3,
          studentAnswer: given,
          correctAnswer: r.model,
          explanation: r.feedback,
          topic: q.topic,
          kind: "recall",
          data: { type: "recall", question: q.question, topic: q.topic },
        },
      ],
      qc,
    );
    void logActivity("recall", setId, 1, qc, {
      score: score >= 3 ? 1 : 0,
      total: 1,
      meta: { grade: g, topic: q.topic },
    });
    qc.invalidateQueries({ queryKey: ["attempts", setId] });
  };

  const submit = async (reveal = false) => {
    if (!q) return;
    setBusy("grade");
    try {
      const r = await gradeFn({
        data: { setId, lectureId, question: q.question, answer: reveal ? "" : answer },
      });
      const firstTry = !result;
      setResult(r);
      if (reveal) setShowModel(true);
      if (firstTry) await save(r.grade, r, reveal ? "" : answer);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grading failed");
    }
    setBusy(null);
  };

  const getHint = async () => {
    if (!q) return;
    setBusy("hint");
    try {
      setHint((await hintFn({ data: { setId, lectureId, question: q.question } })).hint);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hint available");
    }
    setBusy(null);
  };

  if (!qs)
    return (
      <div className="max-w-2xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 md:p-8 space-y-5">
        <div>
          <p className="eyebrow text-mint">Active Recall</p>
          <h2 className="font-display text-3xl uppercase mt-1">Answer from memory</h2>
          <p className="text-sm text-soft mt-1">
            Type your own answer, then the AI checks it against your material.
            {weak.length ? ` Focuses on: ${weak.slice(0, 3).join(", ")}.` : ""}
          </p>
        </div>
        <Chips
          label="Questions"
          value={count}
          onChange={setCount}
          options={[5, 10, 15, 20].map((v) => ({ v, l: String(v) }))}
        />
        {error && <ErrorBox msg={error} />}
        <button onClick={start} disabled={!!busy} className={btnPrimary}>
          {busy === "gen" && <Loader2 className="size-4 animate-spin" />} Start Active Recall
        </button>
      </div>
    );

  if (!q)
    return (
      <div className="max-w-2xl mx-auto rounded-2xl dpanel p-8 text-center">
        <p className="eyebrow text-cool2">Session complete</p>
        <p className="font-display text-5xl text-mint mt-2">
          {tally.good}/{tally.done}
        </p>
        <p className="text-sm text-soft mt-1">correct or mostly correct · saved to your progress</p>
        {onDone ? (
          <button onClick={() => onDone(tally)} className={btnPrimary + " mt-6"}>
            Continue
          </button>
        ) : (
          <button onClick={() => setQs(null)} className={btnPrimary + " mt-6"}>
            New session
          </button>
        )}
      </div>
    );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex justify-between text-sm text-soft">
        <span>
          Question {i + 1} / {qs.length} · {q.topic}
        </span>
        <span>
          {tally.good}/{tally.done} correct
        </span>
      </div>
      <div className="rounded-2xl bg-panel border border-line/70 p-6 space-y-4">
        <p className="font-semibold text-lg">{q.question}</p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={5}
          placeholder="Type your answer from memory…"
          className={cn(inputCls, "w-full")}
          disabled={busy === "grade"}
        />
        {hint && (
          <p className="text-sm rounded-lg bg-cool/10 border border-cool/30 p-3">
            <Lightbulb className="size-4 inline mr-1 text-cool2" />
            {hint}
          </p>
        )}
        {result && (
          <div className={cn("rounded-lg border p-4 text-sm space-y-2", GRADE[result.grade].tone)}>
            <p className="font-semibold">{GRADE[result.grade].l}</p>
            <p className="text-foreground">{result.feedback}</p>
            {showModel && (
              <p className="text-foreground">
                <span className="text-soft">Answer: </span>
                {result.model}
              </p>
            )}
            <ExplainWhy
              key={q.question}
              setId={setId}
              lectureId={lectureId}
              question={q.question}
              correct={result.model}
              given={answer}
              topic={q.topic}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!result || busy === "grade" ? (
            <>
              <button
                onClick={() => submit()}
                disabled={!answer.trim() || !!busy}
                className={btnPrimary}
              >
                {busy === "grade" && <Loader2 className="size-4 animate-spin" />} Submit
              </button>
              <button onClick={getHint} disabled={!!busy || !!hint} className={btnGhost}>
                {busy === "hint" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Lightbulb className="size-4" />
                )}{" "}
                Hint
              </button>
              <button onClick={() => submit(true)} disabled={!!busy} className={btnGhost}>
                Reveal Answer
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setI((x) => x + 1);
                  reset();
                }}
                className={btnPrimary}
              >
                Next Question
              </button>
              <button
                onClick={() => {
                  setResult(null);
                  setShowModel(false);
                }}
                className={btnGhost}
              >
                Try Again
              </button>
              {!showModel && (
                <button onClick={() => setShowModel(true)} className={btnGhost}>
                  Reveal Answer
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
