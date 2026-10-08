import { useState, useEffect } from "react";
import { History, Clock, BookOpen, Sparkles, Plus, Calendar, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { recordStudySessionCompletion } from "./DailyStreak";

export interface StudySessionRecord {
  id: string;
  timestamp: string; // ISO string
  duration: string; // e.g. "25 mins" or "15m"
  topic: string;
  type: string; // e.g. "20 Flashcards Run", "Quiz Session", "Focused Reading"
  notes?: string;
}

const HISTORY_KEY = "momentum_session_history";
const HISTORY_EVENT = "momentum_session_history_updated";

const DEFAULT_SESSIONS: StudySessionRecord[] = [
  {
    id: "sess_demo_1",
    timestamp: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
    duration: "25m",
    topic: "20 Core Flashcards & Key Terms",
    type: "Flashcards",
  },
  {
    id: "sess_demo_2",
    timestamp: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    duration: "30m",
    topic: "Foundational Definitions & Active Recall",
    type: "Active Recall",
  },
  {
    id: "sess_demo_3",
    timestamp: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
    duration: "20m",
    topic: "Practice Quiz & Knowledge Check",
    type: "AI Quiz",
  },
];

export function getSessionHistory(): StudySessionRecord[] {
  if (typeof window === "undefined") return DEFAULT_SESSIONS;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(DEFAULT_SESSIONS));
      return DEFAULT_SESSIONS;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_SESSIONS;
  }
}

export function addSessionRecord(session: Omit<StudySessionRecord, "id">) {
  if (typeof window === "undefined") return;
  const current = getSessionHistory();
  const newRecord: StudySessionRecord = {
    ...session,
    id: "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
  };
  const updated = [newRecord, ...current].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT, { detail: updated }));
  return newRecord;
}

interface SessionHistoryProps {
  className?: string;
}

export function SessionHistory({ className = "" }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<StudySessionRecord[]>(DEFAULT_SESSIONS);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logTopic, setLogTopic] = useState("");
  const [logDuration, setLogDuration] = useState("20");
  const [logType, setLogType] = useState("Flashcards Review");

  useEffect(() => {
    setSessions(getSessionHistory());

    const handleUpdate = () => {
      setSessions(getSessionHistory());
    };
    window.addEventListener(HISTORY_EVENT, handleUpdate);
    return () => window.removeEventListener(HISTORY_EVENT, handleUpdate);
  }, []);

  const handleLogManualSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logTopic.trim()) return;

    const mins = parseInt(logDuration, 10) || 15;
    addSessionRecord({
      timestamp: new Date().toISOString(),
      duration: `${mins}m`,
      topic: logTopic.trim(),
      type: logType,
    });

    // Also update daily streak
    recordStudySessionCompletion(mins, logTopic.trim());

    setLogTopic("");
    setShowLogModal(false);
    toast.success(`Logged ${mins}m focus session! Daily streak updated! 🔥`);
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (isToday) {
        return `Today at ${timeStr}`;
      }
      return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className={`rounded-2xl p-5 md:p-6 bg-panel border border-line shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-gradient-to-br from-cool/20 to-violet/20 border border-cool/30 flex items-center justify-center text-cool2">
            <History className="size-4.5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
              Session History
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cool/10 text-cool2 border border-cool/20">
                {sessions.length} Recorded
              </span>
            </h3>
            <p className="text-xs text-soft">
              Timestamps and durations of your past study sessions and focus activity.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowLogModal(!showLogModal)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line bg-accent hover:border-cool/40 flex items-center gap-1.5 transition-colors text-foreground"
        >
          <Plus className="size-3.5" /> Log Focus
        </button>
      </div>

      {/* Manual Quick Log Form */}
      {showLogModal && (
        <form
          onSubmit={handleLogManualSession}
          className="mb-4 p-4 rounded-xl bg-accent border border-cool2/40 space-y-3 animate-in fade-in"
        >
          <div className="grid sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-medium text-soft mb-1">Study Material / Topic</label>
              <input
                type="text"
                required
                placeholder="e.g. 20 Flashcards on Biology"
                value={logTopic}
                onChange={(e) => setLogTopic(e.target.value)}
                className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cool2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-soft mb-1">Duration (minutes)</label>
              <input
                type="number"
                min="1"
                max="300"
                value={logDuration}
                onChange={(e) => setLogDuration(e.target.value)}
                className="w-full bg-foreground/5 border border-line rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cool2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-soft mb-1">Session Type</label>
              <select
                value={logType}
                onChange={(e) => setLogType(e.target.value)}
                className="w-full bg-foreground/5 border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-cool2 text-foreground"
              >
                <option value="Flashcards Review">Flashcards Review</option>
                <option value="Active Recall">Active Recall</option>
                <option value="Practice Quiz">Practice Quiz</option>
                <option value="Notes & Summary">Notes Reading</option>
                <option value="Exam Prep">Exam Preparation</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowLogModal(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-line text-soft hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-brand text-ink hover:opacity-95"
            >
              Save Session
            </button>
          </div>
        </form>
      )}

      {/* Session History Log List */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {sessions.length === 0 ? (
          <div className="text-center py-6 text-soft text-xs border border-dashed border-line rounded-xl">
            No focus sessions logged yet. Complete study sessions or click "+ Log Focus" to track activity.
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-panel border border-line/70 hover:border-cool/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-8 rounded-lg bg-cool/10 border border-cool/20 flex items-center justify-center text-cool2 shrink-0">
                  <Clock className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{s.topic}</p>
                  <div className="flex items-center gap-2 text-[10px] text-soft mt-0.5">
                    <span className="flex items-center gap-1 font-medium text-cool2">
                      <Calendar className="size-3" /> {formatTimestamp(s.timestamp)}
                    </span>
                    <span>·</span>
                    <span className="px-1.5 py-0.2 rounded bg-foreground/5 font-medium">
                      {s.type}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="inline-flex items-center gap-1 text-xs font-bold font-display px-2.5 py-1 rounded-lg bg-mint/10 text-mint border border-mint/20">
                  <Clock className="size-3" /> {s.duration}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
