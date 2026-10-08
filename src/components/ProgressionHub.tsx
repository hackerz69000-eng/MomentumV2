import { useEffect, useMemo, useState } from "react";
import { Flame, Gift, Lock, Medal, Snowflake, Sparkles, Target, Trophy, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dayKey, type Activity } from "@/lib/activity";
import { getStreakData } from "./DailyStreak";
import { addXp, earnFreezeIfNeeded, getFreezes, getXp, levelFromXp, missions, type Mission, xpIntoLevel } from "@/lib/gamification";

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function dayDiff(a: Date, b: Date) { return Math.floor((startOfDay(a).getTime()-startOfDay(b).getTime())/86400000); }

async function fetchActivity() { const { data, error } = await supabase.from("study_activity").select("id,set_id,kind,count,created_at,duration_seconds,meta").order("created_at", { ascending: false }).limit(1000); if (error) throw error; return (data ?? []) as Activity[]; }

export function ProgressionHub({ setId }: { setId?: string }) {
  const { data: allRows = [] } = useQuery({ queryKey: ["progression-activity"], queryFn: fetchActivity, staleTime: 30_000 });
  const rows = useMemo(() => setId ? allRows.filter((r) => r.set_id === setId) : allRows, [allRows, setId]);
  const [, refresh] = useState(0);
  useEffect(() => { const f=()=>refresh(x=>x+1); window.addEventListener("momentum_xp_updated",f); window.addEventListener("momentum_streak_updated",f); window.addEventListener("momentum_freeze_updated",f); return()=>{window.removeEventListener("momentum_xp_updated",f);window.removeEventListener("momentum_streak_updated",f);window.removeEventListener("momentum_freeze_updated",f)} },[]);
  const streak = getStreakData();
  // Award XP once for each logged study action, so XP reflects real studying rather than page views.
  useEffect(() => {
    if (!rows.length) return;
    try {
      const key = "momentum_xp_activity_ids_v1";
      const seen = new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]"));
      let earned = 0;
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const minutes = Math.max(0, Number(r.duration_seconds ?? 0) / 60);
        earned += r.kind === "session" ? 10 + Math.round(minutes) : r.kind === "flashcard" ? Math.min(40, r.count * 2) : (r.kind === "quiz" || r.kind === "adaptive") ? 20 : r.kind === "exam" || r.kind === "comprehensive" ? 35 : 5;
      }
      localStorage.setItem(key, JSON.stringify(Array.from(seen).slice(-2000)));
      if (earned) addXp(earned);
    } catch {}
  }, [rows]);
  const xp = getXp(); const lvl = levelFromXp(xp); const bar = xpIntoLevel(xp);
  const today = dayKey(new Date().toISOString());
  const todayRows = rows.filter(r => dayKey(r.created_at) === today);
  const minutesToday = todayRows.reduce((n,r)=>n + Number(r.duration_seconds ?? 0)/60,0);
  const sessionsToday = todayRows.filter(r=>r.kind === "session").reduce((n,r)=>n+r.count,0);
  const cardsToday = todayRows.filter(r=>r.kind === "flashcard").reduce((n,r)=>n+r.count,0);
  const quizzesToday = todayRows.filter(r=>r.kind === "quiz" || r.kind === "adaptive").reduce((n,r)=>n+r.count,0);
  const ms = missions({minutesToday,sessionsToday,cardsToday,quizzesToday});
  const completed = ms.filter(m=>m.done).length;
  const freezes = earnFreezeIfNeeded(streak.totalStudyMinutes);
  const days = useMemo(()=>Array.from({length:28},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(27-i)); const key=dayKey(d.toISOString()); return {key,count:rows.filter(r=>dayKey(r.created_at)===key).reduce((n,r)=>n+r.count,0)} }),[rows]);
  const records = useMemo(()=>({hours:Math.round((streak.totalStudyMinutes/60)*10)/10, sessions:streak.totalSessionsCompleted, streak:streak.longestStreak, cards:rows.filter(r=>r.kind==='flashcard').reduce((n,r)=>n+r.count,0)}),[rows,streak]);
  const upcomingXp = Math.max(0, bar.needed-bar.current);
  const completeMission = (m: Mission) => { if (!m.done) return; const key=`momentum_mission_${today}_${m.id}`; if (!localStorage.getItem(key)) { localStorage.setItem(key,"1"); addXp(m.xp); } };
  ms.forEach(m=>completeMission(m));

  return <section className="px-5 md:px-8 pt-6">
    <div className="grid xl:grid-cols-[1.15fr_1fr_1fr] gap-5">
      <div className="rounded-2xl p-5 bg-panel border border-line">
        <div className="flex justify-between gap-4"><div><p className="eyebrow text-cool2 flex items-center gap-2"><Zap className="size-3.5"/> Progression</p><h3 className="font-display text-2xl font-bold mt-1">Level {lvl}</h3></div><div className="size-11 rounded-xl bg-cool/10 grid place-items-center"><Trophy className="size-5 text-cool2"/></div></div>
        <p className="text-xs text-soft mt-1">{xp} XP earned · {upcomingXp} XP to Level {lvl+1}</p><div className="h-2 rounded-full bg-foreground/10 mt-4 overflow-hidden"><div className="h-full bg-progress rounded-full" style={{width:`${Math.round(bar.current/bar.needed*100)}%`}}/></div>
        <div className="grid grid-cols-2 gap-2 mt-4"><Stat icon={Flame} label="Best streak" value={`${records.streak}d`}/><Stat icon={Trophy} label="Study hours" value={`${records.hours}h`}/><Stat icon={Medal} label="Sessions" value={String(records.sessions)}/><Stat icon={Sparkles} label="Cards" value={String(records.cards)}/></div>
      </div>
      <div className="rounded-2xl p-5 bg-panel border border-line"><div className="flex items-center justify-between"><p className="eyebrow text-cool2 flex gap-2 items-center"><Target className="size-3.5"/> Daily missions</p><span className="text-xs font-semibold">{completed}/{ms.length}</span></div><div className="space-y-3 mt-4">{ms.map(m=><div key={m.id}><div className="flex justify-between gap-3 text-xs"><span className={m.done?"text-mint font-semibold":""}>{m.done?"✓ ":""}{m.label}</span><span className="text-soft">+{m.xp} XP</span></div><div className="h-1.5 rounded-full bg-foreground/10 mt-1.5 overflow-hidden"><div className="h-full bg-progress rounded-full" style={{width:`${Math.min(100,m.progress/m.target*100)}%`}}/></div></div>)}</div></div>
      <div className="rounded-2xl p-5 bg-panel border border-line"><div className="flex justify-between items-center"><p className="eyebrow text-cool2 flex gap-2 items-center"><Snowflake className="size-3.5"/> Streak protection</p><span className="text-xs font-bold">{freezes.available} freeze{freezes.available===1?'':'s'}</span></div><p className="text-sm font-semibold mt-3">Keep your momentum safe.</p><p className="text-xs text-soft mt-1">Earn 1 streak freeze for every 7 hours studied. A freeze protects one missed day.</p><div className="mt-4 p-3 rounded-xl bg-cool/5 border border-cool/20 flex items-center gap-3"><Snowflake className="size-5 text-cool2"/><div><p className="text-xs font-semibold">{freezes.available} available</p><p className="text-[10px] text-soft">{freezes.used} used lifetime</p></div></div></div>
    </div>
    <div className="rounded-2xl p-5 bg-panel border border-line mt-5"><div className="flex items-center justify-between"><div><p className="eyebrow text-cool2">28-day study heatmap</p><h3 className="font-display text-xl font-bold mt-1">Your consistency</h3></div><Gift className="size-5 text-cool2"/></div><div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5 mt-4">{days.map(d=><div key={d.key} title={`${d.key}: ${d.count} study actions`} className={`aspect-square rounded-[4px] border border-line/40 ${d.count===0?'bg-foreground/[0.03]':d.count<3?'bg-cool/20':d.count<8?'bg-cool/45':'bg-cool/80'}`}/>)}</div><div className="flex justify-between text-[10px] text-soft mt-2"><span>28 days ago</span><span>Today</span></div></div>
  </section>
}
function Stat({icon:Icon,label,value}:{icon:any;label:string;value:string}){return <div className="rounded-lg bg-foreground/5 p-2.5"><div className="flex items-center gap-1.5 text-soft"><Icon className="size-3"/><span className="text-[10px]">{label}</span></div><p className="font-display text-lg mt-0.5">{value}</p></div>}
