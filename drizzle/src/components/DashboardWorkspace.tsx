import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trashSet } from "@/lib/trash";
import { MoveStudySetDialog } from "@/components/MoveStudySetDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SetWithCards } from "@/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, CalendarDays, Gauge, Home, LibraryBig, Sparkles } from "lucide-react";
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
import { StudyFolderManager } from "@/components/StudyFolderManager";

export function DashboardWorkspace({ sets }: { sets: SetWithCards[] }) {
  const [folderId, setFolderId] = useState<string | null>("__all__");
  const filteredSets = folderId === "__all__" ? sets : sets.filter((s) => (s.folder_id ?? null) === folderId);

  return (
    <section className="px-5 md:px-8 pt-6">
      <Tabs defaultValue="today" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-panel border border-line p-1">
          <TabsTrigger value="today" className="gap-2"><Home className="size-4" />Today</TabsTrigger>
          <TabsTrigger value="plan" className="gap-2"><CalendarDays className="size-4" />Plan</TabsTrigger>
          <TabsTrigger value="understand" className="gap-2"><Brain className="size-4" />Understand</TabsTrigger>
          <TabsTrigger value="progress" className="gap-2"><Gauge className="size-4" />Progress</TabsTrigger>
          <TabsTrigger value="study-sets" className="gap-2"><LibraryBig className="size-4" />Study Sets</TabsTrigger>
          <TabsTrigger value="practice" className="gap-2"><Sparkles className="size-4" />Practice</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-6 mt-6">
          <CommandCenter sets={sets} />
          <div className="grid lg:grid-cols-2 gap-6"><DailyStudyGoals /><PomodoroTimer /></div>
        </TabsContent>

        <TabsContent value="plan" className="space-y-6 mt-6">
          <AIStudyPlan sets={sets} />
          <StudyCommandSuite sets={sets} />
        </TabsContent>

        <TabsContent value="understand" className="space-y-6 mt-6">
          <ConceptConnections sets={sets} />
        </TabsContent>

        <TabsContent value="progress" className="space-y-6 mt-6">
          <ProgressionHub />
          <div className="grid lg:grid-cols-2 gap-6"><StudyAnalytics /><SessionHistory /></div>
          <SessionRecap />
          <MilestoneRewards />
          <StreakCard />
        </TabsContent>

        <TabsContent value="study-sets" className="space-y-6 mt-6">
          <StudyFolderManager selectedId={folderId} onSelect={setFolderId} />
          <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <div className="flex items-center gap-3"><LibraryBig className="size-5 text-cool2" /><div><p className="eyebrow text-cool2">Study Sets</p><h2 className="font-display text-xl font-bold">Your study sets</h2><p className="text-sm text-soft mt-1">Organize sets into folders and open any set to study.</p></div></div>
            <StudySetCards sets={filteredSets} />
          </div>
        </TabsContent>

        <TabsContent value="practice" className="space-y-6 mt-6">
          <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <div className="flex items-center gap-3"><LibraryBig className="size-5 text-cool2" /><div><p className="eyebrow text-cool2">Practice</p><h2 className="font-display text-xl font-bold">Your study sets</h2><p className="text-sm text-soft mt-1">Open a set to use flashcards, active recall, adaptive quizzes, exams, the tutor and Mistake Bank.</p></div></div>
            <StudySetCards sets={sets} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}


function StudySetCards({ sets }: { sets: SetWithCards[] }) {
  const qc = useQueryClient();
  const [moving, setMoving] = useState<SetWithCards | null>(null);
  const [deleting, setDeleting] = useState<SetWithCards | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await trashSet(deleting.id);
      toast.success("Moved to Recently Deleted — you can restore it for 30 days");
      qc.invalidateQueries({ queryKey: ["sets"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.removeQueries({ queryKey: ["set", deleting.id] });
      qc.removeQueries({ queryKey: ["cards", deleting.id] });
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return <>
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-5">
      {sets.map((s) => <div key={s.id} className="rounded-xl border border-line bg-accent p-4 hover:border-cool/50">
        <div className="flex items-start justify-between gap-2">
          <Link to="/sets/$id" params={{ id: s.id }} className="min-w-0 flex-1">
            <p className="font-semibold truncate">{s.name}</p>
            <p className="text-xs text-soft mt-1">{s.subject || "Study set"}</p>
            <p className="text-xs text-cool2 mt-3">Open study set →</p>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="p-1.5 rounded-lg text-soft hover:text-foreground hover:bg-foreground/5" aria-label={`Options for ${s.name}`} title="Study set options">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setMoving(s)}>Move to folder</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(s)}><Trash2 className="size-4" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>)}
    </div>

    {moving && <MoveStudySetDialog setId={moving.id} setName={moving.name} currentFolderId={moving.folder_id} open={!!moving} onOpenChange={(open) => !open && setMoving(null)} onMoved={() => { setMoving(null); qc.invalidateQueries({ queryKey: ["sets"] }); }} />}

    <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle><AlertDialogDescription>It moves to Recently Deleted for 30 days. You can restore the study set and its notes, cards, progress and materials.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"><Trash2 className="size-4 mr-2" />Delete</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
