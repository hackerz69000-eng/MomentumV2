import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2, Loader2, BookOpen, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { trashSet } from "@/lib/trash";
import { supabase } from "@/integrations/supabase/client";
import { fetchSets, type SetWithCards } from "@/lib/queries";
import { computeProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { DashboardWorkspace } from "@/components/DashboardWorkspace";
import { Levels } from "@/components/Levels";
import { DailyStreak } from "@/components/DailyStreak";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Momentum" },
      { name: "description", content: "Your study sets, flashcard progress and quiz scores." },
      { property: "og:title", content: "Dashboard — Momentum" },
      { property: "og:description", content: "Your Momentum study hub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: sets, isLoading, error } = useQuery({ queryKey: ["sets"], queryFn: fetchSets });
  const all = sets ?? [];
  const totals = all.reduce(
    (acc, s) => {
      const p = computeProgress(s.flashcards, s.quiz_score, s.quiz_total);
      acc.cards += p.total;
      acc.mastered += p.mastered;
      if (p.quizPct != null) {
        acc.quizSum += p.quizPct;
        acc.quizN++;
      }
      return acc;
    },
    { cards: 0, mastered: 0, quizSum: 0, quizN: 0 },
  );
  const cardPct = totals.cards ? Math.round((totals.mastered / totals.cards) * 100) : 0;
  const quizAvg = totals.quizN ? Math.round(totals.quizSum / totals.quizN) : null;
  const cumulativePct = quizAvg == null ? cardPct : Math.round((cardPct + quizAvg) / 2);



  return (
    <main className="flex-1">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 px-5 md:px-8 py-5 bg-ink/90 backdrop-blur-xl border-b border-line">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Your Study Hub</h1>
          <p className="text-sm text-soft">
            {all.length} sets · {totals.mastered}/{totals.cards} cards mastered
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Levels percentage={cumulativePct} />
          <DailyStreak />
          <Link
            to="/sets/new"
            className="hidden sm:inline-block font-semibold text-sm bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-cool2"
          >
            + Create study set
          </Link>
        </div>
      </header>

      {!isLoading && !error && all.length > 0 && <DashboardWorkspace sets={all} />}

      {isLoading ? (
        <div className="grid place-items-center py-24">
          <Loader2 className="size-6 animate-spin text-cool2" />
        </div>
      ) : error ? (
        <div className="m-8 rounded-xl border border-destructive/40 bg-destructive/10 p-5 flex gap-3 text-sm">
          <AlertCircle className="size-5 text-destructive" /> Couldn't load your study sets. Refresh
          to try again.
        </div>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : null}
    </main>
  );
}

const STEPS = [
  { t: "Study material", d: "Upload PDFs, slides or docs, paste notes, or record a lecture." },
  { t: "Understand", d: "AI notes, a study guide, and an AI tutor that only uses your material." },
  { t: "Practice", d: "Flashcards with spaced repetition, quizzes and active recall." },
  { t: "Find weaknesses", d: "Mistake Bank and weak-topic detection show what to fix." },
  { t: "Prepare", d: "Practice exams, test readiness and a day-by-day study plan." },
];

function EmptyState() {
  return (
    <div className="m-5 md:m-8 rounded-xl bg-panel border border-line p-8 md:p-10">
      <div className="text-center">
        <BookOpen className="size-10 mx-auto text-cool2" aria-hidden />
        <h2 className="font-display text-3xl font-bold mt-4">Welcome to Momentum</h2>
        <p className="text-soft text-sm mt-2 max-w-md mx-auto">
          Create one study set from your course material and Momentum builds a complete study system
          around it.
        </p>
      </div>
      <ol className="mt-8 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STEPS.map((s, i) => (
          <li key={s.t} className="rounded-lg bg-accent border border-line p-4">
            <span className="font-display text-cool2 text-lg">{i + 1}</span>
            <p className="font-semibold text-sm mt-1">{s.t}</p>
            <p className="text-xs text-soft mt-1 leading-relaxed">{s.d}</p>
          </li>
        ))}
      </ol>
      <div className="text-center">
        <Link
          to="/sets/new"
          className="inline-block mt-8 font-semibold text-sm bg-brand text-ink px-5 py-3 rounded-lg"
        >
          + Create your first study set
        </Link>
        <p className="text-xs text-soft mt-3">
          Takes about a minute. You can add more files later.
        </p>
      </div>
    </div>
  );
}

function SetCard({ set }: { set: SetWithCards }) {
  const qc = useQueryClient();
  const p = computeProgress(set.flashcards, set.quiz_score, set.quiz_total);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(set.name);

  const rename = async () => {
    if (!name.trim()) return;
    const { error } = await supabase
      .from("study_sets")
      .update({ name: name.trim() })
      .eq("id", set.id);
    if (error) {
      toast.error("Rename failed");
      return;
    }
    setRenaming(false);
    qc.invalidateQueries({ queryKey: ["sets"] });
    qc.invalidateQueries({ queryKey: ["set", set.id] });
  };
  const remove = async () => {
    try {
      await trashSet(set.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      return;
    }
    toast.success("Moved to Recently Deleted — you can restore it for 30 days");
    qc.invalidateQueries({ queryKey: ["sets"] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.removeQueries({ queryKey: ["set", set.id] });
    qc.removeQueries({ queryKey: ["cards", set.id] });
  };

  return (
    <div className="group rounded-xl p-5 bg-panel border border-line relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-cool/50 hover:shadow-xl animate-in fade-in slide-in-from-bottom-2">
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 eyebrow tracking-wider">
          <span className="px-2 py-0.5 rounded bg-cool/20 text-cool2 truncate max-w-[150px]">
            {set.subject || "General"}
          </span>
          {set.status === "processing" && (
            <span className="text-cool2 flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Processing
            </span>
          )}
          {set.status === "error" && <span className="text-destructive">Error</span>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-1 rounded text-soft hover:text-foreground hover:bg-foreground/5"
            aria-label="Set options"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Link to="/sets/$id" params={{ id: set.id }} className="relative block">
        <h4 className="font-display text-xl font-bold mt-3 line-clamp-2">{set.name}</h4>
        <p className="text-xs text-soft mt-1 line-clamp-2 min-h-[2rem]">
          {set.description || "No description"}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-soft">
            {p.total} cards · Quiz {p.quizPct != null ? `${p.quizPct}%` : "—"}
          </span>
          <span className="font-display text-mint">{p.overall}%</span>
        </div>
        <ProgressBar value={p.overall} className="mt-2" />
      </Link>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename study set</DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rename()}
          />
          <DialogFooter>
            <button
              onClick={rename}
              className="font-semibold text-sm bg-brand text-ink px-4 py-2 rounded-lg"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{set.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It moves to Recently Deleted with its notes, flashcards and progress. You can restore
              it for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
