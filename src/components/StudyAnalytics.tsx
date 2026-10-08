import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSessionHistory, HISTORY_EVENT, type StudySessionRecord } from "./SessionHistory";

function minutesFromRecord(record: StudySessionRecord) {
  const match = String(record.duration).match(/([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

function lastSevenDays(sessions: StudySessionRecord[]) {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toDateString();
    const minutes = sessions.reduce((sum, session) => {
      const d = new Date(session.timestamp);
      return d.toDateString() === key ? sum + minutesFromRecord(session) : sum;
    }, 0);
    return { date: key, day: date.toLocaleDateString([], { weekday: "short" }), hours: Number((minutes / 60).toFixed(2)), minutes };
  });
}

export function StudyAnalytics({ className = "" }: { className?: string }) {
  const [sessions, setSessions] = useState<StudySessionRecord[]>([]);

  useEffect(() => {
    setSessions(getSessionHistory());
    const update = () => setSessions(getSessionHistory());
    window.addEventListener(HISTORY_EVENT, update);
    return () => window.removeEventListener(HISTORY_EVENT, update);
  }, []);

  const data = useMemo(() => lastSevenDays(sessions), [sessions]);
  const totalMinutes = data.reduce((sum, d) => sum + d.minutes, 0);
  const totalHours = totalMinutes / 60;
  const best = data.reduce((a, b) => (b.minutes > a.minutes ? b : a), data[0]);

  return (
    <section className={`rounded-2xl p-5 md:p-6 bg-panel border border-line shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-cool/10 border border-cool/25 flex items-center justify-center text-cool2"><BarChart3 className="size-4.5" /></div>
          <div>
            <h3 className="font-display text-lg font-bold">Study Analytics</h3>
            <p className="text-xs text-soft">Study hours completed over the last 7 days.</p>
          </div>
        </div>
        <div className="text-right shrink-0"><p className="font-display text-xl font-bold text-mint">{totalHours.toFixed(1)}h</p><p className="text-[10px] text-soft">last 7 days</p></div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.12} />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals domain={[0, "auto"]} />
            <Tooltip cursor={{ fill: "currentColor", opacity: 0.05 }} formatter={(value) => [`${Number(value).toFixed(2)}h`, "Study"]} labelFormatter={(label) => String(label)} />
            <Bar dataKey="hours" radius={[6, 6, 0, 0]} fill="var(--cool2)" maxBarSize={42} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-foreground/5 border border-line/60 py-2"><p className="font-display text-lg font-bold text-cool2">{data.filter((d) => d.minutes > 0).length}</p><p className="text-[10px] text-soft">active days</p></div>
        <div className="rounded-lg bg-foreground/5 border border-line/60 py-2"><p className="font-display text-lg font-bold text-amber-300 flex items-center justify-center gap-1"><Clock3 className="size-3.5" />{best?.hours.toFixed(1) ?? "0.0"}h</p><p className="text-[10px] text-soft">best day</p></div>
      </div>
    </section>
  );
}
