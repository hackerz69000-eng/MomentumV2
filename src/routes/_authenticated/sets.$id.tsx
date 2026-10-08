import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { toast } from "sonner";
import { trashSet } from "@/lib/trash";
import { ArrowLeft, Loader2, RefreshCw, Send, AlertCircle, MoreHorizontal, Trash2 } from "lucide-react";
import { fetchCards, fetchSet, type StudySet } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { askTutor, processSet } from "@/lib/study.functions";
import { setStats, type Attempt } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { ErrorBox } from "@/components/set/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Overview, type Tab } from "@/components/set/Overview";
import { Notes } from "@/components/set/Notes";
import { Flashcards } from "@/components/set/Flashcards";
import { QuizRunner } from "@/components/set/QuizRunner";
import { Plan } from "@/components/set/Plan";
import { ActiveRecall } from "@/components/set/ActiveRecall";
import { StudyGuide } from "@/components/set/StudyGuide";
import { StudyEverything } from "@/components/set/StudyEverything";
import { Search } from "@/components/set/Search";
import { Materials } from "@/components/set/Materials";
import { Lecture } from "@/components/set/Lecture";
import { MistakeBank } from "@/components/set/MistakeBank";
import { AskMaterials } from "@/components/set/AskMaterials";
import { AudioStudy } from "@/components/set/AudioStudy";
import { fetchMistakes } from "@/lib/mistakes";
import { Levels } from "@/components/Levels";
import { DailyStreak } from "@/components/DailyStreak";

const TABS = [
  "overview", "everything", "audio", "search", "ask", "mistakes", "lectures",
  "notes", "guide", "flashcards", "recall", "quiz", "exam", "tutor", "plan", "materials",
] as const satisfies readonly Tab[];

const LABELS: Record<Tab, string> = {
  overview: "Overview", everything: "Study Everything", audio: "Audio Study", search: "Search",
  ask: "Ask Your Materials", mistakes: "Mistake Bank", lectures: "Lectures", notes: "Notes",
  guide: "Study Guide", recall: "Active Recall", flashcards: "Flashcards", quiz: "Quiz",
  exam: "Practice Exam", tutor: "AI Tutor", plan: "Study Plan", materials: "Materials",
};

const MAIN_NAV: { tab: Tab; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "everything", label: "Study" },
  { tab: "flashcards", label: "Practice" },
  { tab: "mistakes", label: "Review" },
  { tab: "plan", label: "Plan" },
  { tab: "materials", label: "Materials" },
];

const MORE_NAV: Tab[] = [
  "audio", "notes", "guide", "recall", "quiz", "exam", "tutor", "ask", "search", "lectures",
];

export const Route = createFileRoute("/_authenticated/sets/$id")({
  ssr: false,
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Study set — Momentum" },
      { name: "description", content: "Notes, flashcards, quiz and AI tutor for your study set." },
      { property: "og:title", content: "Study set — Momentum" },
      {
        property: "og:description",
        content: "Study with AI notes, flashcards, quizzes and a tutor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPage,
});

const btnPrimary =
  "font-semibold text-sm bg-brand text-ink px-4 py-2 rounded-lg disabled:opacity-60 inline-flex items-center gap-2";
const btnGhost =
  "font-semibold text-sm border border-foreground/20 px-4 py-2 rounded-lg hover:bg-foreground/5 disabled:opacity-60 inline-flex items-center gap-2";

function SetPage() {
  const { id } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setQ = useQuery({ queryKey: ["set", id], queryFn: () => fetchSet(id), retry: 1 });
  const cardsQ = useQuery({ queryKey: ["cards", id], queryFn: () => fetchCards(id) });
  const attemptsQ = useQuery({
    queryKey: ["attempts", id],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("set_id", id)
          .order("created_at");
        if (error) return [];
        return (data ?? []) as Attempt[];
      } catch {
        return [];
      }
    },
  });

  const mistakesQ = useQuery({ queryKey: ["mistakes", id], queryFn: () => fetchMistakes(id) });

  const deleteStudySet = async () => {
    setDeleting(true);
    try {
      await trashSet(id);
      localStorage.removeItem("momentum_active_study_set");
      toast.success("Study set moved to Recently Deleted");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sets"] }),
        qc.invalidateQueries({ queryKey: ["trash"] }),
      ]);
      qc.removeQueries({ queryKey: ["set", id] });
      qc.removeQueries({ queryKey: ["cards", id] });
      await navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the study set");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };


  if (setQ.isLoading)
    return (
      <div className="grid place-items-center py-32">
        <Loader2 className="size-6 animate-spin text-cool2" />
      </div>
    );
  if (setQ.error || !setQ.data)
    return (
      <div className="p-8">
        <ErrorBox msg="This study set couldn't be found." />
        <Link to="/dashboard" className={btnGhost + " mt-4"}>
          Back to dashboard
        </Link>
      </div>
    );
  const set = setQ.data;
  const cards = cardsQ.data ?? [];
  const attempts = attemptsQ.data ?? [];
  const mistakes = mistakesQ.data ?? [];
  const stats = setStats(cards, attempts, mistakes);

  return (
    <main className="flex-1 min-w-0">
      <header className="px-5 md:px-8 pt-6 pb-0 border-b border-line/60 bg-ink/60 backdrop-blur-xl sticky top-0 md:top-0 z-20">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              to="/dashboard"
              className="text-xs text-soft hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" /> Dashboard
            </Link>
            <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide truncate mt-1">
              {set.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 mt-4 shrink-0">
            <Levels percentage={stats.readiness} />
            <DailyStreak />
            <span className="eyebrow text-cool2 hidden sm:inline-block">{set.subject || "General"}</span>
          </div>
        </div>
        <nav className="flex items-center gap-1 mt-4 pb-3 overflow-x-auto" aria-label="Study set navigation">
          {MAIN_NAV.map((item) => (
            <button key={item.tab} onClick={() => { setMoreOpen(false); navigate({ search: { tab: item.tab }, replace: true }); }} className={cn(
              "px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap border transition-colors",
              tab === item.tab ? "bg-cool/20 text-foreground border-cool/30" : "text-soft border-transparent hover:text-foreground hover:bg-foreground/5",
            )}>{item.label}</button>
          ))}
          <div className="relative shrink-0">
            <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className={cn(
              "px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap border inline-flex items-center gap-2 transition-colors",
              MORE_NAV.includes(tab) ? "bg-cool/20 text-foreground border-cool/30" : "text-soft border-transparent hover:text-foreground hover:bg-foreground/5",
            )}><MoreHorizontal className="size-4" /> More</button>
            {moreOpen && <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-xl border border-line bg-panel p-2 shadow-2xl">
              <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-soft">More study tools</p>
              <div className="grid grid-cols-2 gap-1">
                {MORE_NAV.map((t) => <button key={t} onClick={() => { setMoreOpen(false); navigate({ search: { tab: t }, replace: true }); }} className={cn(
                  "rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-foreground/5",
                  tab === t ? "bg-cool/15 text-cool2" : "text-soft hover:text-foreground",
                  t === "tutor" && "text-mint",
                )}>{LABELS[t]}</button>)}
              </div>
            </div>}
          </div>
        </nav>
      </header>
      <div className="p-5 md:p-8">
        {set.status !== "ready" && tab !== "materials" && tab !== "lectures" ? (
          <Processing set={set} />
        ) : (
          <div key={tab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
            {tab === "overview" && (
              <Overview set={set} stats={stats} onGo={(t) => navigate({ search: { tab: t } })} />
            )}
            {tab === "notes" && <Notes set={set} />}
            {tab === "flashcards" && <Flashcards setId={set.id} cards={cards} />}
            {tab === "quiz" && (
              <QuizRunner
                key="quiz"
                set={set}
                kind="quiz"
                attempts={attempts}
                topics={stats.topics}
              />
            )}
            {tab === "exam" && <QuizRunner key="exam" set={set} kind="exam" attempts={attempts} />}
            {tab === "everything" && (
              <StudyEverything
                set={set}
                stats={stats}
                mistakes={mistakes}
                cards={cards}
                attempts={attempts}
                onOpenGuide={() => navigate({ search: { tab: "guide" } })}
              />
            )}
            {tab === "audio" && <AudioStudy set={set} topics={stats.topics} />}
            {tab === "search" && <Search set={set} />}
            {tab === "guide" && <StudyGuide set={set} />}
            {tab === "recall" && <ActiveRecall setId={set.id} topics={stats.topics} />}
            {tab === "plan" && <Plan set={set} weakTopics={stats.weak.map((t) => t.topic)} />}
            {tab === "tutor" && <Tutor set={set} />}
            {tab === "materials" && <Materials set={set} />}
            {tab === "lectures" && <Lecture set={set} attempts={attempts} topics={stats.topics} />}
            {tab === "mistakes" && <MistakeBank setId={set.id} mistakes={mistakes} />}
            {tab === "ask" && <AskMaterials set={set} />}
          </div>
        )}
      </div>

      <section className="mx-5 md:mx-8 mb-10 rounded-2xl border border-destructive/25 bg-destructive/5 p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="eyebrow text-destructive">Danger zone</p>
            <h2 className="font-display text-lg font-bold mt-1">Delete this study set</h2>
            <p className="text-sm text-soft mt-1 max-w-2xl">Move this entire study set to Recently Deleted. You can restore it for 30 days, including its cards, notes, files, lectures and study history.</p>
          </div>
          <button type="button" onClick={() => setDeleteOpen(true)} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 text-destructive px-4 py-2.5 text-sm font-semibold hover:bg-destructive/10">
            <Trash2 className="size-4" /> Delete study set
          </button>
        </div>
      </section>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete “{set.name}”?</AlertDialogTitle><AlertDialogDescription>This will move the entire study set to Recently Deleted for 30 days. You can restore it during that time.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={deleteStudySet} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}Delete study set</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Processing({ set }: { set: StudySet }) {
  const qc = useQueryClient();
  const process = useServerFn(processSet);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (set.status !== "processing") return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ["set", set.id] }), 4000);
    return () => clearInterval(t);
  }, [set.status, set.id, qc]);
  const retry = async () => {
    setBusy(true);
    try {
      await process({ data: { setId: set.id } });
      toast.success("Study set ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["set", set.id] });
    qc.invalidateQueries({ queryKey: ["cards", set.id] });
    qc.invalidateQueries({ queryKey: ["sets"] });
  };
  if (set.status === "processing" && !busy)
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">Generating your study resources</h2>
        <p className="text-soft text-sm mt-2">
          Notes and flashcards are being written. This page updates automatically.
        </p>
        <button onClick={retry} className={btnGhost + " mt-6"}>
          <RefreshCw className="size-4" /> Taking too long? Restart
        </button>
      </div>
    );
  return (
    <div className="rounded-2xl bg-panel border border-line/70 p-8 max-w-xl mx-auto text-center">
      {busy ? (
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
      ) : (
        <AlertCircle className="size-8 text-destructive mx-auto" />
      )}
      <h2 className="font-display text-2xl uppercase mt-4">
        {busy ? "Generating…" : "Generation failed"}
      </h2>
      {!busy && <p className="text-soft text-sm mt-2">{set.error || "Something went wrong."}</p>}
      <button disabled={busy} onClick={retry} className={btnPrimary + " mt-6"}>
        <RefreshCw className="size-4" /> Try again
      </button>
    </div>
  );
}

type Msg = { role: "user" | "assistant"; content: string };

function Tutor({ set }: { set: StudySet }) {
  const ask = useServerFn(askTutor);
  const qc = useQueryClient();
  const historyQ = useQuery({
    queryKey: ["tutor", set.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tutor_messages")
        .select("role, content")
        .eq("set_id", set.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });
  const [pending, setPending] = useState<string | null>(null);
  const messages: Msg[] = [
    ...(historyQ.data ?? []),
    ...(pending ? [{ role: "user" as const, content: pending }] : []),
  ];
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setPending(content);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      await ask({ data: { setId: set.id, content } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The tutor couldn't respond");
    }
    await qc.invalidateQueries({ queryKey: ["tutor", set.id] });
    setPending(null);
    setLoading(false);
  };

  const clear = async () => {
    const { error } = await supabase.from("tutor_messages").delete().eq("set_id", set.id);
    if (error) toast.error("Couldn't clear conversation");
    qc.invalidateQueries({ queryKey: ["tutor", set.id] });
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-15rem)] min-h-[420px] rounded-2xl bg-panel border border-line/70 overflow-hidden">
      {messages.length > 0 && (
        <div className="flex justify-between items-center px-5 py-2 border-b border-line/60">
          <span className="eyebrow text-soft">Saved conversation</span>
          <button
            onClick={clear}
            disabled={loading}
            className="text-xs text-soft hover:text-foreground"
          >
            Clear chat
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {historyQ.isLoading && (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-cool2" />
          </div>
        )}
        {!historyQ.isLoading && messages.length === 0 && (
          <div className="text-center py-10">
            <div className="size-12 rounded-xl bg-brand grid place-items-center font-display text-ink text-xl mx-auto">
              M
            </div>
            <h2 className="font-display text-2xl uppercase mt-4">Ask your tutor</h2>
            <p className="text-soft text-sm mt-1">
              Questions are answered using your {set.name} material.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {[
                "Summarize the main ideas",
                "Explain the hardest concept simply",
                "Give me a practice question",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs border border-line/70 rounded-full px-3 py-1.5 text-soft hover:text-foreground hover:border-cool/50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-cool text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="size-7 shrink-0 rounded-md bg-brand grid place-items-center font-display text-ink text-sm">
                M
              </div>
              <div className="md text-sm min-w-0 flex-1">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ),
        )}
        {loading && (
          <div className="flex gap-3 items-center text-soft text-sm">
            <div className="size-7 rounded-md bg-brand grid place-items-center font-display text-ink text-sm">
              M
            </div>
            <Loader2 className="size-4 animate-spin" /> Thinking…
          </div>
        )}
        {error && <ErrorBox msg={error} />}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-line/60 p-3 flex gap-2 bg-ink2/60"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask about your material…"
          className="flex-1 resize-none bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60"
        />
        <button
          disabled={loading || !input.trim()}
          className="bg-brand text-ink rounded-lg px-4 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
