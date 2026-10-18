import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Target, Brain, Trophy, Zap, CheckCircle2, Clock3, Sparkles, Swords, RotateCcw } from "lucide-react";
import type { SetWithCards } from "@/lib/queries";
import { computeProgress } from "@/lib/progress";
import { getSessionHistory, HISTORY_EVENT, type StudySessionRecord } from "./SessionHistory";
import { supabase } from "@/integrations/supabase/client";

type Mistake = { id: string; set_id: string; topic: string | null; question: string; wrong_count: number; status: string };
const PLAN_KEY = "momentum_study_plan_v1";
const MISTAKE_TAG_KEY = "momentum_mistake_tags_v1";
const PLAN_DONE_KEY = "momentum_study_plan_done_v1";
const categories = ["Concept gap", "Confused concepts", "Calculation error", "Misread question", "Forgot a fact", "Other"];

export function StudyStrategySuite({ sets }: { sets: SetWithCards[] }) {
  const [sessions, setSessions] = useState<StudySessionRecord[]>([]);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<{ title: string; tasks: { label: string; minutes: number; setId: string }[] } | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [challenge, setChallenge] = useState("sprint");
  const [examSet, setExamSet] = useState(sets.find(s => s.exam_date && Date.parse(s.exam_date) >= Date.now())?.id ?? sets[0]?.id ?? "");

  useEffect(() => {
    setSessions(getSessionHistory());
    const update = () => setSessions(getSessionHistory());
    window.addEventListener(HISTORY_EVENT, update);
    try { setTags(JSON.parse(localStorage.getItem(MISTAKE_TAG_KEY) || "{}")); } catch { setTags({}); }
    try { setPlan(JSON.parse(localStorage.getItem(PLAN_KEY) || "null")); } catch { setPlan(null); }
    try { setDone(JSON.parse(localStorage.getItem(PLAN_DONE_KEY) || "[]")); } catch { setDone([]); }
    supabase.from("mistakes").select("id,set_id,topic,question,wrong_count,status").neq("status", "mastered").order("wrong_count", { ascending: false }).limit(12).then(({ data }) => setMistakes((data ?? []) as Mistake[]));
    return () => window.removeEventListener(HISTORY_EVENT, update);
  }, []);

  const selected = sets.find(s => s.id === examSet) ?? sets[0];
  const progress = selected ? computeProgress(selected.flashcards, selected.quiz_score, selected.quiz_total) : null;
  const daysLeft = selected?.exam_date ? Math.ceil((Date.parse(selected.exam_date) - Date.now()) / 86400000) : null;
  const recent = sessions.filter(s => !s.id.startsWith("sess_demo_")).slice(0, 1)[0] ?? sessions[0];
  const minutes = (s: StudySessionRecord) => Number(String(s.duration).match(/[\d.]+/)?.[0] ?? 0);
  const focusScore = recent ? Math.max(0, Math.min(100, Math.round(45 + Math.min(minutes(recent), 60) * 0.55 + (/(flashcard|recall|quiz|exam)/i.test(recent.type) ? 18 : 8) - (minutes(recent) > 90 ? 12 : 0)))) : 0;
  const achievements = useMemo(() => {
    const totalMinutes = sessions.reduce((n, s) => n + minutes(s), 0);
    const totalSessions = sessions.filter(s => !s.id.startsWith("sess_demo_")).length;
    return [
      { title: "First Focus", detail: "Complete a recorded study session", unlocked: totalSessions >= 1 },
      { title: "Deep Work", detail: "Log a 45+ minute session", unlocked: sessions.some(s => minutes(s) >= 45) },
      { title: "Comeback", detail: "Improve a weak set to 70% mastery", unlocked: sets.some(s => computeProgress(s.flashcards, s.quiz_score, s.quiz_total).overall >= 70) },
      { title: "Scholar", detail: "Study for 10 total hours", unlocked: totalMinutes >= 600 },
      { title: "Exam Ready", detail: "Reach 90% set readiness", unlocked: sets.some(s => computeProgress(s.flashcards, s.quiz_score, s.quiz_total).overall >= 90) },
    ];
  }, [sessions, sets]);

  function generatePlan() {
    const ranked = sets.filter(s => s.status === "ready").map(s => ({ s, p: computeProgress(s.flashcards, s.quiz_score, s.quiz_total) })).sort((a,b) => a.p.overall - b.p.overall);
    const tasks = ranked.slice(0, 4).map(({s,p}) => ({ setId: s.id, label: `${s.name} · ${p.overall < 60 ? "strengthen fundamentals" : p.overall < 85 ? "active recall + review" : "maintenance review"}`, minutes: p.overall < 60 ? 25 : 15 }));
    if (!tasks.length) return;
    const next = { title: `Your ${tasks.reduce((n,t)=>n+t.minutes,0)}-minute plan`, tasks };
    setPlan(next); setDone([]); localStorage.setItem(PLAN_KEY, JSON.stringify(next)); localStorage.setItem(PLAN_DONE_KEY, "[]");
  }
  function toggleTask(label: string) { const next = done.includes(label) ? done.filter(x => x !== label) : [...done, label]; setDone(next); localStorage.setItem(PLAN_DONE_KEY, JSON.stringify(next)); }
  function setTag(id: string, value: string) { const next = { ...tags, [id]: value }; setTags(next); localStorage.setItem(MISTAKE_TAG_KEY, JSON.stringify(next)); }

  return <section className="px-5 md:px-8 pt-7 space-y-6" aria-label="Personalized study tools">
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-5">
      <div className="rounded-2xl border border-cool/30 bg-panel p-5 md:p-6">
        <div className="flex items-center gap-2 text-cool2"><CalendarDays className="size-5"/><p className="eyebrow">Exam command</p></div>
        <h3 className="font-display text-2xl font-bold mt-2">Prepare for the next test</h3>
        <div className="flex flex-wrap gap-3 mt-4">
          <select aria-label="Choose exam study set" value={examSet} onChange={e=>setExamSet(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-accent px-3 py-2 text-sm">{sets.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
          {selected && <Link to="/sets/$id" params={{id:selected.id}} search={{tab:"exam"} as never} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">Practice exam</Link>}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Metric label="Time left" value={daysLeft == null ? "Set date" : daysLeft < 0 ? "Past" : daysLeft === 0 ? "Today" : `${daysLeft} days`}/>
          <Metric label="Readiness" value={progress ? `${progress.overall}%` : "—"}/>
          <Metric label="Cards" value={selected ? String(selected.flashcards.length) : "—"}/>
        </div>
        <p className="text-xs text-soft mt-3">Readiness is based on the selected set’s current progress. Add an exam date in that set’s Plan to enable the countdown.</p>
      </div>
      <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
        <div className="flex items-center gap-2 text-cool2"><Target className="size-5"/><p className="eyebrow">Adaptive study plan</p></div>
        <div className="flex items-center justify-between gap-3 mt-2"><h3 className="font-display text-2xl font-bold">What to study today</h3><button onClick={generatePlan} className="shrink-0 rounded-lg border border-line bg-accent px-3 py-2 text-xs font-semibold hover:border-cool2">{plan ? "Refresh plan" : "Build my plan"}</button></div>
        {plan ? <><p className="text-sm text-soft mt-2">{plan.title} · prioritizes sets with the lowest progress.</p><div className="space-y-2 mt-3">{plan.tasks.map(t=><label key={t.label} className="flex items-center gap-3 rounded-lg bg-accent p-3 text-sm"><input type="checkbox" checked={done.includes(t.label)} onChange={()=>toggleTask(t.label)}/><span className={done.includes(t.label)?"line-through text-soft":""}>{t.label}</span><span className="ml-auto text-xs text-soft whitespace-nowrap">{t.minutes}m</span><Link to="/sets/$id" params={{id:t.setId}} search={{tab:"flashcards"} as never} className="text-cool2 text-xs font-semibold">Start</Link></label>)}</div><p className="text-xs text-soft mt-2">{done.length} of {plan.tasks.length} complete. Your plan is saved on this device.</p></> : <p className="text-sm text-soft mt-3">Build a practical plan from your current study sets and progress.</p>}
      </div>
    </div>

    <div className="grid xl:grid-cols-2 gap-5">
      <div className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center gap-2 text-cool2"><Brain className="size-5"/><p className="eyebrow">Mistake intelligence</p></div><h3 className="font-display text-xl font-bold mt-2">Turn misses into a plan</h3>
        {mistakes.length ? <div className="space-y-3 mt-4">{mistakes.slice(0,5).map(m=><div key={m.id} className="rounded-lg bg-accent p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium">{m.topic || m.question}</p><span className="text-xs text-soft whitespace-nowrap">missed {m.wrong_count}×</span></div><p className="text-xs text-soft mt-1 line-clamp-2">{m.question}</p><select aria-label={`Mistake type for ${m.question}`} value={tags[m.id] || ""} onChange={e=>setTag(m.id,e.target.value)} className="mt-2 rounded-md border border-line bg-panel px-2 py-1.5 text-xs"><option value="">Classify this mistake…</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>)}</div> : <p className="text-sm text-soft mt-3">No open mistakes found. Complete a quiz or exam and missed questions will appear here.</p>}
      </div>
      <div className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-center gap-2 text-cool2"><Target className="size-5"/><p className="eyebrow">Mastery map</p></div><h3 className="font-display text-xl font-bold mt-2">Your subjects at a glance</h3>
        <div className="space-y-4 mt-4">{sets.filter(s=>s.status === "ready").map(s=>{const p=computeProgress(s.flashcards,s.quiz_score,s.quiz_total); return <div key={s.id}><div className="flex justify-between gap-3 text-sm"><span className="font-medium truncate">{s.name}</span><span className="text-cool2 font-semibold">{p.overall}%</span></div><div className="h-2 rounded-full bg-foreground/10 mt-2 overflow-hidden"><div className="h-full rounded-full bg-cool2" style={{width:`${p.overall}%`}}/></div><p className="text-xs text-soft mt-1">{p.overall < 60 ? "Needs attention" : p.overall < 85 ? "Building confidence" : "Strong — maintain with review"} · {p.mastered}/{p.total} cards mastered</p></div>})}</div>
      </div>
    </div>

    <div className="grid xl:grid-cols-3 gap-5">
      <div className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2 text-cool2"><Sparkles className="size-5"/><p className="eyebrow">Session recap</p></div><h3 className="font-display text-xl font-bold mt-2">Your latest focus</h3>{recent ? <><p className="text-sm font-medium mt-3">{recent.topic}</p><div className="grid grid-cols-2 gap-2 mt-3"><Metric label="Duration" value={`${minutes(recent)} min`}/><Metric label="Focus score" value={`${focusScore}/100`}/></div><p className="text-xs text-soft mt-3">{recent.type} · {new Date(recent.timestamp).toLocaleString()}</p><p className="text-sm mt-3">{focusScore >= 85 ? "Excellent focused session. Keep the rhythm." : focusScore >= 65 ? "Solid work. A short retrieval session can reinforce it." : "Try a focused 25-minute block next time."}</p></> : <p className="text-sm text-soft mt-3">Finish a session to see your recap and focus score.</p>}</div>
      <div className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2 text-cool2"><Swords className="size-5"/><p className="eyebrow">Challenge mode</p></div><h3 className="font-display text-xl font-bold mt-2">Pick a challenge</h3><div className="space-y-2 mt-3">{[{id:"sprint",label:"10-minute recall sprint",desc:"Fast active recall"},{id:"weak",label:"Weak-topic boss battle",desc:"Target your lowest-progress set"},{id:"perfect",label:"Perfect round",desc:"Aim for a clean quiz"}].map(c=><button key={c.id} onClick={()=>setChallenge(c.id)} className={`w-full text-left rounded-lg border p-3 ${challenge===c.id?"border-cool2 bg-cool/10":"border-line bg-accent"}`}><span className="block text-sm font-semibold">{c.label}</span><span className="text-xs text-soft">{c.desc}</span></button>)}</div>{selected && <Link to="/sets/$id" params={{id:(challenge==="weak" ? [...sets].sort((a,b)=>computeProgress(a.flashcards,a.quiz_score,a.quiz_total).overall-computeProgress(b.flashcards,b.quiz_score,b.quiz_total).overall)[0]?.id : selected.id) ?? selected.id}} search={{tab:challenge==="sprint"?"recall":"quiz"} as never} className="mt-3 inline-flex rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold">Start challenge</Link>}</div>
      <div className="rounded-2xl border border-line bg-panel p-5"><div className="flex items-center gap-2 text-cool2"><Trophy className="size-5"/><p className="eyebrow">Achievement cabinet</p></div><h3 className="font-display text-xl font-bold mt-2">Milestones</h3><div className="space-y-2 mt-3">{achievements.map(a=><div key={a.title} className="flex gap-3 items-center rounded-lg bg-accent p-3"><div className={`rounded-full p-2 ${a.unlocked?"bg-amber-400/15 text-amber-300":"bg-foreground/5 text-soft"}`}>{a.unlocked?<CheckCircle2 className="size-4"/>:<Trophy className="size-4"/>}</div><div><p className="text-sm font-semibold">{a.title}</p><p className="text-xs text-soft">{a.detail}</p></div><span className="ml-auto text-[10px] uppercase tracking-wider">{a.unlocked?"Unlocked":"Locked"}</span></div>)}</div></div>
    </div>
  </section>;
}
function Metric({label,value}:{label:string;value:string}) { return <div className="rounded-lg bg-foreground/5 py-3 px-2 text-center"><p className="text-[10px] uppercase tracking-wider text-soft">{label}</p><p className="font-display text-lg font-bold mt-1">{value}</p></div>; }
