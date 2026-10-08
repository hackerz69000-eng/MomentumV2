import { useState, useEffect } from "react";
import { Flame, CheckCircle2, Award, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const STREAK_KEY = "momentum_streak_data";
export const STREAK_EVENT = "momentum_streak_updated";

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null; // YYYY-MM-DD
  totalSessionsCompleted: number;
}

export function getStreakData(): StreakData {
  if (typeof window === "undefined") {
    return { currentStreak: 1, longestStreak: 1, lastStudyDate: null, totalSessionsCompleted: 0 };
  }
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) {
      const initial: StreakData = {
        currentStreak: 1,
        longestStreak: 1,
        lastStudyDate: new Date().toISOString().split("T")[0]!,
        totalSessionsCompleted: 1,
      };
      localStorage.setItem(STREAK_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw);
  } catch {
    return { currentStreak: 1, longestStreak: 1, lastStudyDate: null, totalSessionsCompleted: 0 };
  }
}

export function recordStudySessionCompletion(durationMinutes = 15, topicName = "Study Session"): StreakData {
  if (typeof window === "undefined") {
    return { currentStreak: 1, longestStreak: 1, lastStudyDate: null, totalSessionsCompleted: 1 };
  }

  const prev = getStreakData();
  const today = new Date().toISOString().split("T")[0]!;

  let nextStreak = prev.currentStreak;
  let isNewDay = false;

  if (!prev.lastStudyDate) {
    nextStreak = 1;
    isNewDay = true;
  } else if (prev.lastStudyDate === today) {
    // Already studied today; streak holds, just increase session count
    nextStreak = Math.max(1, prev.currentStreak);
  } else {
    // Check difference in days
    const lastDate = new Date(prev.lastStudyDate);
    const currentDate = new Date(today);
    const diffTime = Math.abs(currentDate.getTime() - lastDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      nextStreak = prev.currentStreak + 1;
      isNewDay = true;
    } else {
      nextStreak = 1;
      isNewDay = true;
    }
  }

  const updated: StreakData = {
    currentStreak: nextStreak,
    longestStreak: Math.max(nextStreak, prev.longestStreak),
    lastStudyDate: today,
    totalSessionsCompleted: prev.totalSessionsCompleted + 1,
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
    currentStreak: 1,
    longestStreak: 1,
    lastStudyDate: null,
    totalSessionsCompleted: 0,
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

  const today = new Date().toISOString().split("T")[0];
  const studiedToday = mounted && data.lastStudyDate === today;

  const handleManualComplete = () => {
    const res = recordStudySessionCompletion(20, "Daily Review Focus");
    setData(res);
    toast.success(`Study session logged! Your streak is now ${res.currentStreak} day${res.currentStreak === 1 ? "" : "s"}! 🔥`);
  };

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
            Consistent daily practice builds compound retention. Complete any study session to extend your streak!
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

          <button
            type="button"
            onClick={handleManualComplete}
            className="w-full mt-5 font-semibold text-xs bg-brand text-ink py-2.5 rounded-xl flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
          >
            <CheckCircle2 className="size-4" />
            Complete Study Session (+1 Streak)
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
