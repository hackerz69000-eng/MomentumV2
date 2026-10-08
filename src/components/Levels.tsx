import { useMemo, useState } from "react";
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

export const RPG_RANKS: RpgRank[] = [
  {
    tier: 1,
    title: "Novice",
    subtitle: "Initiate of Knowledge",
    minPct: 0,
    maxPct: 15,
    color: "from-amber-700 to-amber-900",
    badgeBg: "bg-amber-950/40",
    borderColor: "border-amber-700/50",
    textColor: "text-amber-400",
    icon: Shield,
    description: "Taking the first foundational steps into new subject materials.",
  },
  {
    tier: 2,
    title: "Apprentice",
    subtitle: "Active Learner",
    minPct: 16,
    maxPct: 35,
    color: "from-slate-500 to-cyan-600",
    badgeBg: "bg-cyan-950/40",
    borderColor: "border-cyan-700/50",
    textColor: "text-cyan-300",
    icon: Compass,
    description: "Developing consistent study momentum and grasping key definitions.",
  },
  {
    tier: 3,
    title: "Adept",
    subtitle: "Applied Thinker",
    minPct: 36,
    maxPct: 55,
    color: "from-emerald-600 to-teal-700",
    badgeBg: "bg-emerald-950/40",
    borderColor: "border-emerald-600/50",
    textColor: "text-emerald-300",
    icon: Award,
    description: "Solid conceptual retention, regular flashcard recall, and steady practice.",
  },
  {
    tier: 4,
    title: "Scholar",
    subtitle: "High Comprehension",
    minPct: 56,
    maxPct: 75,
    color: "from-blue-600 to-indigo-700",
    badgeBg: "bg-indigo-950/40",
    borderColor: "border-indigo-500/50",
    textColor: "text-indigo-300",
    icon: Sparkles,
    description: "Deep understanding across multi-topic materials with high quiz accuracy.",
  },
  {
    tier: 5,
    title: "Sage",
    subtitle: "Analytical Master",
    minPct: 76,
    maxPct: 89,
    color: "from-purple-600 to-violet-800",
    badgeBg: "bg-violet-950/40",
    borderColor: "border-violet-500/50",
    textColor: "text-violet-300",
    icon: Trophy,
    description: "Venerable recall speed, near-flawless card mastery, and analytical sharpness.",
  },
  {
    tier: 6,
    title: "Grandmaster",
    subtitle: "Exam Paragon",
    minPct: 90,
    maxPct: 100,
    color: "from-amber-400 to-yellow-600",
    badgeBg: "bg-amber-950/50",
    borderColor: "border-amber-400/60",
    textColor: "text-amber-300",
    icon: Crown,
    description: "Peak subject mastery. Ready to ace comprehensive exams effortlessly.",
  },
];

interface LevelsProps {
  percentage: number;
  className?: string;
}

export function Levels({ percentage, className = "" }: LevelsProps) {
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

  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`group inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border ${currentRank.borderColor} ${currentRank.badgeBg} hover:scale-[1.02] active:scale-[0.98] transition-all text-left shadow-sm ${className}`}
          title="Click to view RPG Level Rank Ladder"
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
            RPG Academic Ranks
          </DialogTitle>
          <p className="text-xs text-soft mt-1">
            Your level dynamically increases as you master flashcards and score higher on study quizzes.
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
          <p className="eyebrow text-soft">All RPG Ranks</p>
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
                        <span className="font-semibold text-foreground">{r.title}</span>
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
