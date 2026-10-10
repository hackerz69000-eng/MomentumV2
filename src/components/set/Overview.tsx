import {
  Sparkles,
  BookOpen,
  Brain,
  ClipboardCheck,
  Compass,
  Headphones,
  Layers,
  ListChecks,
  MessageCircle,
  ScrollText,
  Zap,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { StudySet } from "@/lib/queries";
import type { setStats } from "@/lib/stats";
import { ProgressBar } from "@/components/ProgressBar";
import { Stat, TopicList } from "./ui";

export type Tab =
  | "overview"
  | "everything"
  | "audio"
  | "search"
  | "notes"
  | "guide"
  | "recall"
  | "flashcards"
  | "quiz"
  | "exam"
  | "tutor"
  | "plan"
  | "materials"
  | "lectures"
  | "mistakes"
  | "ask"
  | "reading";

export function Overview({
  set,
  stats,
  onGo,
}: {
  set: StudySet;
  stats: ReturnType<typeof setStats>;
  onGo: (t: Tab) => void;
}) {
  const quick: { t: Tab; l: string; icon: typeof Zap; primary?: boolean }[] = [
    { t: "everything", l: "Study Everything", icon: Sparkles, primary: true },
    { t: "audio", l: "Audio Study", icon: Headphones, primary: true },
    { t: "flashcards", l: "Study Me", icon: Zap },
    { t: "flashcards", l: "Flashcards", icon: Layers },
    { t: "recall", l: "Active Recall", icon: ListChecks },
    { t: "quiz", l: "Adaptive Quiz", icon: Brain },
    { t: "guide", l: "Study Guide", icon: ScrollText },
    { t: "exam", l: "Practice Exam", icon: ClipboardCheck },
    { t: "tutor", l: "AI Tutor", icon: MessageCircle },
    { t: "ask", l: "Ask Your Materials", icon: BookOpen },
    {
      t: "mistakes",
      l: `Mistake Bank${stats.openMistakes ? ` (${stats.openMistakes})` : ""}`,
      icon: ListChecks,
    },
    { t: "lectures", l: "Record Lecture", icon: Zap },
  ];
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5">
        <div className="relative overflow-hidden rounded-2xl dpanel p-6">
          <p className="eyebrow text-cool2">Test readiness · estimate</p>
          <p className="font-display text-6xl text-mint mt-2">
            {stats.readiness != null ? `${stats.readiness}%` : "—"}
          </p>
          <ProgressBar value={stats.readiness ?? 0} className="h-2 mt-3 max-w-md" />
          <p className="text-sm mt-4 max-w-lg leading-relaxed">{stats.readinessNote}</p>
          <p className="text-[11px] text-soft mt-2">
            Based on your quizzes, practice exams, Active Recall and flashcards. It's a rough guide,
            not a prediction.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {quick.map((q) => (
              <button
                key={q.l}
                onClick={() => onGo(q.t)}
                className={
                  q.primary
                    ? "font-semibold text-sm bg-brand text-ink px-4 py-2 rounded-lg inline-flex items-center gap-2"
                    : "font-semibold text-sm border border-foreground/20 px-3.5 py-2 rounded-lg hover:bg-foreground/5 inline-flex items-center gap-2"
                }
              >
                <q.icon className="size-4" /> {q.l}
              </button>
            ))}
            <Link
              to="/coach"
              search={{ set: set.id }}
              className="font-semibold text-sm border border-cool/40 text-cool2 px-3.5 py-2 rounded-lg hover:bg-cool/10 inline-flex items-center gap-2"
            >
              <Compass className="size-4" /> What should I study now?
            </Link>
            <Link
              to="/exam"
              search={{ include: set.id }}
              className="font-semibold text-sm border border-foreground/20 px-3.5 py-2 rounded-lg hover:bg-foreground/5 inline-flex items-center gap-2"
            >
              <ClipboardCheck className="size-4" /> Comprehensive Exam
            </Link>
          </div>
        </div>
        <div className="rounded-2xl bg-panel border border-line/70 p-5">
          <p className="eyebrow text-soft mb-4">Topics to review</p>
          <TopicList topics={stats.topics} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Flashcards"
          value={String(stats.total)}
          sub={`${stats.due} due today`}
          pct={stats.total ? ((stats.total - stats.due) / stats.total) * 100 : 0}
        />
        <Stat
          label="Mastered"
          value={`${stats.mastered}/${stats.total}`}
          sub={`${stats.reviewed} reviewed · ${stats.learning} learning`}
          pct={stats.masteryPct}
          tone="text-mint"
        />
        <Stat
          label="Quiz average"
          value={stats.quizAvg != null ? `${stats.quizAvg}%` : "—"}
          sub={
            stats.quizCount
              ? `${stats.quizCount} attempt${stats.quizCount === 1 ? "" : "s"} · best ${stats.quizBest}%`
              : "No quizzes yet"
          }
          pct={stats.quizAvg ?? 0}
        />
        <Stat
          label="Practice exam"
          value={stats.examLatest != null ? `${stats.examLatest}%` : "—"}
          sub={
            stats.exams.length
              ? `Latest · best ${stats.examBest}% · ${stats.exams.length} taken`
              : "Not taken yet"
          }
          pct={stats.examLatest ?? 0}
          tone="text-violet"
        />
      </div>

      <button
        onClick={() => onGo("materials")}
        className="w-full text-left rounded-2xl bg-panel border border-line/70 p-5 hover:border-cool/50 transition-colors flex items-start gap-4"
      >
        <BookOpen className="size-5 text-cool2 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="eyebrow text-soft">Study material</p>
          <p className="text-sm mt-1 truncate">
            {set.material_source === "pdf"
              ? set.material_filename || "Uploaded files"
              : "Pasted text"}{" "}
            · {set.material_text.length.toLocaleString()} characters
          </p>
          {set.description && (
            <p className="text-sm text-soft mt-1 line-clamp-2">{set.description}</p>
          )}
        </div>
      </button>
    </div>
  );
}
