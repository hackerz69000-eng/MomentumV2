import {
  Sparkles,
  BookOpen,
  Brain,
  ClipboardCheck,
  Compass,
  MessageCircle,
  Zap,
  Library,
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
  const pathways: {
    title: string;
    description: string;
    t: Tab;
    action: string;
    icon: typeof Sparkles;
    accent: string;
  }[] = [
    {
      title: "Learn",
      description: "Build understanding with your notes, study guide, lectures and audio.",
      t: "everything",
      action: "Start learning",
      icon: BookOpen,
      accent: "text-cool2",
    },
    {
      title: "Practice",
      description: "Strengthen recall with flashcards, quizzes and practice exams.",
      t: "flashcards",
      action: "Start practicing",
      icon: Brain,
      accent: "text-mint",
    },
    {
      title: "Readings",
      description: "Add course readings and connect them to what your teacher covered.",
      t: "reading",
      action: "Open readings",
      icon: Library,
      accent: "text-violet",
    },
    {
      title: "Ask & explore",
      description: "Ask questions about your materials or get help from your AI tutor.",
      t: "tutor",
      action: "Ask a question",
      icon: MessageCircle,
      accent: "text-cool2",
    },
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

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow text-cool2">Your workspace</p>
            <h2 className="font-display text-xl uppercase mt-1">What do you want to do?</h2>
          </div>
          <p className="text-xs text-soft hidden sm:block">All tools are organized in the tabs above.</p>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {pathways.map((pathway) => (
            <div
              key={pathway.title}
              className="rounded-2xl bg-panel border border-line/70 p-4 flex flex-col min-h-40 hover:border-cool/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-xl bg-foreground/5 grid place-items-center">
                  <pathway.icon className={`size-4 ${pathway.accent}`} />
                </div>
                <h3 className="font-semibold">{pathway.title}</h3>
              </div>
              <p className="text-sm text-soft leading-relaxed mt-3 flex-1">{pathway.description}</p>
              <button
                onClick={() => onGo(pathway.t)}
                className="mt-4 w-full rounded-lg border border-foreground/15 px-3 py-2 text-sm font-semibold hover:bg-foreground/5 inline-flex items-center justify-center gap-2"
              >
                {pathway.action} <Zap className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

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
