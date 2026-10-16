import { useEffect, useRef, useState } from "react";
import { Award, Flame, Gift, Sparkles, Trophy, X, Zap } from "lucide-react";

export type CelebrationKind = "tier" | "level" | "streak" | "reward";
export type CelebrationDetail = { kind: CelebrationKind; title: string; subtitle: string; tier?: number; emblem?: string };
export const CELEBRATION_EVENT = "momentum_celebration";
export function celebrate(detail: CelebrationDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CELEBRATION_EVENT, { detail }));
}

function playSound(kind: CelebrationKind, tier = 1) {
  try {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    void ctx.resume();
    const patterns: Record<CelebrationKind, number[]> = {
      tier: [392, 523, 659, 784, 1047], level: [440, 554, 659, 880],
      streak: [587, 784, 988], reward: [523, 659, 784, 1047, 1319],
    };
    const notes = patterns[kind];
    const volume = kind === "tier" ? 0.22 : kind === "reward" ? 0.2 : 0.16;
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = kind === "streak" ? "triangle" : kind === "reward" ? "sine" : "sawtooth";
      osc.frequency.setValueAtTime(frequency * (kind === "tier" ? 1 + ((tier % 5) * 0.025) : 1), ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + i * 0.12 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.23);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(ctx.currentTime + i * 0.12); osc.stop(ctx.currentTime + i * 0.12 + 0.25);
    });
    window.setTimeout(() => void ctx.close(), 1600);
  } catch { /* Sound is an enhancement; never interrupt studying if unavailable. */ }
}

const ICONS = { tier: Trophy, level: Zap, streak: Flame, reward: Gift };
const COLORS = { tier: "from-violet-500 via-fuchsia-500 to-amber-300", level: "from-cyan-400 via-blue-500 to-indigo-500", streak: "from-orange-500 via-rose-500 to-amber-300", reward: "from-emerald-400 via-teal-500 to-cyan-300" };
const EFFECTS = { tier: "tier-burst", level: "level-pulse", streak: "streak-flame", reward: "reward-shower" };

export function CelebrationOverlay() {
  const [active, setActive] = useState<CelebrationDetail | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onCelebrate = (event: Event) => {
      const detail = (event as CustomEvent<CelebrationDetail>).detail;
      if (!detail || !detail.kind) return;
      setActive(detail);
      if (soundOn) playSound(detail.kind, detail.tier);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setActive(null), detail.kind === "tier" ? 6200 : 4300);
    };
    const pref = localStorage.getItem("momentum_celebration_sound");
    setSoundOn(pref !== "off");
    window.addEventListener(CELEBRATION_EVENT, onCelebrate);
    return () => { window.removeEventListener(CELEBRATION_EVENT, onCelebrate); window.clearTimeout(timer.current); };
  }, [soundOn]);
  if (!active) return null;
  const Icon = ICONS[active.kind];
  return <div className="celebration-backdrop" role="dialog" aria-modal="true" aria-label={active.title} onClick={() => setActive(null)}>
    <div className={`celebration-card celebration-${active.kind} ${active.kind === "tier" ? `tier-motion-${(active.tier ?? 1) % 5}` : ""}`} onClick={e => e.stopPropagation()}>
      <button className="celebration-close" onClick={() => setActive(null)} aria-label="Close celebration"><X size={18}/></button>
      <div className={`celebration-stage ${EFFECTS[active.kind]}`} aria-hidden="true">
        {Array.from({ length: active.kind === "tier" ? 24 : 14 }, (_, i) => <i key={i} style={{ "--particle": i, "--hue": active.kind === "tier" ? (active.tier ?? 1) * 31 + i * 17 : i * 29 } as React.CSSProperties} />)}
        <div className={`celebration-emblem bg-gradient-to-br ${COLORS[active.kind]}`}>{active.emblem ?? <Icon size={active.kind === "tier" ? 52 : 44} strokeWidth={2.2}/>}</div>
      </div>
      <p className="celebration-kicker">{active.kind === "tier" ? `TIER ${active.tier ?? "UP"} UNLOCKED` : active.kind === "level" ? "LEVEL UP" : active.kind === "streak" ? "STREAK INCREASED" : "REWARD UNLOCKED"}</p>
      <h2>{active.title}</h2><p className="celebration-subtitle">{active.subtitle}</p>
      <div className="celebration-sound-row"><Sparkles size={14}/><span>{soundOn ? "Celebration sound on" : "Celebration sound off"}</span><button onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem("momentum_celebration_sound", next ? "on" : "off"); if (next) playSound(active.kind, active.tier); }}>{soundOn ? "Mute" : "Enable sound"}</button></div>
      <button className="celebration-continue" onClick={() => setActive(null)}>Keep going <Award size={16}/></button>
    </div>
  </div>;
}
