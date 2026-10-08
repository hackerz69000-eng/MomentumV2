import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Loader2, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  generateComprehensive,
  generateQuiz,
  gradeShortAnswers,
  type QuizQuestion,
} from "@/lib/study.functions";
import { logActivity } from "@/lib/log-activity";
import { recordResults } from "@/lib/mistakes";
import { ExplainWhy } from "./ExplainWhy";
import { adaptivePlan, shuffle, type Attempt, type TopicRow } from "@/lib/stats";
import { recordStudySessionCompletion } from "@/components/DailyStreak";
import { updateLocalSetProgress } from "@/lib/local-store";
import type { StudySet } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, Chips, ErrorBox, inputCls } from "./ui";

type Kind = "quiz" | "exam" | "comprehensive";
type Difficulty = "easy" | "medium" | "hard" | "mixed";
type QType = "mc" | "tf" | "short";
type Answer = number | string | null;
type Graded = { correct: boolean; feedback?: string };
type Settings = {
  count: number;
  difficulty: Difficulty;
  types: QType[];
  minutes: number;
  adaptive: boolean;
  questionGuidance: string;
};

const DIFFS = [
  { v: "easy", l: "Easy" },
  { v: "medium", l: "Medium" },
  { v: "hard", l: "Hard" },
  { v: "mixed", l: "Mixed" },
] as const;

function prepare(qs: QuizQuestion[]): QuizQuestion[] {
  return shuffle(qs).map((q) => {
    if (q.type !== "mc") return q;
    const order = shuffle(q.options.map((_, i) => i));
    return { ...q, options: order.map((i) => q.options[i]!), answer: order.indexOf(q.answer) };
  });
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function QuizRunner({
  set,
  sets,
  kind,
  attempts,
  topics = [],
  onExit,
  onDone,
  preset,
  autoStart,
  lectureId,
}: {
  set?: StudySet;
  sets?: StudySet[];
  kind: Kind;
  attempts: Attempt[];
  topics?: TopicRow[];
  onExit?: () => void;
  onDone?: () => void;
  preset?: Partial<Settings>;
  autoStart?: boolean;
  lectureId?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const gen = useServerFn(generateQuiz);
  const genComp = useServerFn(generateComprehensive);
  const grade = useServerFn(gradeShortAnswers);
  const comprehensive = kind === "comprehensive";
  const exam = kind !== "quiz";
  const [usedAdaptive, setUsedAdaptive] = useState(false);

  const [settings, setSettings] = useState<Settings>(
    exam
      ? {
          count: 20,
          difficulty: "mixed",
          types: ["mc", "tf", "short"],
          minutes: 30,
          adaptive: false,
          questionGuidance: "",
          ...preset,
        }
      : {
          count: 10,
          difficulty: "mixed",
          types: ["mc"],
          minutes: 0,
          adaptive: false,
          questionGuidance: "",
          ...preset,
        },
  );
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [current, setCurrent] = useState(0);
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const [loading, setLoading] = useState<null | "gen" | "grade">(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const startedAt = useRef(0);
  const submitting = useRef(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const toggleFlag = (k: number) =>
    setFlagged((f) => {
      const n = new Set(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const confirmSubmit = () => {
    const un = questions ? questions.length - answeredCount : 0;
    const msgs = [
      un ? `${un} unanswered` : "",
      flagged.size ? `${flagged.size} marked for review` : "",
    ].filter(Boolean);
    if (
      !confirm(
        msgs.length
          ? `${msgs.join(" and ")}. Submit anyway?`
          : "Submit your exam? You can't change answers afterwards.",
      )
    )
      return;
    void submit();
  };

  const start = async () => {
    setLoading("gen");
    setError(null);
    setGraded(null);
    try {
      const plan = !exam && settings.adaptive ? adaptivePlan(topics, settings.count) : [];
      if (!exam && settings.adaptive && !plan.length)
        toast.info("No performance data yet — this first adaptive quiz covers all topics evenly.");
      setUsedAdaptive(!exam && settings.adaptive);
      const res = comprehensive
        ? await genComp({
            data: {
              setIds: (sets ?? []).map((s) => s.id),
              count: settings.count,
              difficulty: settings.difficulty,
              types: settings.types,
              questionGuidance: settings.questionGuidance.trim() || undefined,
            },
          })
        : await gen({
            data: {
              setId: set!.id,
              count: settings.count,
              difficulty: settings.difficulty,
              types: settings.types,
              exam,
              plan: plan.length ? plan : undefined,
              lectureId,
              questionGuidance: settings.questionGuidance.trim() || undefined,
            },
          });
      const qs = prepare(res.questions);
      setQuestions(qs);
      setAnswers(qs.map(() => null));
      setCurrent(0);
      setFlagged(new Set());
      startedAt.current = Date.now();
      submitting.current = false;
      setRemaining(exam && settings.minutes ? settings.minutes * 60 : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    }
    setLoading(null);
  };

  const submit = async () => {
    if (!questions || submitting.current) return;
    submitting.current = true;
    setLoading("grade");
    setRemaining(null);
    const results: Graded[] = questions.map((q, i) =>
      q.type === "short" ? { correct: false } : { correct: answers[i] === q.answer },
    );
    const shortIdx = questions
      .map((q, i) => (q.type === "short" && String(answers[i] ?? "").trim() ? i : -1))
      .filter((i) => i >= 0);
    if (shortIdx.length) {
      try {
        const { grades } = await grade({
          data: {
            items: shortIdx.map((i) => ({
              question: questions[i]!.question,
              expected: questions[i]!.answerText,
              given: String(answers[i]),
            })),
          },
        });
        shortIdx.forEach((qi, k) => (results[qi] = grades[k] ?? { correct: false }));
      } catch (e) {
        toast.error("Couldn't grade short answers automatically — they were marked incorrect.");
      }
    }
    setGraded(results);
    setLoading(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const score = results.filter((r) => r.correct).length;
    if (!user) return;
    const duration = Math.round((Date.now() - startedAt.current) / 1000);
    const savedKind = usedAdaptive ? "adaptive" : kind;
    const groups = new Map<string, number[]>();
    questions.forEach((q, i) => {
      const sid = q.setId ?? set!.id;
      groups.set(sid, [...(groups.get(sid) ?? []), i]);
    });
    const rows = [...groups.entries()].map(([sid, idx]) => ({
      set_id: sid,
      user_id: user.id,
      kind: savedKind,
      difficulty: settings.difficulty,
      score: idx.filter((i) => results[i]!.correct).length,
      total: idx.length,
      duration_seconds: duration,
      results: idx.map((i) => ({
        topic: questions[i]!.topic,
        correct: results[i]!.correct,
        q: questions[i]!.question.slice(0, 200),
      })),
    }));
    const { error } = await supabase.from("quiz_attempts").insert(rows);
    if (error) {
      toast.error(
        "Your answers are graded below, but we couldn't save this result to your progress. Check your connection and retake to record it.",
      );
      return;
    }
    const ansText = (q: QuizQuestion, a: Answer) =>
      a == null || a === "" ? "" : q.type === "short" ? String(a) : (q.options[Number(a)] ?? "");
    void recordResults(
      user.id,
      questions.map((q, i) => ({
        setId: q.setId ?? set!.id,
        question: q.question,
        correct: results[i]!.correct,
        studentAnswer: ansText(q, answers[i] ?? null),
        correctAnswer: q.answerText || (q.type !== "short" ? (q.options[q.answer] ?? "") : ""),
        explanation: q.explanation || results[i]!.feedback || "",
        topic: q.topic,
        kind: savedKind,
        data: {
          type: q.type,
          question: q.question,
          options: q.options,
          answer: q.answer,
          answerText: q.answerText,
          explanation: q.explanation,
          topic: q.topic,
        },
      })),
      qc,
    );
    if (set?.id) {
      updateLocalSetProgress(set.id, score, questions.length);
    }
    const mins = Math.max(5, Math.round(duration / 60) || 10);
    recordStudySessionCompletion(mins, set?.name ? `Quiz: ${set.name}` : "Study Quiz");
    toast.success("Quiz completed! Study session recorded & Daily Streak updated! 🔥");

    if (kind === "quiz" && set?.id) {
      try {
        await supabase
          .from("study_sets")
          .update({ quiz_score: score, quiz_total: questions.length })
          .eq("id", set.id);
      } catch {
        // ignore
      }
    }
    void logActivity(savedKind, comprehensive ? null : set!.id, 1, qc, {
      score,
      total: questions.length,
      duration_seconds: duration,
      meta: comprehensive ? { sets: [...groups.keys()] } : null,
    });
    onDone?.();
    for (const sid of groups.keys()) {
      qc.invalidateQueries({ queryKey: ["attempts", sid] });
      qc.invalidateQueries({ queryKey: ["set", sid] });
    }
    qc.invalidateQueries({ queryKey: ["sets"] });
    qc.invalidateQueries({ queryKey: ["all-attempts"] });
  };

  const auto = useRef(false);
  useEffect(() => {
    if (autoStart && !auto.current) {
      auto.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Exam timer
  useEffect(() => {
    if (remaining == null || graded) return;
    if (remaining <= 0) {
      toast.info("Time's up — your exam was submitted.");
      void submit();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r == null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, graded]);

  const setAnswer = (qi: number, v: Answer) =>
    setAnswers((a) => a.map((x, k) => (k === qi ? v : x)));
  const answeredCount = answers.filter((a) => a != null && String(a).trim() !== "").length;

  if (loading === "gen")
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">
          {comprehensive
            ? "Building your comprehensive exam"
            : exam
              ? "Building your practice exam"
              : settings.adaptive
                ? "Writing your adaptive quiz"
                : "Writing your quiz"}
        </h2>
        <p className="text-soft text-sm mt-1">
          {settings.count > 15
            ? "Longer sets can take up to a minute."
            : "Usually takes 10–30 seconds."}
        </p>
      </div>
    );

  if (!questions) {
    const pastScores = attempts
      .filter((a) => (exam ? a.kind === kind : a.kind === "quiz" || a.kind === "adaptive"))
      .slice(-5)
      .reverse();
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="rounded-2xl bg-panel border border-line/70 p-6 md:p-8 space-y-5">
          <div>
            <p className={cn("eyebrow", exam ? "text-cool2" : "text-mint")}>
              {comprehensive ? "Comprehensive exam" : exam ? "Practice exam" : "Quiz"}
            </p>
            <h2 className="font-display text-3xl uppercase mt-1">
              {exam ? "Simulate the real test" : "Test yourself"}
            </h2>
            <p className="text-sm text-soft mt-1">
              {exam
                ? "Answers stay hidden until you submit. Move freely between questions."
                : "Instant feedback with explanations after you submit."}
            </p>
          </div>
          {comprehensive && (
            <div>
              <p className="eyebrow text-soft mb-2">Selected study sets</p>
              <div className="flex flex-wrap gap-2">
                {(sets ?? []).map((s) => (
                  <span
                    key={s.id}
                    className="text-xs px-2.5 py-1 rounded-full border border-cool/40 bg-cool/10"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
              <p className="text-xs text-soft mt-2">
                Questions are split evenly across these sets.
              </p>
            </div>
          )}
          {!exam && (
            <Chips
              label="Mode"
              value={settings.adaptive ? "adaptive" : "standard"}
              onChange={(v) => setSettings((s) => ({ ...s, adaptive: v === "adaptive" }))}
              options={[
                { v: "standard", l: "Standard" },
                { v: "adaptive", l: "Adaptive Quiz" },
              ]}
            />
          )}
          {!exam && settings.adaptive && (
            <p className="text-xs text-soft -mt-2">
              {topics.length
                ? `Focuses on your weak topics (${
                    topics
                      .filter((t) => t.status !== "Strong")
                      .slice(0, 3)
                      .map((t) => t.topic)
                      .join(", ") || "none yet"
                  }) while still reviewing strong ones.`
                : "No performance data yet — your first adaptive quiz covers everything; later ones adapt to your results."}
            </p>
          )}
          <Chips
            label="Questions"
            value={settings.count}
            onChange={(count) => setSettings((s) => ({ ...s, count }))}
            options={(comprehensive
              ? [10, 20, 30, 40, 60]
              : exam
                ? [10, 20, 30, 50]
                : [5, 10, 20, 30]
            ).map((v) => ({ v, l: String(v) }))}
          />
          <Chips
            label="Difficulty"
            value={settings.difficulty}
            onChange={(difficulty) => setSettings((s) => ({ ...s, difficulty }))}
            options={DIFFS}
          />
          {(!exam || comprehensive) && (
            <div>
              <p className="eyebrow text-soft mb-2">Question types</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["mc", "Multiple choice"],
                    ["tf", "True / false"],
                    ["short", "Short answer"],
                  ] as const
                ).map(([v, l]) => {
                  const on = settings.types.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setSettings((s) => {
                          const types = on ? s.types.filter((t) => t !== v) : [...s.types, v];
                          return { ...s, types: types.length ? types : s.types };
                        })
                      }
                      className={cn(
                        "px-3.5 py-1.5 text-sm font-semibold rounded-lg border",
                        on ? "bg-cool/20 border-cool/40" : "border-line/70 text-soft",
                      )}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <p className="eyebrow text-soft mb-2">What should the test questions be like?</p>
            <textarea
              value={settings.questionGuidance}
              onChange={(e) => setSettings((s) => ({ ...s, questionGuidance: e.target.value }))}
              maxLength={2000}
              rows={4}
              placeholder="Optional. Tell the AI what you expect from the real test. Example: mostly scenario-based questions, compare concepts, focus on calculations, professor likes application questions, avoid simple definitions…"
              className={cn(inputCls, "w-full resize-y")}
            />
            <p className="text-xs text-soft mt-1">
              The AI will use this as a question-style preference while still only asking about your
              study material.
            </p>
          </div>
          {exam && (
            <Chips
              label="Time limit"
              value={settings.minutes}
              onChange={(minutes) => setSettings((s) => ({ ...s, minutes }))}
              options={[
                { v: 0, l: "None" },
                { v: 15, l: "15 min" },
                { v: 30, l: "30 min" },
                { v: 60, l: "60 min" },
                { v: 90, l: "90 min" },
              ]}
            />
          )}
          {error && <ErrorBox msg={error} />}
          <div className="flex gap-2">
            <button onClick={start} className={btnPrimary}>
              {exam ? "Start exam" : settings.adaptive ? "Start adaptive quiz" : "Start quiz"}
            </button>
            {onExit && (
              <button onClick={onExit} className={btnGhost}>
                Change sets
              </button>
            )}
          </div>
        </div>
        {pastScores.length > 0 && (
          <div className="rounded-2xl bg-panel border border-line/70 p-5">
            <p className="eyebrow text-soft mb-3">Recent {exam ? "exams" : "attempts"}</p>
            <ul className="space-y-2 text-sm">
              {pastScores.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span className="text-soft">
                    {new Date(a.created_at).toLocaleDateString()} · {a.difficulty}
                  </span>
                  <span className="font-display text-mint">
                    {a.score}/{a.total} · {Math.round((a.score / a.total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (loading === "grade")
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">Grading</h2>
      </div>
    );

  if (graded)
    return (
      <Results
        questions={questions}
        answers={answers}
        graded={graded}
        exam={exam}
        before={topics}
        setNames={
          comprehensive ? Object.fromEntries((sets ?? []).map((s) => [s.id, s.name])) : undefined
        }
        onRetry={start}
        onSetup={() => setQuestions(null)}
        setId={set?.id}
        lectureId={lectureId}
      />
    );

  // Exam: one question at a time
  if (exam) {
    const q = questions[current]!;
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-panel border border-line/70 px-4 py-3">
          <span className="font-display text-lg">
            Question {current + 1} <span className="text-soft">/ {questions.length}</span>
          </span>
          <button
            onClick={() => toggleFlag(current)}
            aria-pressed={flagged.has(current)}
            className={cn(
              "text-xs font-semibold rounded-full border px-3 py-1",
              flagged.has(current)
                ? "border-violet/60 bg-violet/15 text-violet"
                : "border-line/70 text-soft",
            )}
          >
            {flagged.has(current) ? "Marked for review" : "Mark for review"}
          </button>
          {remaining != null && (
            <span
              className={cn(
                "font-display text-lg inline-flex items-center gap-2",
                remaining < 60 ? "text-destructive" : "text-cool2",
              )}
            >
              <Clock className="size-4" /> {fmt(remaining)}
            </span>
          )}
        </div>
        <QuestionCard q={q} qi={current} value={answers[current] ?? null} onChange={setAnswer} />
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
            className={btnGhost}
          >
            Previous
          </button>
          {current < questions.length - 1 ? (
            <button onClick={() => setCurrent((c) => c + 1)} className={btnPrimary}>
              Next
            </button>
          ) : (
            <button onClick={confirmSubmit} className={btnPrimary}>
              Submit exam
            </button>
          )}
        </div>
        <div className="rounded-xl bg-panel border border-line/70 p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="eyebrow text-soft">
              {answeredCount}/{questions.length} answered
              {flagged.size ? ` · ${flagged.size} marked` : ""}
            </p>
            <button onClick={confirmSubmit} className="text-xs text-cool2 font-semibold">
              Submit now
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((_, k) => {
              const done = answers[k] != null && String(answers[k]).trim() !== "";
              return (
                <button
                  key={k}
                  onClick={() => setCurrent(k)}
                  aria-label={`Question ${k + 1}${done ? ", answered" : ""}${flagged.has(k) ? ", marked for review" : ""}`}
                  className={cn(
                    "size-8 rounded-md text-xs font-semibold border",
                    flagged.has(k) && "ring-2 ring-violet/70",
                    k === current
                      ? "border-cool2 bg-cool/25"
                      : done
                        ? "border-cool/40 bg-cool/10"
                        : "border-line/70 text-soft",
                  )}
                >
                  {k + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {questions.map((q, qi) => (
        <QuestionCard key={qi} q={q} qi={qi} value={answers[qi] ?? null} onChange={setAnswer} />
      ))}
      <div className="flex items-center justify-between">
        <span className="text-sm text-soft">
          {answeredCount}/{questions.length} answered
        </span>
        <button onClick={submit} disabled={answeredCount === 0} className={btnPrimary}>
          Submit quiz
        </button>
      </div>
    </div>
  );
}

function QuestionCard({
  q,
  qi,
  value,
  onChange,
}: {
  q: QuizQuestion;
  qi: number;
  value: Answer;
  onChange: (qi: number, v: Answer) => void;
}) {
  return (
    <div className="rounded-2xl bg-panel border border-line/70 p-5">
      <p className="eyebrow text-soft">
        Question {qi + 1} ·{" "}
        {q.type === "mc" ? "Multiple choice" : q.type === "tf" ? "True / false" : "Short answer"}
      </p>
      <p className="font-semibold mt-2">{q.question}</p>
      {q.type === "short" ? (
        <textarea
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(qi, e.target.value)}
          placeholder="Type your answer…"
          className={inputCls + " w-full mt-4"}
        />
      ) : (
        <div className={cn("grid gap-2 mt-4", q.type === "tf" ? "grid-cols-2" : "sm:grid-cols-2")}>
          {q.options.map((o, oi) => (
            <button
              key={oi}
              onClick={() => onChange(qi, oi)}
              className={cn(
                "text-left text-sm rounded-lg border px-3 py-2.5 transition-colors flex items-start gap-2",
                value === oi
                  ? "border-cool2/70 bg-cool/15"
                  : "border-line/70 text-soft hover:border-cool/50",
              )}
            >
              {q.type === "mc" && (
                <span className="font-display">{String.fromCharCode(65 + oi)}</span>
              )}
              <span className="flex-1">{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Results({
  questions,
  answers,
  graded,
  exam,
  before,
  setNames,
  onRetry,
  onSetup,
  setId,
  lectureId,
}: {
  setId?: string | undefined;
  lectureId?: string | undefined;
  questions: QuizQuestion[];
  answers: Answer[];
  graded: Graded[];
  exam: boolean;
  before: TopicRow[];
  setNames?: Record<string, string> | undefined;
  onRetry: () => void;
  onSetup: () => void;
}) {
  const score = graded.filter((g) => g.correct).length;
  const wrongByTopic = new Map<string, { wrong: number; total: number }>();
  questions.forEach((q, i) => {
    const m = wrongByTopic.get(q.topic) ?? { wrong: 0, total: 0 };
    m.total++;
    if (!graded[i]!.correct) m.wrong++;
    wrongByTopic.set(q.topic, m);
  });
  const struggled = [...wrongByTopic.entries()]
    .filter(([, m]) => m.wrong > 0)
    .sort((a, b) => b[1].wrong / b[1].total - a[1].wrong / a[1].total);
  const strong = [...wrongByTopic.entries()].filter(([, m]) => m.wrong === 0).map(([t]) => t);
  const prevAcc = new Map(before.map((t) => [t.topic, t.accuracy]));
  const improved = [...wrongByTopic.entries()]
    .filter(
      ([t, m]) => prevAcc.has(t) && ((m.total - m.wrong) / m.total) * 100 >= prevAcc.get(t)! + 15,
    )
    .map(([t]) => t);
  const pctScore = Math.round((score / questions.length) * 100);
  const next =
    struggled.length === 0
      ? exam
        ? "Great result. Keep reviewing due flashcards to stay sharp."
        : "Great result. Take a practice exam to confirm you're ready."
      : pctScore < 60
        ? `Do Active Recall on ${struggled[0]![0]}, then read the Weak Areas section of your Study Guide.`
        : `Review flashcards on ${struggled[0]![0]}, then take another Adaptive Quiz.`;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="rounded-2xl dpanel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow text-cool2">{exam ? "Exam result" : "Your score"}</p>
            <p className="font-display text-5xl text-mint">
              {Math.round((score / questions.length) * 100)}%
            </p>
            <p className="text-sm text-soft">
              <span className="text-mint">{score} correct</span> ·{" "}
              <span className="text-destructive">{questions.length - score} incorrect</span> · saved
              to your progress
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={onRetry} className={btnPrimary}>
              <RefreshCw className="size-4" /> Try again
            </button>
            <button onClick={onSetup} className={btnGhost}>
              Change settings
            </button>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-cool2/20 grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="eyebrow text-soft mb-1.5">Strong topics</p>
            <p>{strong.join(", ") || "—"}</p>
          </div>
          <div>
            <p className="eyebrow text-soft mb-1.5">Topics that improved</p>
            <p>{improved.join(", ") || "—"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="eyebrow text-soft mb-1.5">Recommended next</p>
            <p>{next}</p>
          </div>
        </div>
        {struggled.length > 0 && (
          <div className="mt-5 pt-5 border-t border-cool2/20">
            <p className="eyebrow text-soft mb-2">Weak topics</p>
            <div className="flex flex-wrap gap-2">
              {struggled.map(([t, m]) => (
                <span
                  key={t}
                  className="text-xs px-2.5 py-1 rounded-full border border-destructive/40 bg-destructive/10"
                >
                  {t} · {m.wrong}/{m.total} missed
                </span>
              ))}
            </div>
            {exam && (
              <div className="mt-4 text-sm">
                <p className="eyebrow text-soft mb-2">Recommended review</p>
                <ul className="list-disc ml-5 space-y-1 text-soft">
                  {struggled.slice(0, 4).map(([t]) => (
                    <li key={t}>
                      Re-read the <span className="text-foreground">{t}</span> section in your Notes
                      and use "Explain" on anything unclear.
                    </li>
                  ))}
                  <li>Review your due Flashcards, then take a short quiz on Hard difficulty.</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      {questions.map((q, qi) => {
        const g = graded[qi]!;
        const a = answers[qi];
        return (
          <div
            key={qi}
            className={cn(
              "rounded-2xl bg-panel border p-5",
              g.correct ? "border-mint/30" : "border-destructive/30",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow text-soft">
                Question {qi + 1} · {q.topic}
                {setNames && q.setId ? ` · ${setNames[q.setId] ?? ""}` : ""}
              </p>
              {g.correct ? (
                <Check className="size-5 text-mint shrink-0" />
              ) : (
                <X className="size-5 text-destructive shrink-0" />
              )}
            </div>
            <p className="font-semibold mt-2">{q.question}</p>
            <div className="text-sm mt-3 space-y-1">
              <p>
                <span className="text-soft">Your answer: </span>
                <span className={g.correct ? "text-mint" : "text-destructive"}>
                  {a == null || String(a).trim() === ""
                    ? "Not answered"
                    : typeof a === "number"
                      ? q.options[a]
                      : a}
                </span>
              </p>
              {!g.correct && (
                <p>
                  <span className="text-soft">Correct answer: </span>
                  {q.type === "short" ? q.answerText : q.options[q.answer]}
                </p>
              )}
            </div>
            <p className="text-sm mt-3 rounded-lg bg-foreground/5 p-3 text-soft">
              {g.feedback && <span className="text-foreground">{g.feedback} </span>}
              {q.explanation}
            </p>
            {(q.setId ?? setId) && (
              <ExplainWhy
                setId={(q.setId ?? setId)!}
                lectureId={q.setId ? undefined : lectureId}
                question={q.question}
                options={q.options}
                correct={q.type === "short" ? q.answerText : (q.options[q.answer] ?? q.answerText)}
                given={a == null ? "" : typeof a === "number" ? (q.options[a] ?? "") : String(a)}
                topic={q.topic}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
