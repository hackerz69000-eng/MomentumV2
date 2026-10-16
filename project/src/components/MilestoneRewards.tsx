import { useEffect, useMemo, useState } from "react";
import { Award, Check, Lock, Palette, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getStreakData, STREAK_EVENT } from "./DailyStreak";
import { celebrate } from "@/components/CelebrationOverlay";

const REWARDS_KEY = "momentum_rewards_theme";
export const REWARDS_EVENT = "momentum_rewards_updated";

type ThemeId =
  | "default" | "aurora" | "sunset" | "forest" | "ocean" | "lavender" | "rose" | "ember"
  | "midnight" | "arctic" | "candy" | "monochrome" | "desert" | "nebula" | "jade" | "gold"
  | "coral" | "glacier" | "orchid" | "cosmic";

type Reward = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: "streak" | "hours" | "all";
  threshold: number;
  theme?: ThemeId;
};

const milestoneNames = [
  "First Spark", "Getting Started", "Three-Day Flame", "Focused Mind", "Momentum Builder",
  "One Week Strong", "Steady Learner", "Deep Focus", "Habit Former", "Ten-Hour Scholar",
  "Curious Mind", "Consistency Keeper", "Two-Week Champion", "Knowledge Seeker", "Study Strategist",
  "Quarter-Century", "Routine Master", "Persistent Thinker", "Thirty-Day Legend", "Deep Work Adept",
  "Bright Mind", "Learning Machine", "Forty-Hour Focus", "Skill Builder", "Half-Century Scholar",
  "Unshakable Habit", "Sharpener", "Streak Guardian", "Dedicated Scholar", "Sixty-Hour Sage",
  "Peak Performer", "Relentless Learner", "Streak Virtuoso", "Master of Practice", "Eighty-Hour Expert",
  "Insight Seeker", "Disciplined Mind", "Study Titan", "Century of Focus", "Knowledge Architect",
  "Learning Luminary", "Unstoppable Force", "Habit Icon", "Mastery Pursuit", "Study Champion",
  "Elite Scholar", "Legendary Focus", "Grand Strategist", "Mythic Learner", "Momentum Grandmaster",
];
const milestoneIcons = ["✨", "📘", "🔥", "🎯", "⚡", "🗓️", "🧩", "🧠", "🌱", "📚", "🔎", "🛡️", "🏆", "💡", "🧭", "⏳", "🔁", "💭", "👑", "🎓", "🌟", "🤖", "⌛", "🛠️", "💎", "🔒", "✏️", "🦉", "📖", "🧙", "🚀", "♾️", "🎼", "🏅", "🌋", "🔭", "🧘", "🐉", "💯", "🏛️", "☀️", "🦾", "🏵️", "🗝️", "🥇", "🌠", "🦁", "♟️", "🌌", "👑"];
const themeIds: ThemeId[] = ["default", "aurora", "sunset", "forest", "ocean", "lavender", "rose", "ember", "midnight", "arctic", "candy", "monochrome", "desert", "nebula", "jade", "gold", "coral", "glacier", "orchid", "cosmic"];
const themeNames = ["Momentum", "Aurora", "Sunset", "Forest", "Ocean", "Lavender", "Rose", "Ember", "Midnight", "Arctic", "Candy", "Monochrome", "Desert", "Nebula", "Jade", "Gold", "Coral", "Glacier", "Orchid", "Cosmic"];
const themeDescriptions = ["The original Momentum look", "Northern-light teal", "Warm sunset glow", "Deep woodland green", "Calm deep-blue waters", "Soft violet focus", "Blush-pink accents", "Warm ember orange", "Night-sky blue", "Cool icy tones", "Playful pastel pink", "Minimal grayscale", "Warm sand and clay", "Space-inspired purple", "Rich jade green", "Premium golden accents", "Bright tropical coral", "Glacial blue-white", "Orchid purple", "Cosmic indigo"];
const THEMES: { id: ThemeId; name: string; description: string }[] = themeIds.map((id, i) => ({ id, name: themeNames[i], description: themeDescriptions[i] }));

// Fifty milestones alternate between longest streak and accumulated study time.
// Every milestone from #3 onward also unlocks one of the twenty cosmetic themes at spaced intervals.
const BASE_REWARDS: Reward[] = milestoneNames.map((name, i) => {
  const number = i + 1;
  const type = i % 2 === 0 ? "streak" : "hours";
  const threshold = type === "streak" ? Math.max(1, Math.ceil(number / 2) * 3) : Math.ceil(number / 2) * 5;
  const theme = number === 1 ? undefined : (number % 2 === 0 && number / 2 <= 19 ? themeIds[number / 2] : undefined);
  return {
    id: `milestone-${number}`,
    name,
    description: type === "streak" ? `${threshold}-day longest study streak` : `${threshold} total study hours`,
    icon: milestoneIcons[i], type, threshold, theme,
  };
});

const REWARDS: Reward[] = [...BASE_REWARDS, {
  id: "milestone-study-fiend",
  name: "Study Fiend",
  description: "Unlock every other milestone reward to earn this ultimate badge.",
  icon: "😈",
  type: "all",
  threshold: BASE_REWARDS.length,
}];

function unlocked(reward: Reward, streak: ReturnType<typeof getStreakData>) {
  if (reward.type === "all") return BASE_REWARDS.every((item) => unlocked(item, streak));
  return reward.type === "streak" ? streak.longestStreak >= reward.threshold : (streak.totalStudyMinutes ?? 0) >= reward.threshold * 60;
}

export function getSelectedTheme(): ThemeId {
  if (typeof window === "undefined") return "default";
  return (localStorage.getItem(REWARDS_KEY) as ThemeId | null) ?? "default";
}

export function applyRewardTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.momentumTheme = theme === "default" ? "" : theme;
}

export function MilestoneRewards({ className = "" }: { className?: string }) {
  const [streak, setStreak] = useState(getStreakData());
  const [theme, setTheme] = useState<ThemeId>(getSelectedTheme);

  useEffect(() => {
    applyRewardTheme(theme);
    const update = () => setStreak(getStreakData());
    window.addEventListener(STREAK_EVENT, update);
    window.addEventListener(REWARDS_EVENT, update);
    return () => {
      window.removeEventListener(STREAK_EVENT, update);
      window.removeEventListener(REWARDS_EVENT, update);
    };
  }, [theme]);

  const unlockedRewards = useMemo(() => REWARDS.filter((r) => unlocked(r, streak)), [streak]);

  useEffect(() => {
    const key = "momentum_seen_rewards_v1";
    const now = unlockedRewards.map((reward) => reward.id);
    let previous: string[] = [];
    try { previous = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { previous = []; }
    const newlyUnlocked = unlockedRewards.filter((reward) => !previous.includes(reward.id));
    // On first install, record existing unlocks without replaying a backlog of celebrations.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(now));
    else {
      localStorage.setItem(key, JSON.stringify(now));
      const reward = newlyUnlocked[0];
      if (reward) celebrate({ kind: "reward", title: reward.name, subtitle: `${reward.description}${reward.theme ? ` · ${themeNames[themeIds.indexOf(reward.theme)]} theme unlocked` : ""}`, emblem: reward.icon });
    }
  }, [unlockedRewards]);
  const availableThemes = THEMES.filter((t) => t.id === "default" || unlockedRewards.some((r) => r.theme === t.id));

  const chooseTheme = (next: ThemeId) => {
    if (!availableThemes.some((t) => t.id === next)) return;
    setTheme(next);
    localStorage.setItem(REWARDS_KEY, next);
    applyRewardTheme(next);
    window.dispatchEvent(new Event(REWARDS_EVENT));
    toast.success(`${THEMES.find((t) => t.id === next)?.name ?? "Theme"} theme applied.`);
  };

  return (
    <section className={`rounded-2xl p-5 md:p-6 bg-panel border border-line shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-300">
            <Award className="size-4.5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              Milestone Rewards
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                {unlockedRewards.length}/{REWARDS.length} unlocked
              </span>
            </h3>
            <p className="text-xs text-soft">Build your streak and study hours to unlock cosmetics.</p>
          </div>
        </div>
        <Sparkles className="size-4 text-amber-300 shrink-0" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {REWARDS.map((reward) => {
          const isUnlocked = unlocked(reward, streak);
          return (
            <div key={reward.id} className={`rounded-xl border p-3 ${isUnlocked ? "border-amber-400/30 bg-amber-400/5" : "border-line bg-foreground/[0.03] opacity-60"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl">{reward.icon}</span>
                {isUnlocked ? <Check className="size-3.5 text-mint" /> : <Lock className="size-3.5 text-soft" />}
              </div>
              <p className="font-semibold text-xs mt-2">{reward.name}</p>
              <p className="text-[10px] text-soft mt-0.5 leading-relaxed">{reward.description}</p>
              {reward.theme && isUnlocked && <span className="inline-block mt-2 text-[9px] uppercase tracking-wider text-cool2">Theme unlocked</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-line/70">
        <div className="flex items-center gap-2 mb-2">
          <Palette className="size-3.5 text-cool2" />
          <p className="text-xs font-semibold">Cosmetic theme</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {THEMES.map((t) => {
            const canUse = availableThemes.some((x) => x.id === t.id);
            return (
              <button key={t.id} type="button" disabled={!canUse} onClick={() => chooseTheme(t.id)} className={`text-left rounded-lg border p-2.5 transition-colors ${theme === t.id ? "border-cool2 bg-cool/10" : "border-line bg-accent hover:border-cool/40"} ${!canUse ? "opacity-45 cursor-not-allowed" : ""}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{t.name}</span>{canUse ? <Check className={`size-3 ${theme === t.id ? "" : "opacity-0"}`} /> : <Lock className="size-3 text-soft" />}</div>
                <p className="text-[9px] text-soft mt-0.5">{t.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
