import { useEffect, useMemo, useState } from "react";
import { Shield, Sparkles, Trophy, Award, Crown, Compass, Info, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface RpgRank {
  tier: number;
  title: string;
  subtitle: string;
  minPct: number;
  maxPct: number;
  color: string;
  badgeBg: string;
  borderColor: string;
  textColor: string;
  icon: typeof Shield;
  description: string;
}

const TIER_NAMES = [
  "Rookie", "Sparkplug", "Page Turner", "Mindforge", "Lore Hunter", "Quiz Rogue", "Focus Knight", "Brainstormer", "Cipher Seeker", "Skill Smith",
  "Recall Ranger", "Insight Adept", "Lorekeeper", "Neural Nomad", "Arcane Scholar", "Knowledge Warden", "Thoughtsmith", "Puzzle Phantom", "Study Samurai", "Savant-in-Training",
  "Memory Maverick", "Concept Crusher", "Wisdom Weaver", "Focus Alchemist", "Theorem Tactician", "Mind Paladin", "Recall Ronin", "Logic Titan", "Scholar Supreme", "Brainstorm Baron",
  "Chronicle Keeper", "Syllabus Slayer", "Cognition Commander", "Mastery Marauder", "Insight Overlord", "Mnemonic Monarch", "Quantum Quester", "Lorebreaker", "Grand Strategist", "Apex Intellect",
  "Mythic Mind", "Omniscient Orbit", "Eureka Engine", "Cosmic Savant", "Ascendant Sage", "Paragon of Knowledge", "Infinite Thinker", "Mind Eternal", "Legend.exe", "Study Deity",
];
const TIER_SUBTITLES = TIER_NAMES.map((_, i) => [
  "Your story starts here", "A little spark, a lot of potential", "Turning pages into progress", "Forging stronger thinking", "Hunting down understanding",
  "Taking on every question", "Guarding your focus", "Ideas are connecting", "Cracking the tricky bits", "Crafting durable skills",
  "Recall under pressure", "Seeing the deeper pattern", "Keeping knowledge close", "Exploring new mental paths", "Scholarship with a little magic",
  "Protecting what you've learned", "Building ideas that last", "Solving with style", "Discipline meets courage", "Potential becoming power",
  "Making memory your superpower", "Breaking through hard concepts", "Weaving facts into insight", "Turning effort into mastery", "Tactical with every theory",
  "Defending the fundamentals", "Calm, sharp, consistent", "Built for big challenges", "A force in the study realm", "Ideas answer your call",
  "Keeping the whole story straight", "Taking down the syllabus", "Commanding complex concepts", "Relentless pursuit of mastery", "Insight at full power",
  "Ruling the memory palace", "Curiosity at cosmic scale", "Breaking through old limits", "Planning like a legend", "Operating at the edge",
  "A mind of mythic strength", "Orbiting big ideas", "Powered by breakthroughs", "A universe of understanding", "Rising beyond the ordinary",
  "Excellence, earned", "Thinking without borders", "Knowledge that endures", "Achievement unlocked", "The final form of focus",
][i]);
const TIER_COLORS = [
  ["from-stone-600 to-stone-800", "bg-stone-950/40", "border-stone-600/50", "text-stone-300"],
  ["from-amber-700 to-amber-900", "bg-amber-950/40", "border-amber-700/50", "text-amber-400"],
  ["from-slate-500 to-cyan-700", "bg-cyan-950/40", "border-cyan-700/50", "text-cyan-300"],
  ["from-emerald-600 to-teal-700", "bg-emerald-950/40", "border-emerald-600/50", "text-emerald-300"],
  ["from-blue-600 to-indigo-700", "bg-indigo-950/40", "border-indigo-500/50", "text-indigo-300"],
  ["from-violet-600 to-purple-800", "bg-violet-950/40", "border-violet-500/50", "text-violet-300"],
  ["from-purple-600 to-fuchsia-800", "bg-purple-950/40", "border-purple-500/50", "text-purple-300"],
  ["from-sky-500 to-blue-700", "bg-sky-950/40", "border-sky-500/50", "text-sky-300"],
  ["from-orange-500 to-rose-700", "bg-orange-950/40", "border-orange-500/50", "text-orange-300"],
  ["from-teal-500 to-cyan-700", "bg-teal-950/40", "border-teal-500/50", "text-teal-300"],
  ["from-lime-600 to-green-800", "bg-lime-950/40", "border-lime-500/50", "text-lime-300"],
  ["from-indigo-600 to-violet-800", "bg-indigo-950/40", "border-indigo-500/50", "text-indigo-300"],
  ["from-pink-600 to-rose-800", "bg-pink-950/40", "border-pink-500/50", "text-pink-300"],
  ["from-fuchsia-600 to-purple-900", "bg-fuchsia-950/40", "border-fuchsia-500/50", "text-fuchsia-300"],
  ["from-cyan-500 to-blue-800", "bg-cyan-950/40", "border-cyan-500/50", "text-cyan-300"],
  ["from-green-500 to-emerald-800", "bg-green-950/40", "border-green-500/50", "text-green-300"],
  ["from-rose-500 to-red-800", "bg-rose-950/40", "border-rose-500/50", "text-rose-300"],
  ["from-yellow-500 to-orange-700", "bg-yellow-950/40", "border-yellow-500/50", "text-yellow-300"],
  ["from-purple-500 to-indigo-900", "bg-purple-950/40", "border-purple-500/50", "text-purple-300"],
  ["from-amber-400 to-yellow-600", "bg-amber-950/50", "border-amber-400/60", "text-amber-300"],
];
const TIER_ICONS = [Shield, Compass, Shield, Award, Sparkles, Award, Trophy, Sparkles, Crown, Award, Compass, Trophy, Sparkles, Shield, Award, Compass, Trophy, Crown, Sparkles, Crown];
export const RPG_RANKS: RpgRank[] = TIER_NAMES.map((title, i) => ({
  tier: i + 1, title, subtitle: TIER_SUBTITLES[i]!, minPct: i * 2,
  maxPct: i === 49 ? 100 : i * 2 + 1,
  color: TIER_COLORS[i % TIER_COLORS.length]![0]!, badgeBg: TIER_COLORS[i % TIER_COLORS.length]![1]!,
  borderColor: TIER_COLORS[i % TIER_COLORS.length]![2]!, textColor: TIER_COLORS[i % TIER_COLORS.length]![3]!,
  icon: TIER_ICONS[i % TIER_ICONS.length]!, description: i === 0
    ? "Beginning your study journey; build a steady practice habit."
    : i === 49
      ? "The ultimate study rank: exceptional mastery across practice and recall."
      : `Tier ${i + 1}: ${title} — build durable recall, apply ideas, and demonstrate consistent mastery to advance.`,
}));

interface LevelsProps {
  percentage: number;
  className?: string;
  scope?: "overall" | "set";
}

export function Levels({ percentage, className = "", scope = "overall" }: LevelsProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const clampedPct = Math.max(0, Math.min(100, Math.round(percentage)));

  const currentRank = useMemo(() => {
    return (
      RPG_RANKS.find((r) => clampedPct >= r.minPct && clampedPct <= r.maxPct) || RPG_RANKS[0]!
    );
  }, [clampedPct]);

  const nextRank = useMemo(() => {
    const nextIdx = RPG_RANKS.findIndex((r) => r.tier === currentRank.tier) + 1;
    return RPG_RANKS[nextIdx] ?? null;
  }, [currentRank]);

  const pctToNext = nextRank ? Math.max(0, nextRank.minPct - clampedPct) : 0;
  const currentTierProgress = nextRank
    ? Math.round(
        ((clampedPct - currentRank.minPct) / (currentRank.maxPct - currentRank.minPct + 1)) * 100,
      )
    : 100;

  const Icon = currentRank.icon;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `momentum_seen_tier_${scope}`;
    const previous = Number(localStorage.getItem(key) ?? 0);
    if (previous > 0 && currentRank.tier > previous) {
      const emblems = ["🛡️","⚡","📖","⚒️","🧭","🗡️","🏰","🌩️","🔐","🛠️","🏹","💡","📜","🪐","🔮","🛡️","🧠","👻","🥷","🎓","🦅","💥","🧵","⚗️","♟️","🛡️","🥷","🗿","👑","🌪️","📚","⚔️","🎖️","🐺","👁️","👑","🌌","🌀","♟️","🔱","🐉","🪐","💫","🌠","🧙","🏆","♾️","🌳","🤖","👑"];
      window.dispatchEvent(new CustomEvent("momentum_celebration", { detail: { kind: "tier", tier: currentRank.tier, title: `Tier ${currentRank.tier}: ${currentRank.title}`, subtitle: currentRank.subtitle, emblem: emblems[currentRank.tier - 1] } }));
    }
    if (currentRank.tier > previous) localStorage.setItem(key, String(currentRank.tier));
  }, [currentRank.tier, currentRank.title, currentRank.subtitle, scope]);

  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`group inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border ${currentRank.borderColor} ${currentRank.badgeBg} hover:scale-[1.02] active:scale-[0.98] transition-all text-left shadow-sm ${className}`}
          title={`Click to view ${scope === "overall" ? "overall" : "this set's"} mastery rank ladder`}
        >
          <div
            className={`size-8 rounded-lg bg-gradient-to-br ${currentRank.color} flex items-center justify-center text-white shadow-md shrink-0`}
          >
            <Icon className="size-4 animate-pulse" />
          </div>

          <div className="min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-soft">
                Tier {currentRank.tier}
              </span>
              <span className={`text-xs font-bold tracking-tight ${currentRank.textColor}`}>
                {currentRank.title}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-16 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${currentRank.color}`}
                  style={{ width: `${Math.min(100, Math.max(8, currentTierProgress))}%` }}
                />
              </div>
              <span className="text-[10px] font-semibold text-soft">
                {clampedPct}% XP
              </span>
            </div>
          </div>

          <Info className="size-3.5 text-soft/60 group-hover:text-soft transition-colors shrink-0 ml-0.5" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md bg-ink2 border-line text-foreground p-6 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <Trophy className="size-5 text-cool2" />
            Momentum Mastery Tiers
          </DialogTitle>
          <p className="text-xs text-soft mt-1">
            Your tier is based on the mastery percentage shown here. Overall rank summarizes all study progress; a study-set rank reflects that set only, so the two can differ.
          </p>
        </DialogHeader>

        <div className="mt-4 p-4 rounded-xl bg-panel border border-line flex items-center gap-4">
          <div
            className={`size-12 rounded-xl bg-gradient-to-br ${currentRank.color} flex items-center justify-center text-white shadow-lg shrink-0`}
          >
            <Icon className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className={`font-display text-lg font-bold ${currentRank.textColor}`}>
                Tier {currentRank.tier}: {currentRank.title}
              </h4>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-foreground/10">
                {clampedPct}% Total Mastery
              </span>
            </div>
            <p className="text-xs text-soft mt-0.5">{currentRank.subtitle}</p>
            <p className="text-xs text-soft/90 mt-1 leading-snug">{currentRank.description}</p>
            {nextRank && (
              <p className="text-[11px] font-medium text-cool2 mt-2">
                ⚡ Only {pctToNext}% more mastery needed to reach {nextRank.title}!
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="eyebrow text-soft">All Mastery Tiers</p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {RPG_RANKS.map((r) => {
              const isCurrent = r.tier === currentRank.tier;
              const isUnlocked = clampedPct >= r.minPct;
              const RankIcon = r.icon;

              return (
                <div
                  key={r.tier}
                  className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                    isCurrent
                      ? "bg-cool/10 border-cool2/60 shadow-sm"
                      : isUnlocked
                        ? "bg-foreground/5 border-line/60"
                        : "opacity-45 bg-foreground/5 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`size-7 rounded-md bg-gradient-to-br ${r.color} flex items-center justify-center text-white shrink-0`}
                    >
                      <RankIcon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">Tier {r.tier}: {r.title}</span>
                        <span className="text-[10px] text-soft">
                          ({r.minPct}%–{r.maxPct}%)
                        </span>
                      </div>
                      <p className="text-[11px] text-soft truncate">{r.subtitle}</p>
                    </div>
                  </div>

                  {isCurrent ? (
                    <span className="text-[10px] font-bold text-cool2 bg-cool2/10 px-2 py-0.5 rounded-full border border-cool2/30 shrink-0">
                      Current
                    </span>
                  ) : isUnlocked ? (
                    <CheckCircle2 className="size-4 text-mint shrink-0" />
                  ) : (
                    <span className="text-[10px] text-soft shrink-0">Locked</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
