import { useState, useEffect } from "react";
import { CheckCircle2, Circle, Plus, Trash2, Target, Sparkles, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { recordStudySessionCompletion } from "./DailyStreak";

export interface StudyGoal {
  id: string;
  topic: string;
  chapter?: string;
  targetMinutes: number;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

const GOALS_KEY = "momentum_daily_goals";

const INITIAL_GOALS: StudyGoal[] = [
  {
    id: "goal_init_1",
    topic: "Review 20 Essential Flashcards",
    chapter: "Chapter 1",
    targetMinutes: 15,
    completed: true,
    completedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal_init_2",
    topic: "Core Definitions & Key Concepts",
    chapter: "Foundations",
    targetMinutes: 20,
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "goal_init_3",
    topic: "Self-Test Quiz / Practice Questions",
    chapter: "Review Module",
    targetMinutes: 25,
    completed: false,
    createdAt: new Date().toISOString(),
  },
];

export function getDailyGoals(): StudyGoal[] {
  if (typeof window === "undefined") return INITIAL_GOALS;
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (!raw) {
      localStorage.setItem(GOALS_KEY, JSON.stringify(INITIAL_GOALS));
      return INITIAL_GOALS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_GOALS;
  }
}

export function saveDailyGoals(goals: StudyGoal[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  window.dispatchEvent(new CustomEvent("momentum_goals_updated", { detail: goals }));
}

interface DailyStudyGoalsProps {
  className?: string;
  onGoalCompleted?: (goal: StudyGoal) => void;
}

export function DailyStudyGoals({ className = "", onGoalCompleted }: DailyStudyGoalsProps) {
  const [goals, setGoals] = useState<StudyGoal[]>(INITIAL_GOALS);
  const [newTopic, setNewTopic] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [newMinutes, setNewMinutes] = useState("20");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    setGoals(getDailyGoals());

    const handleUpdate = () => {
      setGoals(getDailyGoals());
    };
    window.addEventListener("momentum_goals_updated", handleUpdate);
    return () => window.removeEventListener("momentum_goals_updated", handleUpdate);
  }, []);

  const total = goals.length;
  const completedCount = goals.filter((g) => g.completed).length;
  const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const handleToggle = (id: string) => {
    const nextGoals = goals.map((g) => {
      if (g.id === id) {
        const nextState = !g.completed;
        if (nextState) {
          toast.success(`Goal completed: "${g.topic}"! Streak updated! 🔥`);
          // Record completion to update streak & session history
          recordStudySessionCompletion(g.targetMinutes || 15, `${g.chapter ? g.chapter + ": " : ""}${g.topic}`);
          if (onGoalCompleted) onGoalCompleted(g);
        }
        return {
          ...g,
          completed: nextState,
          completedAt: nextState ? new Date().toISOString() : undefined,
        };
      }
      return g;
    });

    setGoals(nextGoals);
    saveDailyGoals(nextGoals);
  };

  const handleDelete = (id: string) => {
    const nextGoals = goals.filter((g) => g.id !== id);
    setGoals(nextGoals);
    saveDailyGoals(nextGoals);
    toast.info("Study goal removed.");
  };

  const handleAddGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim()) return;

    const newGoal: StudyGoal = {
      id: "goal_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      topic: newTopic.trim(),
      chapter: newChapter.trim() || undefined,
      targetMinutes: parseInt(newMinutes, 10) || 20,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    const nextGoals = [newGoal, ...goals];
    setGoals(nextGoals);
    saveDailyGoals(nextGoals);

    setNewTopic("");
    setNewChapter("");
    setIsAdding(false);
    toast.success("New daily study goal added!");
  };

  return (
    <div className={`rounded-2xl p-5 md:p-6 bg-panel border border-line shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-gradient-to-br from-mint/20 to-cool/20 border border-mint/30 flex items-center justify-center text-mint">
            <Target className="size-4.5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
              Daily Study Goals
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-mint/10 text-mint border border-mint/20">
                {completedCount}/{total} Done
              </span>
            </h3>
            <p className="text-xs text-soft">
              Input specific topics or chapters to cover and mark off your daily progress.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line bg-accent hover:border-cool/40 flex items-center gap-1.5 transition-colors text-foreground"
        >
          <Plus className="size-3.5" /> Add Goal
        </button>
      </div>

      {/* Progress Bar Integration */}
      <div className="mb-5 p-3 rounded-xl bg-foreground/5 border border-line/60">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-soft font-medium flex items-center gap-1">
            <Sparkles className="size-3 text-mint" /> Goal Mastery Rate
          </span>
          <span className="font-display font-bold text-mint">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cool to-mint transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Add Form */}
      {isAdding && (
        <form onSubmit={handleAddGoal} className="mb-4 p-4 rounded-xl bg-accent border border-cool2/40 space-y-3 animate-in fade-in">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-soft mb-1">Topic or Subject</label>
              <input
                type="text"
                required
                placeholder="e.g. Chapter 4: Cellular Respiration"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cool2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-soft mb-1">Chapter / Unit (opt)</label>
                <input
                  type="text"
                  placeholder="e.g. Unit 2"
                  value={newChapter}
                  onChange={(e) => setNewChapter(e.target.value)}
                  className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cool2"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-soft mb-1">Target Time (min)</label>
                <input
                  type="number"
                  min="5"
                  max="180"
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(e.target.value)}
                  className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cool2"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-line text-soft hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-brand text-ink hover:opacity-95"
            >
              Save Goal
            </button>
          </div>
        </form>
      )}

      {/* Goal Items List */}
      <div className="space-y-2">
        {goals.length === 0 ? (
          <div className="text-center py-6 text-soft text-xs border border-dashed border-line rounded-xl">
            No daily goals yet. Click "+ Add Goal" above to schedule topics to cover today.
          </div>
        ) : (
          goals.map((g) => (
            <div
              key={g.id}
              className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                g.completed
                  ? "bg-foreground/5 border-line/40 opacity-75"
                  : "bg-panel border-line hover:border-cool/40 shadow-xs"
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggle(g.id)}
                className="flex items-center gap-3 text-left min-w-0 flex-1 group"
              >
                {g.completed ? (
                  <CheckCircle2 className="size-5 text-mint shrink-0" />
                ) : (
                  <Circle className="size-5 text-soft group-hover:text-cool2 shrink-0 transition-colors" />
                )}
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium leading-snug truncate ${
                      g.completed ? "line-through text-soft" : "text-foreground"
                    }`}
                  >
                    {g.topic}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-soft mt-0.5">
                    {g.chapter && (
                      <span className="flex items-center gap-1 font-semibold text-cool2">
                        <BookOpen className="size-3" /> {g.chapter}
                      </span>
                    )}
                    <span>~{g.targetMinutes} mins</span>
                    {g.completed && <span className="text-mint">✓ Completed</span>}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleDelete(g.id)}
                className="text-soft/60 hover:text-destructive p-1 rounded-md transition-colors"
                title="Delete goal"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
