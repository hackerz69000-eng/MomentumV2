export type Mission = { id: string; label: string; target: number; progress: number; xp: number; done: boolean };
export type FreezeData = { available: number; used: number };
const XP_KEY = "momentum_xp_v1";
const FREEZE_KEY = "momentum_streak_freezes_v1";

export function setXpFromCloud(xp: number) {
  const safe = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  try { localStorage.setItem(XP_KEY, String(safe)); window.dispatchEvent(new Event("momentum_xp_updated")); } catch {}
  return safe;
}

export function getXp() {
  try {
    const value = Number(localStorage.getItem(XP_KEY) ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  } catch {
    return 0;
  }
}
export const MAX_LEVEL = 100;
export const XP_LEVEL_EVENT = "momentum_celebration";
export function levelFromXp(xp: number) {
  const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  return Math.min(MAX_LEVEL, Math.max(1, Math.floor(Math.sqrt(safeXp / 50)) + 1));
}
export function xpIntoLevel(xp: number) {
  const level = levelFromXp(xp);
  const prev = (level - 1) ** 2 * 50;
  const next = level >= MAX_LEVEL ? prev : level ** 2 * 50;
  return { level, current: level >= MAX_LEVEL ? 0 : Math.max(0, xp - prev), needed: level >= MAX_LEVEL ? 1 : Math.max(1, next - prev), total: xp, maxed: level >= MAX_LEVEL };
}
export function addXp(amount: number) {
  const previousXp = getXp();
  const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  const next = previousXp + safeAmount;
  try {
    localStorage.setItem(XP_KEY, String(next));
    window.dispatchEvent(new Event("momentum_xp_updated"));
    const before = levelFromXp(previousXp), after = levelFromXp(next);
    if (after > before) {
      for (let level = before + 1; level <= after; level++) {
        window.dispatchEvent(new CustomEvent(XP_LEVEL_EVENT, { detail: { kind: "level", level, milestone: level % 10 === 0 } }));
        if (level % 10 === 0) {
          window.dispatchEvent(new CustomEvent(XP_LEVEL_EVENT, { detail: { kind: "level-milestone", level, milestone: true } }));
          window.dispatchEvent(new CustomEvent(XP_LEVEL_EVENT, { detail: { kind: "reward", id: `level-reward-${level}`, level, badge: ["🔟","🏅","💠","🛡️","👑","🌌","🐉","⚡","💎","🌟"][level / 10 - 1], title: `Level ${level} reward unlocked!`, subtitle: `Milestone badge: ${["First Decade","Bronze Scholar","Crystal Mind","Guardian of Focus","Golden Scholar","Cosmic Learner","Dragon Mind","Lightning Intellect","Diamond Sage","Momentum Legend"][level / 10 - 1]}` } }));
        }
      }
    }
  } catch {}
  return next;
}
export function getFreezes(): FreezeData { try { const x = JSON.parse(localStorage.getItem(FREEZE_KEY) ?? "{}"); return { available: Number(x.available) || 0, used: Number(x.used) || 0 }; } catch { return { available: 0, used: 0 }; } }
export function setFreezes(data: FreezeData) { try { localStorage.setItem(FREEZE_KEY, JSON.stringify(data)); window.dispatchEvent(new Event("momentum_freeze_updated")); } catch {} }
export function earnFreezeIfNeeded(totalStudyMinutes: number) { const earned = Math.floor(totalStudyMinutes / 420); const current = getFreezes(); const totalOwned = current.available + current.used; if (earned > totalOwned) setFreezes({ ...current, available: current.available + (earned - totalOwned) }); return getFreezes(); }
export function useFreeze() { const f = getFreezes(); if (!f.available) return false; setFreezes({ available: f.available - 1, used: f.used + 1 }); return true; }
export function missions(stats: { minutesToday: number; sessionsToday: number; cardsToday: number; quizzesToday: number }): Mission[] {
  return [
    { id: "focus", label: "Complete 2 focus sessions", target: 2, progress: stats.sessionsToday, xp: 75, done: stats.sessionsToday >= 2 },
    { id: "time", label: "Study for 45 minutes", target: 45, progress: stats.minutesToday, xp: 100, done: stats.minutesToday >= 45 },
    { id: "recall", label: "Review 15 flashcards", target: 15, progress: stats.cardsToday, xp: 60, done: stats.cardsToday >= 15 },
    { id: "quiz", label: "Complete a quiz", target: 1, progress: stats.quizzesToday, xp: 80, done: stats.quizzesToday >= 1 },
  ];
}
