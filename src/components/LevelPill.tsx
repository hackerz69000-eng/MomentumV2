import { useEffect, useState } from "react";
import { getXp, levelFromXp, xpIntoLevel } from "@/lib/gamification";

/** Compact live level badge used beside tier and streak in the top navigation. */
export function LevelPill() {
  const [xp, setXp] = useState(() => getXp());
  useEffect(() => {
    const update = () => setXp(getXp());
    window.addEventListener("momentum_xp_updated", update);
    return () => window.removeEventListener("momentum_xp_updated", update);
  }, []);
  const level = levelFromXp(xp);
  const progress = xpIntoLevel(xp);
  const decade = Math.floor((level - 1) / 10);
  const palettes = ["from-slate-400 to-slate-700", "from-emerald-400 to-teal-700", "from-sky-400 to-blue-800", "from-violet-400 to-purple-800", "from-amber-300 to-orange-700", "from-cyan-300 to-indigo-800", "from-rose-400 to-fuchsia-800", "from-yellow-200 to-amber-700", "from-blue-200 to-indigo-900", "from-fuchsia-300 to-rose-800"];
  return <div title={`${xp} XP · ${progress.maxed ? "maximum level" : `${progress.current} / ${progress.needed} XP to next level`}`} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-gradient-to-br from-violet-950/70 to-indigo-950/50 px-3 py-1.5 shadow-sm">
    <div className={`grid size-9 place-items-center rounded-xl border border-white/40 bg-gradient-to-br ${palettes[decade]} text-white shadow-lg ${level % 10 === 0 ? "ring-2 ring-amber-300/80 ring-offset-1 ring-offset-indigo-950" : ""}`}><span className="text-sm font-black italic drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">{level}</span></div>
    <div className="pr-1 min-w-[76px]"><span className="block text-xs font-bold text-violet-200">Level {level}</span><span className="text-[10px] text-soft">{xp.toLocaleString()} XP</span><div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r ${level % 10 === 0 ? "from-amber-300 to-yellow-100" : "from-violet-400 to-cyan-300"} transition-[width] duration-500`} style={{ width: `${progress.maxed ? 100 : Math.min(100, progress.current / progress.needed * 100)}%` }} /></div><span className="text-[9px] text-soft">{progress.maxed ? "MAX LEVEL" : `${Math.round(progress.current / progress.needed * 100)}% to next`}</span></div>
  </div>;
}
