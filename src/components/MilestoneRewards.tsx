import { useEffect, useMemo, useState } from "react";
import { Award, Check, Lock, Palette, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getStreakData, STREAK_EVENT } from "./DailyStreak";

const REWARDS_KEY = "momentum_rewards_theme";
export const REWARDS_EVENT = "momentum_rewards_updated";

type ThemeId = "default" | "aurora" | "sunset" | "forest";

type Reward = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: "streak" | "hours";
  threshold: number;
  theme?: ThemeId;
};

const REWARDS: Reward[] = [
  { id: "streak-3", name: "Spark", description: "3-day study streak", icon: "🔥", type: "streak", threshold: 3 },
  { id: "hours-5", name: "Focused", description: "5 total study hours", icon: "⏱️", type: "hours", threshold: 5 },
  { id: "streak-7", name: "Momentum", description: "7-day study streak", icon: "⚡", type: "streak", threshold: 7, theme: "aurora" },
  { id: "hours-10", name: "Deep Work", description: "10 total study hours", icon: "🧠", type: "hours", threshold: 10 },
  { id: "streak-14", name: "Unstoppable", description: "14-day study streak", icon: "🏆", type: "streak", threshold: 14, theme: "sunset" },
  { id: "hours-25", name: "Scholar", description: "25 total study hours", icon: "📚", type: "hours", threshold: 25 },
  { id: "streak-30", name: "Legend", description: "30-day study streak", icon: "👑", type: "streak", threshold: 30, theme: "forest" },
  { id: "hours-50", name: "Mastery", description: "50 total study hours", icon: "💎", type: "hours", threshold: 50 },
];

const THEMES: { id: ThemeId; name: string; description: string }[] = [
  { id: "default", name: "Momentum", description: "The original Momentum look" },
  { id: "aurora", name: "Aurora", description: "Cool blue-green focus theme" },
  { id: "sunset", name: "Sunset", description: "Warm evening study theme" },
  { id: "forest", name: "Forest", description: "Deep green long-session theme" },
];

function unlocked(reward: Reward, streak: ReturnType<typeof getStreakData>) {
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
        <div className="grid sm:grid-cols-4 gap-2">
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
