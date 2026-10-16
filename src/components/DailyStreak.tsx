import { useState, useEffect } from "react";
import { Flame, CheckCircle2, Award, Calendar } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getFreezes, useFreeze } from "@/lib/gamification";

const STREAK_KEY = "momentum_streak_data";

function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const STREAK_EVENT = "momentum_streak_updated";

const ACTIVITY_TASKS = [
  { id: "quiz", label: "Finish a quiz" },
  { id: "flashcards", label: "Review flashcards" },
  { id: "recall", label: "Complete active recall" },
  { id: "focus", label: "Finish a focus timer" },
] as const;

function getDailyTasks(day: string) {
  // Rotate the required pair by local calendar day so the challenge changes daily.
  const epochDay = Math.floor(new Date(`${day}T12:00:00`).getTime() / 86400000);
  const pairs = [["quiz", "flashcards"], ["recall", "focus"], ["quiz", "recall"], ["flashcards", "focus"], ["quiz", "focus"], ["flashcards", "recall"]];
  const pair = pairs[((epochDay % pairs.length) + pairs.length) % pairs.length]!;
  return ACTIVITY_TASKS.filter((task) => pair.includes(task.id));
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null; // YYYY-MM-DD
  totalSessionsCompleted: number;
  totalStudyMinutes: number;
  todayActivities?: string[];
  activityDate?: string | null;
}

export function getStreakData(): StreakData {
  if (typeof window === "undefined") {
    return { currentStreak: 0, longestStreak: 0, lastStudyDate: null, totalSessionsCompleted: 0, totalStudyMinutes: 0, todayActivities: [] };
  }
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) {
      const initial: StreakData = {
        currentStreak: 0,
        longestStreak: 0,
        lastStudyDate: null,
        totalSessionsCompleted: 0,
        totalStudyMinutes: 0,
        todayActivities: [],
        activityDate: null,
      };
      localStorage.setItem(STREAK_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<StreakData>;
    return {
      currentStreak: parsed.currentStreak ?? 0,
      longestStreak: parsed.longestStreak ?? 0,
      lastStudyDate: parsed.lastStudyDate ?? null,
      totalSessionsCompleted: parsed.totalSessionsCompleted ?? 0,
      totalStudyMinutes: parsed.totalStudyMinutes ?? 0,
      todayActivities: parsed.todayActivities ?? [],
      activityDate: parsed.activityDate ?? parsed.lastStudyDate ?? null,
    };
  } catch {
    return { currentStreak: 0, longestStreak: 0, lastStudyDate: null, totalSessionsCompleted: 0, totalStudyMinutes: 0, todayActivities: [] };
  }
}

export function recordStudySessionCompletion(durationMinutes = 15, topicName = "Study Session"): StreakData {
  if (typeof window === "undefined") {
    return { currentStreak: 0, longestStreak: 0, lastStudyDate: null, totalSessionsCompleted: 0, totalStudyMinutes: 0, todayActivities: [] };
  }

  const prev = getStreakData();
  const today = localDayKey();
  const normalizedTopic = topicName.toLowerCase();
  const activity = normalizedTopic.includes("quiz") || normalizedTopic.includes("exam") ? "quiz"
    : normalizedTopic.includes("flashcard") ? "flashcards"
    : normalizedTopic.includes("recall") ? "recall"
    : normalizedTopic.includes("pomodoro") || normalizedTopic.includes("focus") || normalizedTopic.includes("study session") ? "focus"
    : "practice";
  const todayActivities = prev.activityDate === today ? [...new Set([...(prev.todayActivities ?? []), activity])] : [activity];
  // A streak day requires two distinct meaningful study modes. Logging a session is not enough.
  const requiredTasks = getDailyTasks(today).map((task) => task.id);
  const goalMet = requiredTasks.every((task) => todayActivities.includes(task));

  let nextStreak = prev.currentStreak;
  let isNewDay = false;

  if (!goalMet) {
    nextStreak = prev.currentStreak;
  } else if (!prev.lastStudyDate) {
    nextStreak = 1;
    isNewDay = true;
  } else if (prev.lastStudyDate === today) {
    // Already earned today; never increase the streak more than once per calendar day
    nextStreak = Math.max(1, prev.currentStreak);
  } else {
    // Check difference in days
    const lastDate = new Date(prev.lastStudyDate);
    const currentDate = new Date(today);
    const diffTime = currentDate.getTime() - lastDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      nextStreak = prev.currentStreak + 1;
      isNewDay = true;
    } else {
      // Automatically protect a streak when the student has earned a freeze.
      // The missed day is treated as protected, then today's study continues the streak.
      if (getFreezes().available > 0 && useFreeze()) {
        nextStreak = prev.currentStreak + 1;
      } else {
        nextStreak = 1;
      }
      isNewDay = true;
    }
  }

  const updated: StreakData = {
    currentStreak: nextStreak,
    longestStreak: Math.max(nextStreak, prev.longestStreak),
    lastStudyDate: goalMet ? today : prev.lastStudyDate,
    todayActivities,
    activityDate: today,
    totalSessionsCompleted: prev.totalSessionsCompleted + 1,
    totalStudyMinutes: (prev.totalStudyMinutes ?? 0) + Math.max(0, durationMinutes),
  };

  localStorage.setItem(STREAK_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent(STREAK_EVENT, { detail: { streak: updated, isNewDay } }));

  // Also auto-record into Session History
  try {
    const rawHistory = localStorage.getItem("momentum_session_history");
    const history = rawHistory ? JSON.parse(rawHistory) : [];
    history.unshift({
      id: "sess_" + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      duration: `${durationMinutes}m`,
      topic: topicName,
      type: "Focused Review",
    });
    localStorage.setItem("momentum_session_history", JSON.stringify(history.slice(0, 50)));
    window.dispatchEvent(new CustomEvent("momentum_session_history_updated"));
  } catch {
    // ignore
  }

  return updated;
}

interface DailyStreakProps {
  className?: string;
}

export function DailyStreak({ className = "" }: DailyStreakProps) {
  const [data, setData] = useState<StreakData>(() => ({
    currentStreak: 0,
    longestStreak: 0,
    lastStudyDate: null,
    totalSessionsCompleted: 0,
    totalStudyMinutes: 0,
  }));
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setData(getStreakData());
    setMounted(true);

    const handleUpdate = () => {
      setData(getStreakData());
    };

    window.addEventListener(STREAK_EVENT, handleUpdate);
    return () => window.removeEventListener(STREAK_EVENT, handleUpdate);
  }, []);

  const today = localDayKey();
  const studiedToday = mounted && data.lastStudyDate === today;


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/40 hover:scale-[1.02] active:scale-[0.98] transition-all text-left shadow-sm ${className}`}
          title="Click to view Daily Streak details"
        >
          <div className="size-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-md shrink-0">
            <Flame className="size-4 animate-bounce text-yellow-200" />
          </div>

          <div className="pr-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-amber-300">
                {data.currentStreak} Day{data.currentStreak === 1 ? "" : "s"}
              </span>
              <span className="text-[10px] text-soft">Streak</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-soft">
              {studiedToday ? (
                <span className="text-mint font-medium flex items-center gap-0.5">
                  <CheckCircle2 className="size-2.5" /> Active today
                </span>
              ) : (
                <span className="text-amber-400/90 font-medium">Study to keep</span>
              )}
            </div>
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md bg-ink2 border-line text-foreground p-6 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <Flame className="size-5 text-orange-400" />
            Daily Study Streak
          </DialogTitle>
          <p className="text-xs text-soft mt-1">
            Consistent daily practice builds compound retention. Complete two different study activities each day (for example, a quiz plus flashcards). Manual session logs and button clicks never count.
          </p>
        </DialogHeader>

        <div className="mt-4 p-5 rounded-2xl bg-gradient-to-br from-amber-950/40 via-panel to-panel border border-amber-500/30 text-center">
          <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white shadow-xl">
            <Flame className="size-8 text-yellow-100 animate-pulse" />
          </div>
          <h3 className="font-display text-3xl font-bold text-amber-300 mt-3">
            {data.currentStreak} {data.currentStreak === 1 ? "Day" : "Days"} Streak
          </h3>
          <p className="text-xs text-soft mt-1">
            {studiedToday
              ? "You've successfully studied today! Great job maintaining momentum."
              : "Complete a study session today to keep your streak going!"}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2 text-left">
            <div className="p-2.5 rounded-xl bg-foreground/5 border border-line">
              <span className="text-[10px] text-soft block">Longest Record</span>
              <span className="text-sm font-bold text-foreground flex items-center gap-1 mt-0.5">
                <Award className="size-3.5 text-amber-400" /> {data.longestStreak} Days
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-foreground/5 border border-line">
              <span className="text-[10px] text-soft block">Total Sessions</span>
              <span className="text-sm font-bold text-foreground flex items-center gap-1 mt-0.5">
                <Calendar className="size-3.5 text-cool2" /> {data.totalSessionsCompleted} Sessions
              </span>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-line bg-foreground/5 p-3 text-left">
            <p className="text-xs font-semibold">Today's study tasks</p>
            <p className="text-xs text-soft mt-1">Complete two different activity types to earn today's streak credit.</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {getDailyTasks(today).map((task) => {
                const done = (data.todayActivities ?? []).includes(task.id);
                return <div key={task.id} className={`rounded-lg border p-2 text-xs ${done ? "border-emerald-500/40 bg-emerald-500/10" : "border-line bg-panel"}`}><span className="flex items-center gap-1.5">{done ? <CheckCircle2 className="size-3.5 text-mint" /> : <Calendar className="size-3.5 text-soft" />}{task.label}</span></div>;
              })}
            </div>
            <p className="text-[11px] text-soft mt-3">{getDailyTasks(today).every((task) => (data.todayActivities ?? []).includes(task.id)) ? "Daily goal complete — streak credit earned." : `${getDailyTasks(today).filter((task) => (data.todayActivities ?? []).includes(task.id)).length}/2 required tasks completed.`}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
