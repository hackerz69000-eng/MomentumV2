import { supabase } from "@/integrations/supabase/client";
import { getXp, setXpFromCloud } from "@/lib/gamification";

const STREAK_KEY = "momentum_streak_data";
const FREEZE_KEY = "momentum_streak_freezes_v1";
const REWARD_ANNOUNCEMENTS_KEY = "momentum_announced_reward_ids_v1";
const REWARDS_THEME_KEY = "momentum_rewards_theme";
const ACTIVITY_IDS_KEY = "momentum_xp_activity_ids_v1";
const TABLE = "user_progression";

type JsonRecord = Record<string, unknown>;
function parseObject(raw: string | null): JsonRecord {
  if (!raw) return {};
  try { const value = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
  catch { return {}; }
}
function number(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.max(0, n) : 0; }
function localSnapshot() {
  return {
    xp: getXp(),
    streak_data: parseObject(typeof localStorage === "undefined" ? null : localStorage.getItem(STREAK_KEY)),
    freeze_data: parseObject(typeof localStorage === "undefined" ? null : localStorage.getItem(FREEZE_KEY)),
    reward_announcements: parseArray(typeof localStorage === "undefined" ? null : localStorage.getItem(REWARD_ANNOUNCEMENTS_KEY)),
    reward_theme: typeof localStorage === "undefined" ? "default" : localStorage.getItem(REWARDS_THEME_KEY) ?? "default",
    activity_ids: parseArray(typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVITY_IDS_KEY)),
  };
}
function parseArray(raw: unknown): string[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function mergeStreak(local: JsonRecord, remote: JsonRecord): JsonRecord {
  const localDate = String(local.lastStudyDate ?? "");
  const remoteDate = String(remote.lastStudyDate ?? "");
  const newest = localDate >= remoteDate ? local : remote;
  return {
    ...newest,
    currentStreak: Math.max(number(local.currentStreak), number(remote.currentStreak)),
    longestStreak: Math.max(number(local.longestStreak), number(remote.longestStreak)),
    totalSessionsCompleted: Math.max(number(local.totalSessionsCompleted), number(remote.totalSessionsCompleted)),
    totalStudyMinutes: Math.max(number(local.totalStudyMinutes), number(remote.totalStudyMinutes)),
    todayActivities: String(local.activityDate ?? "") === String(remote.activityDate ?? "")
      ? [...new Set([...(Array.isArray(local.todayActivities) ? local.todayActivities : []), ...(Array.isArray(remote.todayActivities) ? remote.todayActivities : [])].filter((x): x is string => typeof x === "string"))]
      : (Array.isArray(newest.todayActivities) ? newest.todayActivities.filter((x): x is string => typeof x === "string") : []),
  };
}

/** Hydrates local gamification state from the signed-in user's RLS-protected row and syncs changes. */
export async function initializeProgressionSync(userId: string): Promise<() => void> {
  if (typeof window === "undefined" || !userId) return () => {};
  const table = (supabase as any).from(TABLE);
  const { data, error } = await table.select("user_id,xp,streak_data,freeze_data,reward_announcements,reward_theme,activity_ids,updated_at").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[progression] Could not load cloud progression. Apply the user_progression migration and verify RLS.", error.message);
    return () => {};
  }

  const local = localSnapshot();
  const remote = (data ?? {}) as JsonRecord;
  const streak = mergeStreak(local.streak_data, (remote.streak_data as JsonRecord | null) ?? {});
  const freezesLocal = local.freeze_data;
  const freezesRemote = (remote.freeze_data as JsonRecord | null) ?? {};
  const freezeData = {
    available: Math.max(0, number(freezesLocal.available), number(freezesRemote.available)),
    used: Math.max(0, number(freezesLocal.used), number(freezesRemote.used)),
  };
  const merged = {
    xp: Math.max(local.xp, number(remote.xp)),
    streak_data: streak,
    freeze_data: freezeData,
    reward_announcements: [...new Set([...local.reward_announcements, ...parseArray(remote.reward_announcements)])],
    reward_theme: typeof remote.reward_theme === "string" ? remote.reward_theme : local.reward_theme,
    activity_ids: [...new Set([...local.activity_ids, ...parseArray(remote.activity_ids)])].slice(-5000),
  };
  setXpFromCloud(merged.xp);
  localStorage.setItem(STREAK_KEY, JSON.stringify(merged.streak_data));
  localStorage.setItem(FREEZE_KEY, JSON.stringify(merged.freeze_data));
  localStorage.setItem(REWARD_ANNOUNCEMENTS_KEY, JSON.stringify(merged.reward_announcements));
  localStorage.setItem(REWARDS_THEME_KEY, merged.reward_theme);
  localStorage.setItem(ACTIVITY_IDS_KEY, JSON.stringify(merged.activity_ids));
  window.dispatchEvent(new Event("momentum_streak_updated"));
  window.dispatchEvent(new Event("momentum_freeze_updated"));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let writing = false;
  const persist = async () => {
    if (stopped || writing) return;
    writing = true;
    try {
      const snapshot = localSnapshot();
      const payload = {
        user_id: userId,
        xp: snapshot.xp,
        streak_data: snapshot.streak_data,
        freeze_data: snapshot.freeze_data,
        reward_announcements: snapshot.reward_announcements,
        reward_theme: snapshot.reward_theme,
        activity_ids: snapshot.activity_ids,
        updated_at: new Date().toISOString(),
      };
      const { error: saveError } = await ((supabase as any).from(TABLE)).upsert(payload, { onConflict: "user_id" });
      if (saveError) console.error("[progression] Cloud save failed:", saveError.message);
    } finally { writing = false; }
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void persist(); }, 250); };
  const events = ["momentum_xp_updated", "momentum_streak_updated", "momentum_freeze_updated", "momentum_rewards_updated"];
  events.forEach((event) => window.addEventListener(event, schedule));
  window.addEventListener("storage", schedule);
  void persist();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    events.forEach((event) => window.removeEventListener(event, schedule));
    window.removeEventListener("storage", schedule);
  };
}
