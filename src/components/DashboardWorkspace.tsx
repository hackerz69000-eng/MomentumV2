import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Trash2, Check, LibraryBig, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { trashSet } from "@/lib/trash";
import type { SetWithCards } from "@/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, CalendarDays, Gauge, Home, Sparkles } from "lucide-react";
import { DailyStudyGoals } from "@/components/DailyStudyGoals";
import { PomodoroTimer } from "@/components/PomodoroTimer";
import { CommandCenter } from "@/components/CommandCenter";
import { StudyCommandSuite } from "@/components/StudyCommandSuite";
import { ProgressionHub } from "@/components/ProgressionHub";
import { StudyAnalytics } from "@/components/StudyAnalytics";
import { MilestoneRewards } from "@/components/MilestoneRewards";
import { SessionHistory } from "@/components/SessionHistory";
import { SessionRecap } from "@/components/SessionRecap";
import { StreakCard } from "@/components/StreakCard";
import { AIStudyPlan } from "@/components/AIStudyPlan";
import { ConceptConnections } from "@/components/ConceptConnections";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StudyFolderManager } from "@/components/StudyFolderManager";

export function DashboardWorkspace({ sets }: { sets: SetWithCards[] }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return sets[0]?.id ?? "";
    return localStorage.getItem("momentum_active_study_set") || sets[0]?.id || "";
  });
  const [confirmDelete, setConfirmDelete] = useState<SetWithCards | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>("__all__");
  const active = useMemo(() => sets.find((s) => s.id === activeId) ?? sets[0] ?? null, [sets, activeId]);
  const activeSets = active ? [active] : [];

  useEffect(() => {
    if (!active) return;
    if (active.id !== activeId) setActiveId(active.id);
    localStorage.setItem("momentum_active_study_set", active.id);
  }, [active, activeId]);

  const selectSet = (id: string) => {
    setActiveId(id);
    localStorage.setItem("momentum_active_study_set", id);
  };

  const removeSet = async () => {
    if (!confirmDelete) return;
    const deletingId = confirmDelete.id;
    try {
      await trashSet(deletingId);
      const remaining = sets.filter((s) => s.id !== deletingId);
      const next = remaining[0]?.id ?? "";
      if (next) localStorage.setItem("momentum_active_study_set", next);
      else localStorage.removeItem("momentum_active_study_set");
      setActiveId(next);
      toast.success("Study set moved to Recently Deleted");
      qc.invalidateQueries({ queryKey: ["sets"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.removeQueries({ queryKey: ["set", deletingId] });
      qc.removeQueries({ queryKey: ["cards", deletingId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the study set");
    } finally {
      setConfirmDelete(null);
    }
  };

  if (!active) return null;

  return (
    <section className="px-5 md:px-8 pt-6">
      <div className="mb-4 rounded-2xl border border-line bg-panel p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-cool2">Current study set</p>
          <div className="flex items-center gap-2 mt-1 min-w-0">
            <h2 className="font-display text-xl font-bold truncate">{active.name}</h2>
            <span className="text-xs text-soft shrink-0">{active.subject || "General"}</span>
          </div>
          <p className="text-xs text-soft mt-1">Your Study Hub is currently personalized to this set.</p>
        </div>
        <Link to="/sets/$id" params={{ id: active.id }} className="shrink-0 inline-flex items-center gap-2 text-sm font-semibold text-cool2 hover:text-foreground">
          Open full study set <ArrowRight className="size-4" />
        </Link>
      </div>

      <Tabs defaultValue="today" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-panel border border-line p-1">
          <TabsTrigger value="today" className="gap-2"><Home className="size-4" />Today</TabsTrigger>
          <TabsTrigger value="plan" className="gap-2"><CalendarDays className="size-4" />Plan</TabsTrigger>
          <TabsTrigger value="understand" className="gap-2"><Brain className="size-4" />Understand</TabsTrigger>
          <TabsTrigger value="progress" className="gap-2"><Gauge className="size-4" />Progress</TabsTrigger>
          <TabsTrigger value="practice" className="gap-2"><Sparkles className="size-4" />Practice</TabsTrigger>
          <TabsTrigger value="sets" className="gap-2"><LibraryBig className="size-4" />Study Sets</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-6 mt-6">
          <CommandCenter sets={activeSets} />
          <div className="grid lg:grid-cols-2 gap-6"><DailyStudyGoals /><PomodoroTimer setId={active.id} topicName={active.name} /></div>
        </TabsContent>

        <TabsContent value="plan" className="space-y-6 mt-6">
          <AIStudyPlan sets={activeSets} />
          <StudyCommandSuite sets={activeSets} />
        </TabsContent>

        <TabsContent value="understand" className="space-y-6 mt-6">
          <ConceptConnections sets={activeSets} />
        </TabsContent>

        <TabsContent value="progress" className="space-y-6 mt-6">
          <ProgressionHub setId={active.id} />
          <div className="grid lg:grid-cols-2 gap-6"><StudyAnalytics setId={active.id} /><SessionHistory setId={active.id} /></div>
          <SessionRecap setId={active.id} />
          <MilestoneRewards />
          <StreakCard />
        </TabsContent>

        <TabsContent value="practice" className="space-y-6 mt-6">
          <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <p className="eyebrow text-cool2">Practice</p>
            <h2 className="font-display text-xl font-bold mt-1">Practice {active.name}</h2>
            <p className="text-sm text-soft mt-1">Every practice tool below is scoped to your current study set.</p>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
              {[['everything','Study Everything'],['flashcards','Flashcards'],['quiz','Adaptive Quiz'],['exam','Practice Exam']].map(([tab,label]) => (
                <Link key={tab} to="/sets/$id" params={{ id: active.id }} search={{ tab: tab as "everything" | "flashcards" | "quiz" | "exam" }} className="rounded-xl border border-line bg-accent p-4 hover:border-cool/50 transition-colors">
                  <p className="font-semibold">{label}</p><p className="text-xs text-cool2 mt-3">Open →</p>
                </Link>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sets" className="space-y-6 mt-6">
          <StudyFolderManager selectedId={folderFilter} onSelect={setFolderFilter} />
          <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="eyebrow text-cool2">Study Sets</p><h2 className="font-display text-xl font-bold mt-1">All your study sets</h2><p className="text-sm text-soft mt-1">Choose the set you want Momentum to focus on. Your last choice is remembered.</p></div>
              <span className="text-xs text-soft shrink-0">{sets.filter((s) => folderFilter === "__all__" ? true : folderFilter ? s.folder_id === folderFilter : s.folder_id == null).length} shown</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-5">
              {sets.filter((s) => folderFilter === "__all__" ? true : folderFilter ? s.folder_id === folderFilter : s.folder_id == null).map((s) => {
                const selected = s.id === active.id;
                return <div key={s.id} className={`rounded-xl border p-4 transition-colors ${selected ? 'border-cool2/60 bg-cool/10' : 'border-line bg-accent hover:border-cool/40'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => selectSet(s.id)} className="min-w-0 text-left flex-1">
                      <div className="flex items-center gap-2"><p className="font-semibold truncate">{s.name}</p>{selected && <Check className="size-4 text-mint shrink-0" />}</div>
                      <p className="text-xs text-soft mt-1">{s.subject || 'General'} · {s.flashcards.length} cards</p>
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(s)} className="p-1.5 rounded-lg text-soft hover:text-destructive hover:bg-destructive/10" aria-label={`Options for ${s.name}`} title="Study set options"><MoreHorizontal className="size-4" /></button>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <button type="button" onClick={() => selectSet(s.id)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${selected ? 'bg-brand text-ink' : 'bg-foreground/5 hover:bg-foreground/10'}`}>{selected ? 'Selected' : 'Use this set'}</button>
                    <Link to="/sets/$id" params={{ id: s.id }} className="text-xs font-semibold text-cool2 hover:underline">Open set</Link>
                  </div>
                </div>;
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this study set?</AlertDialogTitle><AlertDialogDescription>“{confirmDelete?.name}” will move to Recently Deleted for 30 days. Its notes, cards, files, lectures, mistakes and study history will be restorable.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={removeSet} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"><Trash2 className="size-4 mr-2" />Delete study set</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
