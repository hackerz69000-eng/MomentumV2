import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Check, Lightbulb, Loader2, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  explainMistake,
  mistakePatterns,
  gradeShortAnswers,
  similarQuestions,
  type QuizQuestion,
} from "@/lib/study.functions";
import { nextStatus, recordResults, MASTERED_AFTER } from "@/lib/mistakes";
import { logActivity } from "@/lib/log-activity";
import type { Mistake } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, Chips, inputCls, Stat } from "./ui";

type Filter = "open" | "review" | "improving" | "mastered" | "all";
const STATUS = {
  review: { l: "Needs review", tone: "text-destructive border-destructive/40" },
  improving: { l: "Improving", tone: "text-cool2 border-cool/40" },
  mastered: { l: "Mastered", tone: "text-mint border-mint/40" },
} as const;

export function MistakeBank({
  setId,
  mistakes,
  limit,
  onDone,
}: {
  setId: string;
  mistakes: Mistake[];
  limit?: number;
  onDone?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(limit ? "open" : "open");
  const open = mistakes.filter((m) => m.status !== "mastered");
  const counts = {
    review: mistakes.filter((m) => m.status === "review").length,
    improving: mistakes.filter((m) => m.status === "improving").length,
    mastered: mistakes.filter((m) => m.status === "mastered").length,
  };
  const topics = [
    ...open.reduce(
      (map, m) => map.set(m.topic, (map.get(m.topic) ?? 0) + m.wrong_count),
      new Map<string, number>(),
    ),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  let shown =
    filter === "all"
      ? mistakes
      : filter === "open"
        ? open
        : mistakes.filter((m) => m.status === filter);
  if (limit) shown = open.slice(0, limit);

  if (limit)
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        {shown.length ? (
          shown.map((m) => <MistakeCard key={m.id} m={m} setId={setId} startOpen />)
        ) : (
          <p className="text-center text-sm text-soft">No open mistakes — nice work.</p>
        )}
        {onDone && (
          <div className="flex justify-end">
            <button onClick={onDone} className={btnPrimary}>
              Next activity
            </button>
          </div>
        )}
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <p className="eyebrow text-destructive">My Mistakes</p>
        <h2 className="font-display text-3xl uppercase mt-1">Mistake Bank</h2>
        <p className="text-sm text-soft mt-1">
          Every question you miss in quizzes, exams and Active Recall lands here. Get one right{" "}
          {MASTERED_AFTER} times in a row to master it. Repeated mistakes are prioritized in
          adaptive quizzes, Active Recall, Study Everything, plans and the Coach.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total mistakes" value={String(mistakes.length)} />
        <Stat label="Needs review" value={String(counts.review)} tone="text-destructive" />
        <Stat label="Improving" value={String(counts.improving)} />
        <Stat label="Mastered" value={String(counts.mastered)} tone="text-mint" />
      </div>
      {topics.length > 0 && (
        <div className="rounded-2xl bg-panel border border-line/70 p-5">
          <p className="eyebrow text-soft mb-3">Most common weak topics</p>
          <div className="flex flex-wrap gap-2">
            {topics.map(([t, n]) => (
              <span
                key={t}
                className="text-xs px-2.5 py-1 rounded-full border border-destructive/40 bg-destructive/10"
              >
                {t} · {n} miss{n === 1 ? "" : "es"}
              </span>
            ))}
          </div>
        </div>
      )}
      {open.length >= 2 && <Patterns setId={setId} />}
      <Chips
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { v: "open", l: `Open (${open.length})` },
          { v: "review", l: "Needs review" },
          { v: "improving", l: "Improving" },
          { v: "mastered", l: "Mastered" },
          { v: "all", l: "All" },
        ]}
      />
      <div className="space-y-3">
        {shown.length ? (
          shown.map((m) => <MistakeCard key={m.id} m={m} setId={setId} />)
        ) : (
          <p className="text-sm text-soft text-center py-8">
            {mistakes.length
              ? "Nothing in this view."
              : "No mistakes yet. Take a quiz or Active Recall — anything you miss will show up here."}
          </p>
        )}
      </div>
    </div>
  );
}

type QData = { type?: string; options?: string[]; answer?: number; answerText?: string };

function MistakeCard({ m, setId, startOpen }: { m: Mistake; setId: string; startOpen?: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const explainFn = useServerFn(explainMistake);
  const similarFn = useServerFn(similarQuestions);
  const gradeFn = useServerFn(gradeShortAnswers);
  const [openCard, setOpenCard] = useState(!!startOpen);
  const [mode, setMode] = useState<null | "retry" | "similar">(startOpen ? "retry" : null);
  const [explain, setExplain] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | number | null>(null);
  const [verdict, setVerdict] = useState<null | { correct: boolean; feedback?: string }>(null);
  const [similar, setSimilar] = useState<QuizQuestion[] | null>(null);
  const data = (m.question_data ?? {}) as QData;
  const choice =
    (data.type === "mc" || data.type === "tf") &&
    Array.isArray(data.options) &&
    data.options.length > 1;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["mistakes", setId] });
    qc.invalidateQueries({ queryKey: ["attempts", setId] });
  };

  const apply = async (correct: boolean, given: string) => {
    const streak = correct ? m.right_streak + 1 : 0;
    const { error: upErr } = await supabase
      .from("mistakes")
      .update(
        correct
          ? {
              right_streak: streak,
              status: nextStatus(streak),
              last_seen_at: new Date().toISOString(),
            }
          : {
              right_streak: 0,
              status: "review",
              wrong_count: m.wrong_count + 1,
              student_answer: given || m.student_answer,
              last_wrong_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
      )
      .eq("id", m.id);
    if (upErr) throw new Error("Couldn't save your progress on this mistake — try again.");
    if (user)
      await supabase
        .from("quiz_attempts")
        .insert({
          set_id: setId,
          user_id: user.id,
          kind: "review",
          difficulty: "mixed",
          score: correct ? 1 : 0,
          total: 1,
          results: [{ topic: m.topic, correct, q: m.question.slice(0, 200) }],
        });
    void logActivity("mistake", setId, 1, qc, {
      score: correct ? 1 : 0,
      total: 1,
      meta: { topic: m.topic },
    });
    refresh();
  };

  const check = async () => {
    setBusy("check");
    try {
      let correct: boolean, feedback: string | undefined;
      if (choice) correct = answer === data.answer;
      else {
        const r = await gradeFn({
          data: {
            items: [
              { question: m.question, expected: m.correct_answer, given: String(answer ?? "") },
            ],
          },
        });
        correct = !!r.grades[0]?.correct;
        feedback = r.grades[0]?.feedback;
      }
      await apply(correct, choice ? (data.options![Number(answer)] ?? "") : String(answer ?? ""));
      setVerdict({ correct, ...(feedback ? { feedback } : {}) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check your answer");
    }
    setBusy(null);
  };

  const getExplain = async () => {
    setBusy("explain");
    try {
      setExplain((await explainFn({ data: { mistakeId: m.id } })).text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No explanation available");
    }
    setBusy(null);
  };
  const getSimilar = async () => {
    setBusy("similar");
    setMode("similar");
    try {
      setSimilar((await similarFn({ data: { mistakeId: m.id, count: 3 } })).questions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write questions");
      setMode(null);
    }
    setBusy(null);
  };
  const remove = async () => {
    if (!confirm("Remove this mistake from your bank?")) return;
    const { error } = await supabase.from("mistakes").delete().eq("id", m.id);
    if (error) {
      toast.error("Couldn't remove this mistake — try again.");
      return;
    }
    refresh();
  };
  const st = STATUS[m.status as keyof typeof STATUS] ?? STATUS.review;

  return (
    <div className="rounded-2xl bg-panel border border-line/70">
      <button
        onClick={() => setOpenCard((o) => !o)}
        className="w-full text-left p-4 flex gap-3 justify-between items-start"
      >
        <span className="min-w-0">
          <span className="font-semibold block">{m.question}</span>
          <span className="text-xs text-soft">
            {m.topic} · {new Date(m.last_wrong_at).toLocaleDateString()} · from {m.source_kind} ·
            wrong {m.wrong_count}×{m.right_streak ? ` · ${m.right_streak} right in a row` : ""}
          </span>
        </span>
        <span className={cn("text-[11px] px-2 py-0.5 rounded-full border shrink-0", st.tone)}>
          {st.l}
        </span>
      </button>
      {openCard && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          {mode !== "retry" || verdict ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="eyebrow text-soft mb-1">Your answer</p>
                {m.student_answer || "—"}
              </div>
              <div className="rounded-lg border border-mint/30 bg-mint/5 p-3">
                <p className="eyebrow text-soft mb-1">Correct answer</p>
                {m.correct_answer || "—"}
              </div>
              {m.explanation && <div className="sm:col-span-2 text-soft">{m.explanation}</div>}
            </div>
          ) : null}
          {mode === "retry" && (
            <div className="rounded-xl border border-cool/30 bg-cool/5 p-4 space-y-3">
              <p className="eyebrow text-cool2">Try it again</p>
              {choice ? (
                <div className="grid sm:grid-cols-2 gap-2">
                  {data.options!.map((o, i) => (
                    <button
                      key={i}
                      disabled={!!verdict}
                      onClick={() => setAnswer(i)}
                      className={cn(
                        "text-left rounded-lg border px-3 py-2",
                        verdict && i === data.answer
                          ? "border-mint/60 bg-mint/10"
                          : answer === i
                            ? "border-cool2/70 bg-cool/15"
                            : "border-line/70 text-soft",
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  rows={3}
                  disabled={!!verdict}
                  value={typeof answer === "string" ? answer : ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Answer from memory…"
                  className={inputCls + " w-full"}
                />
              )}
              {verdict ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      "font-semibold inline-flex items-center gap-1",
                      verdict.correct ? "text-mint" : "text-destructive",
                    )}
                  >
                    {verdict.correct ? <Check className="size-4" /> : <X className="size-4" />}
                    {verdict.correct ? "Correct — progress saved" : "Not yet — it stays in review"}
                  </span>
                  {verdict.feedback && <span className="text-soft">{verdict.feedback}</span>}
                  <button
                    onClick={() => {
                      setVerdict(null);
                      setAnswer(null);
                    }}
                    className={cn(btnGhost, "py-1.5")}
                  >
                    <RotateCcw className="size-4" /> Again
                  </button>
                </div>
              ) : (
                <button
                  onClick={check}
                  disabled={answer == null || answer === "" || !!busy}
                  className={btnPrimary}
                >
                  {busy === "check" && <Loader2 className="size-4 animate-spin" />} Check
                </button>
              )}
            </div>
          )}
          {mode === "similar" &&
            (busy === "similar" ? (
              <p className="text-soft inline-flex gap-2 items-center">
                <Loader2 className="size-4 animate-spin" /> Writing similar questions…
              </p>
            ) : (
              similar && (
                <SimilarPractice
                  qs={similar}
                  setId={setId}
                  onAllCorrect={() => {
                    apply(true, "").catch((e) =>
                      toast.error(e instanceof Error ? e.message : "Couldn't save progress"),
                    );
                  }}
                />
              )
            ))}
          {explain && (
            <div className="md rounded-lg bg-foreground/5 p-3">
              <ReactMarkdown>{explain}</ReactMarkdown>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setMode("retry");
                setVerdict(null);
                setAnswer(null);
              }}
              className={cn(btnGhost, "py-1.5")}
            >
              <RotateCcw className="size-4" /> Try again
            </button>
            <button onClick={getExplain} disabled={!!busy} className={cn(btnGhost, "py-1.5")}>
              {busy === "explain" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lightbulb className="size-4" />
              )}{" "}
              Explain
            </button>
            <button onClick={getSimilar} disabled={!!busy} className={cn(btnGhost, "py-1.5")}>
              <Sparkles className="size-4" /> Practice similar
            </button>
            <button
              onClick={remove}
              className="ml-auto text-xs text-soft hover:text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="size-3" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SimilarPractice({
  qs,
  setId,
  onAllCorrect,
}: {
  qs: QuizQuestion[];
  setId: string;
  onAllCorrect: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const gradeFn = useServerFn(gradeShortAnswers);
  const [ans, setAns] = useState<(string | number | null)[]>(qs.map(() => null));
  const [res, setRes] = useState<boolean[] | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    setAns(qs.map(() => null));
    setRes(null);
  }, [qs]);
  const submit = async () => {
    setBusy(true);
    const r = qs.map((q, i) => q.type !== "short" && ans[i] === q.answer);
    const shortIdx = qs.map((q, i) => (q.type === "short" ? i : -1)).filter((i) => i >= 0);
    if (shortIdx.length) {
      try {
        const g = await gradeFn({
          data: {
            items: shortIdx.map((i) => ({
              question: qs[i]!.question,
              expected: qs[i]!.answerText,
              given: String(ans[i] ?? ""),
            })),
          },
        });
        shortIdx.forEach((qi, k) => (r[qi] = !!g.grades[k]?.correct));
      } catch {
        /* leave as incorrect */
      }
    }
    setRes(r);
    setBusy(false);
    if (user) {
      await supabase
        .from("quiz_attempts")
        .insert({
          set_id: setId,
          user_id: user.id,
          kind: "review",
          difficulty: "mixed",
          score: r.filter(Boolean).length,
          total: r.length,
          results: qs.map((q, i) => ({
            topic: q.topic,
            correct: r[i]!,
            q: q.question.slice(0, 200),
          })),
        });
      void recordResults(
        user.id,
        qs.map((q, i) => ({
          setId,
          question: q.question,
          correct: r[i]!,
          studentAnswer:
            q.type === "short" ? String(ans[i] ?? "") : (q.options[Number(ans[i])] ?? ""),
          correctAnswer: q.answerText,
          explanation: q.explanation,
          topic: q.topic,
          kind: "review",
          data: { ...q },
        })),
        qc,
      );
    }
    if (r.every(Boolean) && !done.current) {
      done.current = true;
      onAllCorrect();
    }
  };
  return (
    <div className="rounded-xl border border-violet/30 bg-violet/5 p-4 space-y-4">
      <p className="eyebrow text-violet">Similar questions</p>
      {qs.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="font-semibold">
            {i + 1}. {q.question}
          </p>
          {q.type === "short" ? (
            <textarea
              rows={2}
              disabled={!!res}
              value={typeof ans[i] === "string" ? (ans[i] as string) : ""}
              onChange={(e) => setAns((a) => a.map((x, k) => (k === i ? e.target.value : x)))}
              className={inputCls + " w-full"}
            />
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {q.options.map((o, oi) => (
                <button
                  key={oi}
                  disabled={!!res}
                  onClick={() => setAns((a) => a.map((x, k) => (k === i ? oi : x)))}
                  className={cn(
                    "text-left rounded-lg border px-3 py-2",
                    res && oi === q.answer
                      ? "border-mint/60 bg-mint/10"
                      : ans[i] === oi
                        ? "border-cool2/70 bg-cool/15"
                        : "border-line/70 text-soft",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {res && (
            <p className={cn("text-xs", res[i] ? "text-mint" : "text-destructive")}>
              {res[i] ? "Correct" : `Answer: ${q.answerText}`}{" "}
              {q.explanation && <span className="text-soft">— {q.explanation}</span>}
            </p>
          )}
        </div>
      ))}
      {!res ? (
        <button
          onClick={submit}
          disabled={busy || ans.some((a) => a == null || a === "")}
          className={btnPrimary}
        >
          {busy && <Loader2 className="size-4 animate-spin" />} Check answers
        </button>
      ) : (
        <p className="text-sm">
          {res.filter(Boolean).length}/{res.length} correct
          {res.every(Boolean)
            ? " — counted as progress on this mistake."
            : ". Misses were added to your bank."}
        </p>
      )}
    </div>
  );
}

function Patterns({ setId }: { setId: string }) {
  const fn = useServerFn(mistakePatterns);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      setText((await fn({ data: { setId } })).text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't analyze your mistakes");
    }
    setBusy(false);
  };
  return (
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-violet">Why do I keep missing these?</p>
          <p className="text-sm text-soft">
            Momentum looks across all your open mistakes for repeated misconceptions.
          </p>
        </div>
        <button onClick={go} disabled={busy} className={btnGhost}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{" "}
          {text ? "Re-analyze" : "Find my patterns"}
        </button>
      </div>
      {text && (
        <div className="md text-sm rounded-lg bg-foreground/5 p-3">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
