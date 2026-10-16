import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { ExplainWhy } from "@/components/set/ExplainWhy";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/attempts/$id")({
  ssr: false,
  component: AttemptReviewPage,
});

type ReviewAnswer = {
  topic?: string;
  correct?: boolean;
  question?: string;
  q?: string;
  options?: string[];
  questionType?: string;
  studentAnswer?: string;
  correctAnswer?: string;
  explanation?: string;
  student_answer?: string;
  given?: string;
  correct_answer?: string;
  answer?: string;
  feedback?: string;
};

function AttemptReviewPage() {
  const { id } = Route.useParams();
  const attemptQ = useQuery({
    queryKey: ["attempt-review", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("quiz_attempts").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  const attempt = attemptQ.data;
  const answers = (Array.isArray(attempt?.results) ? attempt.results : []) as ReviewAnswer[];
  const pct = attempt?.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const valueOf = (a: ReviewAnswer, ...keys: (keyof ReviewAnswer)[]) => {
    for (const key of keys) { const value = a[key]; if (typeof value === "string" && value.trim()) return value; }
    return "";
  };
  const setId = typeof attempt?.set_id === "string" ? attempt.set_id : "";
  const isExam = attempt?.kind === "exam" || attempt?.kind === "comprehensive";
  return (
    <main className="flex-1 min-w-0">
      <header className="px-5 md:px-8 py-5 border-b border-line/60 bg-ink/60">
        <Link to="/history" className="text-sm text-soft hover:text-foreground inline-flex items-center gap-2"><ArrowLeft className="size-4"/> Back to Study History</Link>
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide mt-3">Review {attempt?.kind === "exam" || attempt?.kind === "comprehensive" ? "Exam" : "Quiz"}</h1>
        {attempt && <><p className="text-sm text-soft mt-1">{new Date(attempt.created_at).toLocaleString()} · {attempt.score}/{attempt.total} correct · {pct}% · {attempt.duration_seconds ? `${Math.max(1, Math.round(attempt.duration_seconds / 60))} min` : ""}</p>{setId && <Link to="/sets/$id" params={{ id: setId }} search={{ tab: isExam ? "exam" : "quiz" }} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand text-ink px-4 py-2 text-sm font-semibold"><RotateCcw className="size-4"/> Retake {isExam ? "exam" : "quiz"}</Link>}</>}
      </header>
      <div className="p-5 md:p-8 max-w-3xl mx-auto space-y-4">
        {attemptQ.isLoading && <Loader2 className="size-6 animate-spin text-cool2"/>}
        {attemptQ.isError && <p className="text-sm text-destructive">This attempt could not be loaded. It may have been deleted or you may not have access to it.</p>}
        {attempt && answers.length === 0 && <div className="rounded-xl bg-panel border border-line p-5"><p className="font-semibold">This older attempt has a saved score, but not a full question-by-question snapshot.</p><p className="text-sm text-soft mt-2">New quizzes and exams save answer details for review. Older results cannot be reconstructed if those details were never stored.</p></div>}
        {answers.map((a, i) => {
          const question = valueOf(a, "question", "q");
          const given = valueOf(a, "studentAnswer", "student_answer", "given", "answer");
          const correctAnswer = valueOf(a, "correctAnswer", "correct_answer");
          return <article key={`${i}-${question || "question"}`} className={`rounded-2xl bg-panel border p-5 space-y-3 ${a.correct ? "border-mint/30" : "border-destructive/30"}`}>
            <div className="flex items-center justify-between gap-3"><p className="eyebrow text-soft">Question {i + 1}{a.topic ? ` · ${a.topic}` : ""}</p>{a.correct ? <CheckCircle2 className="size-5 text-mint"/> : <XCircle className="size-5 text-destructive"/>}</div>
            <h2 className="font-semibold">{question || "Question text unavailable"}</h2>
            {Array.isArray(a.options) && a.options.length > 0 && <ul className="space-y-1 text-sm">{a.options.map((option, j) => <li key={j} className={`rounded-lg px-3 py-2 ${option === correctAnswer ? "bg-mint/10 text-mint" : option === given && !a.correct ? "bg-destructive/10 text-destructive" : "bg-foreground/5"}`}>{option}</li>)}</ul>}
            <p className="text-sm"><span className="text-soft">Your answer: </span><span className={a.correct ? "text-mint" : "text-destructive"}>{given || "Not answered"}</span></p>
            {!a.correct && <p className="text-sm"><span className="text-soft">Correct answer: </span><span className="text-mint">{correctAnswer || "Not saved"}</span></p>}
            {(a.explanation || a.feedback) && <p className="text-sm text-soft rounded-lg bg-foreground/5 p-3">{a.explanation || a.feedback}</p>}
            {!a.correct && setId && <ExplainWhy setId={setId} question={question} options={a.options} correct={correctAnswer} given={given} topic={a.topic} />}
          </article>;
        })}
      </div>
    </main>
  );
}
