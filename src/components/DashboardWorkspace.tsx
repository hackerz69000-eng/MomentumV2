import { Link } from "@tanstack/react-router";
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

export function DashboardWorkspace({ sets }: { sets: SetWithCards[] }) {
  return (
    <section className="px-5 md:px-8 pt-6">
      <Tabs defaultValue="today" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-panel border border-line p-1">
          <TabsTrigger value="today" className="gap-2"><Home className="size-4" />Today</TabsTrigger>
          <TabsTrigger value="plan" className="gap-2"><CalendarDays className="size-4" />Plan</TabsTrigger>
          <TabsTrigger value="understand" className="gap-2"><Brain className="size-4" />Understand</TabsTrigger>
          <TabsTrigger value="progress" className="gap-2"><Gauge className="size-4" />Progress</TabsTrigger>
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

        <TabsContent value="practice" className="space-y-6 mt-6">
          <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
            <div className="flex items-center gap-3"><LibraryBig className="size-5 text-cool2" /><div><p className="eyebrow text-cool2">Practice</p><h2 className="font-display text-xl font-bold">Your study sets</h2><p className="text-sm text-soft mt-1">Open a set to use flashcards, active recall, adaptive quizzes, exams, the tutor and Mistake Bank.</p></div></div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-5">{sets.map((s) => <Link key={s.id} to="/sets/$id" params={{ id: s.id }} className="rounded-xl border border-line bg-accent p-4 hover:border-cool/50"><p className="font-semibold truncate">{s.name}</p><p className="text-xs text-soft mt-1">{s.subject || "Study set"}</p><p className="text-xs text-cool2 mt-3">Open study set →</p></Link>)}</div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
