import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { recordStudySessionCompletion } from "./DailyStreak";
import { addSessionRecord } from "./SessionHistory";
import { logActivity } from "@/lib/log-activity";

function playTone(kind: "tick" | "chime") {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "tick" ? 820 : 620, now);
    if (kind === "chime") oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "tick" ? 0.025 : 0.06, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "tick" ? 0.08 : 0.5));
    oscillator.start(now);
    oscillator.stop(now + (kind === "tick" ? 0.1 : 0.55));
    oscillator.addEventListener("ended", () => void ctx.close());
  } catch {
    // Audio cues are optional; timer must continue if the browser blocks audio.
  }
}

export function PomodoroTimer({ setId = null, topicName = "Pomodoro Focus", className = "" }: { setId?: string | null; topicName?: string; className?: string }) {
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sound, setSound] = useState(true);
  const completedSeconds = useRef(0);
  const sessionStarted = useRef<number | null>(null);

  const totalSeconds = (mode === "focus" ? focusMinutes : breakMinutes) * 60;
  const progress = Math.max(0, Math.min(100, ((totalSeconds - remaining) / totalSeconds) * 100));
  const display = useMemo(() => `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`, [remaining]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    completedSeconds.current += 1;
    if (remaining > 0 && remaining % 60 === 0 && sound) playTone("tick");
    if (remaining !== 0) return;

    setRunning(false);
    if (mode === "focus") {
      const duration = Math.max(1, Math.round((Date.now() - (sessionStarted.current ?? Date.now())) / 60000));
      const mins = Math.max(1, Math.min(focusMinutes, duration));
      recordStudySessionCompletion(mins, topicName);
      addSessionRecord({ timestamp: new Date().toISOString(), duration: `${mins}m`, topic: topicName, type: "Pomodoro Focus", notes: `Completed a ${focusMinutes}-minute focus block.`, setId: setId ?? undefined });
      void logActivity("session", setId, 1, undefined, { duration_seconds: mins * 60, meta: { source: "pomodoro", focusMinutes } });
      if (sound) playTone("chime");
      const recapScore = Math.min(100, Math.round(55 + (mins / Math.max(1, focusMinutes)) * 35 + (mins >= focusMinutes ? 10 : 0)));
      toast.success(`Session complete · ${mins} min focused · Focus score ${recapScore}/100`, { description: `${topicName} · Progress, streak, and session history updated.` });
      setMode("break");
      setRemaining(breakMinutes * 60);
    } else {
      if (sound) playTone("chime");
      toast.success("Break complete. Ready for another focus session?");
      setMode("focus");
      setRemaining(focusMinutes * 60);
    }
    sessionStarted.current = null;
  }, [remaining, running, mode, sound, focusMinutes, breakMinutes, topicName, setId]);

  const start = () => {
    if (!sessionStarted.current && mode === "focus") sessionStarted.current = Date.now();
    setRunning(true);
  };
  const reset = () => {
    setRunning(false);
    sessionStarted.current = null;
    setRemaining((mode === "focus" ? focusMinutes : breakMinutes) * 60);
  };
  const changeFocus = (value: number) => {
    if (running) return;
    setFocusMinutes(value);
    if (mode === "focus") setRemaining(value * 60);
  };

  return (
    <section className={`rounded-2xl p-5 md:p-6 bg-panel border border-line shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="eyebrow text-cool2">Focus timer</p><h3 className="font-display text-2xl font-bold mt-1">Pomodoro</h3><p className="text-xs text-soft mt-1">Completed focus sessions automatically count toward progress and streaks.</p></div>
        <button type="button" onClick={() => setSound((v) => !v)} className="p-2 rounded-lg border border-line bg-accent text-soft hover:text-foreground" aria-label={sound ? "Mute timer sounds" : "Enable timer sounds"} title={sound ? "Mute timer sounds" : "Enable timer sounds"}>{sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</button>
      </div>

      <div className="mt-5 flex justify-center gap-2">
        {(["focus", "break"] as const).map((item) => <button key={item} type="button" disabled={running} onClick={() => { setMode(item); setRemaining((item === "focus" ? focusMinutes : breakMinutes) * 60); }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${mode === item ? "border-cool2 bg-cool/10 text-cool2" : "border-line text-soft"}`}>{item === "focus" ? "Focus" : "Break"}</button>)}
      </div>

      <div className="mt-4 text-center"><div className="font-display text-6xl md:text-7xl font-bold tracking-tight tabular-nums">{display}</div><p className="text-xs text-soft mt-2">{mode === "focus" ? topicName : "Rest and reset"}</p></div>
      <div className="mt-5 h-2 rounded-full bg-foreground/10 overflow-hidden"><div className="h-full rounded-full bg-progress transition-[width] duration-700" style={{ width: `${progress}%` }} /></div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={running ? () => setRunning(false) : start} className="font-semibold text-sm bg-primary text-primary-foreground px-5 py-2.5 rounded-lg flex items-center gap-2">{running ? <Pause className="size-4" /> : <Play className="size-4" />}{running ? "Pause" : "Start"}</button>
        <button type="button" onClick={reset} className="font-semibold text-sm bg-accent border border-line px-4 py-2.5 rounded-lg flex items-center gap-2"><RotateCcw className="size-4" /> Reset</button>
      </div>

      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-soft"><span>Focus</span><select value={focusMinutes} disabled={running} onChange={(e) => changeFocus(Number(e.target.value))} className="bg-accent border border-line rounded-lg px-2 py-1 text-foreground"><option value={15}>15 min</option><option value={25}>25 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={50}>50 min</option></select><span>· Break {breakMinutes} min</span></div>
      <p className="text-[10px] text-soft text-center mt-2">Optional audio: a subtle tick each minute and a chime when a session ends.</p>
    </section>
  );
}
