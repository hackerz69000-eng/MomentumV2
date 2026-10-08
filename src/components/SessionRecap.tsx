import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getSessionHistory, HISTORY_EVENT, type StudySessionRecord } from "@/components/SessionHistory";

function minutes(s: StudySessionRecord) {
  return Number(String(s.duration).match(/[\d.]+/)?.[0] ?? 0);
}

function score(s: StudySessionRecord) {
  const m = minutes(s);
  return Math.max(0, Math.min(100, Math.round(45 + Math.min(m, 60) * 0.55 + (/(flashcard|recall|quiz|exam)/i.test(s.type) ? 18 : 8) - (m > 90 ? 12 : 0))));
}

export function SessionRecap() {
  const [session, setSession] = useState<StudySessionRecord | null>(null);
  useEffect(() => {
    const update = () => setSession(getSessionHistory().filter((s) => !s.id.startsWith("sess_demo_")).at(0) ?? null);
    update();
    window.addEventListener(HISTORY_EVENT, update);
    return () => window.removeEventListener(HISTORY_EVENT, update);
  }, []);

  return (
    <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <div className="flex items-center gap-2 text-cool2"><Sparkles className="size-5" /><span className="eyebrow">Session recap</span></div>
      <h2 className="font-display text-xl font-bold mt-2">Your latest focus</h2>
      {!session ? <p className="text-sm text-soft mt-3">Finish a focus session to see your recap here.</p> : <>
        <p className="text-sm font-medium mt-4">{session.topic}</p>
        <div className="grid grid-cols-2 gap-3 mt-3"><div className="rounded-lg bg-accent p-3 text-center"><p className="text-[10px] uppercase tracking-wider text-soft">Duration</p><p className="font-display text-xl font-bold mt-1">{minutes(session)}m</p></div><div className="rounded-lg bg-accent p-3 text-center"><p className="text-[10px] uppercase tracking-wider text-soft">Focus score</p><p className="font-display text-xl font-bold text-cool2 mt-1">{score(session)}/100</p></div></div>
        <p className="text-xs text-soft mt-3">{session.type} · {new Date(session.timestamp).toLocaleString()}</p>
        <p className="text-sm mt-3">{score(session) >= 85 ? "Excellent focused session. Keep the rhythm." : score(session) >= 65 ? "Solid work. A short retrieval session can reinforce it." : "Try a focused 25-minute block next time."}</p>
      </>}
    </div>
  );
}
