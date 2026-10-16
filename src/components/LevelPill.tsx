import { useEffect, useState } from "react";
import { getXp, levelFromXp } from "@/lib/gamification";

/** Compact live level badge used beside tier and streak in the top navigation. */
export function LevelPill() {
  const [xp, setXp] = useState(() => getXp());
  useEffect(() => {
    const update = () => setXp(getXp());
    window.addEventListener("momentum_xp_updated", update);
    return () => window.removeEventListener("momentum_xp_updated", update);
  }, []);
  const level = levelFromXp(xp);
  return <div title={`${xp} XP · updates as you study`} className="inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-gradient-to-br from-violet-950/70 to-indigo-950/50 px-3 py-1.5 shadow-sm">
    <div className="grid size-8 place-items-center rounded-lg border border-violet-200/40 bg-gradient-to-br from-violet-400 via-indigo-500 to-blue-700 text-white shadow-md"><span className="text-xs font-black">{level}</span></div>
    <div className="pr-1"><span className="block text-xs font-bold text-violet-200">Level {level}</span><span className="text-[10px] text-soft">{xp.toLocaleString()} XP</span></div>
  </div>;
}
