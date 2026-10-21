import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlarmClock, ArrowRight, Brain, CalendarClock, CheckCircle2, Clock3, Flame, GraduationCap, Loader2, RefreshCw, Target, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SetWithCards } from "@/lib/queries";

type Mode = "rescue" | "prepare" | "mastery";
type CardSignal = { id: string; topic: string | null; status: string; lapses: number | null; reps: number | null; due_at: string | null; interval_days: number | null };
type MistakeSignal = { topic: string | null; wrong_count: number | null; status: string | null };
type TopicSignal = { topic: string; score: number; due: number; lapses: number; newCards: number; mistakes: number };
type StudyAction = { title: string; detail: string; minutes: number; tab: "flashcards" | "quiz" | "exam" | "notes" | "mistakes" | "tutor" };

const MODES: { id: Mode; label: string; subtitle: string; icon: typeof AlarmClock }[] = [
  { id: "rescue", label: "Exam rescue", subtitle: "Exam soon or starting late", icon: AlarmClock },
  { id: "prepare", label: "Build confidence", subtitle: "Prepare over days or weeks", icon: CalendarClock },
  { id: "mastery", label: "Deep mastery", subtitle: "Go beyond memorization", icon: GraduationCap },
];
const dateValue = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rankTopics(cards: CardSignal[], mistakes: MistakeSignal[]): TopicSignal[] {
  const rows = new Map<string, TopicSignal>();
  const get = (name: string) => {
    const key = name.trim() || "General concepts";
    let row = rows.get(key);
    if (!row) { row = { topic: key, score: 0, due: 0, lapses: 0, newCards: 0, mistakes: 0 }; rows.set(key, row); }
    return row;
  };
  const now = Date.now();
  for (const card of cards) {
    const row = get(card.topic || "General concepts");
    const due = !card.due_at || Date.parse(card.due_at) <= now;
    const lapses = Math.max(0, card.lapses ?? 0);
    row.due += Number(due);
    row.lapses += lapses;
    row.newCards += Number((card.reps ?? 0) === 0 || card.status === "new");
    row.score += (due ? 1.5 : 0) + lapses * 2 + (((card.reps ?? 0) === 0 || card.status === "new") ? 1.25 : 0) + (card.status === "learning" ? 1 : 0);
  }
  for (const mistake of mistakes) {
    const row = get(mistake.topic || "General concepts");
    row.mistakes += Math.max(1, mistake.wrong_count ?? 1);
    row.score += Math.max(1, mistake.wrong_count ?? 1) * (mistake.status === "mastered" ? 0 : 2.5);
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic));
}

function buildActions(mode: Mode, daysLeft: number | null, minutes: number, topics: TopicSignal[], cardCount: number): StudyAction[] {
  const shortDeadline = daysLeft != null && daysLeft >= 0 && daysLeft <= 2;
  const firstTopic = topics[0]?.topic;
  const secondTopic = topics.find((t) => t.topic !== firstTopic)?.topic;
  const actions: StudyAction[] = mode === "rescue" || shortDeadline ? [
    { title: "Target the biggest knowledge gap", detail: firstTopic ? `Focus on ${firstTopic}; prioritize missed and not-yet-secure concepts.` : "Take a short mixed quiz to discover which concepts need attention.", minutes: Math.max(8, Math.round(minutes * 0.35)), tab: "quiz" },
    { title: "Recall the essentials", detail: "Review the weakest and due cards. Say the answer before revealing it; mark uncertain answers as Hard.", minutes: Math.max(5, Math.round(minutes * 0.3)), tab: "flashcards" },
    { title: "Check exam-style application", detail: "Finish with a timed practice exam or a short mixed set; review every mistake afterward.", minutes: Math.max(5, minutes - Math.max(8, Math.round(minutes * 0.35)) - Math.max(5, Math.round(minutes * 0.3))), tab: "exam" },
  ] : mode === "prepare" ? [
    { title: "Spaced review", detail: `${cardCount ? "Clear due cards first" : "Start with a short recall session"} and revisit anything you could not explain confidently.`, minutes: Math.round(minutes * 0.3), tab: "flashcards" },
    { title: "Repair a weak topic", detail: firstTopic ? `Work on ${firstTopic}${secondTopic ? `, then compare it with ${secondTopic}` : ""}. Explain why each answer is correct.` : "Use an adaptive quiz to establish a baseline.", minutes: Math.round(minutes * 0.4), tab: "quiz" },
    { title: "Interleave and retrieve", detail: "Mix several topics so you must decide which idea or method applies.", minutes: minutes - Math.round(minutes * 0.7), tab: "quiz" },
  ] : [
    { title: "Solve unfamiliar applications", detail: "Use a challenging mixed exam and explain the reasoning behind each answer.", minutes: Math.round(minutes * 0.45), tab: "exam" },
    { title: "Connect the concepts", detail: "Explain relationships, exceptions, and when similar concepts should not be confused.", minutes: Math.round(minutes * 0.3), tab: "tutor" },
    { title: "Cumulative retrieval", detail: "Review due cards from older topics and retest the hardest concepts without cues.", minutes: minutes - Math.round(minutes * 0.75), tab: "flashcards" },
  ];
  // Keep the session budget realistic even for very short study windows.
  let remaining = Math.max(10, minutes);
  return actions.map((action, i) => {
    const left = actions.length - i - 1;
    const allocation = i === actions.length - 1 ? Math.max(1, remaining) : Math.max(1, Math.min(action.minutes, remaining - left));
    remaining -= allocation;
    return { ...action, minutes: allocation };
  });
}

export function StudyEngine({ sets }: { sets: SetWithCards[] }) {
  const readySets = useMemo(() => sets.filter((s) => s.status === "ready"), [sets]);
  const [setId, setSetId] = useState(readySets[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("prepare");
  const [examDate, setExamDate] = useState(readySets[0]?.exam_date?.slice(0, 10) ?? "");
  const [minutes, setMinutes] = useState(30);
  const [cards, setCards] = useState<CardSignal[]>([]);
  const [mistakes, setMistakes] = useState<MistakeSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [built, setBuilt] = useState(false);
  const selected = readySets.find((s) => s.id === setId);
  const today = dateValue();
  const daysLeft = examDate ? Math.ceil((Date.parse(`${examDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000) : null;

  useEffect(() => {
    if (!readySets.length) return;
    const savedSet = readySets.find((s) => s.id === setId);
    if (savedSet?.exam_date && !examDate) setExamDate(savedSet.exam_date.slice(0, 10));
  }, [readySets, setId, examDate]);

  useEffect(() => {
    let active = true;
    async function loadSignals() {
      if (!setId) { setCards([]); setMistakes([]); return; }
      setLoading(true);
      const [cardResult, mistakeResult] = await Promise.all([
        supabase.from("flashcards").select("id,topic,status,lapses,reps,due_at,interval_days").eq("set_id", setId),
        supabase.from("mistakes").select("topic,wrong_count,status").eq("set_id", setId).neq("status", "mastered").limit(100),
      ]);
      if (active) {
        setCards((cardResult.data ?? []) as CardSignal[]);
        setMistakes((mistakeResult.data ?? []) as MistakeSignal[]);
        setLoading(false);
      }
    }
    void loadSignals();
    return () => { active = false; };
  }, [setId]);

  const topics = useMemo(() => rankTopics(cards, mistakes), [cards, mistakes]);
  const effectiveMode: Mode = daysLeft != null && daysLeft >= 0 && daysLeft <= 2 ? "rescue" : mode;
  const visibleActions = useMemo(() => buildActions(effectiveMode, daysLeft, minutes, topics, cards.length), [effectiveMode, daysLeft, minutes, topics, cards.length]);

  if (!readySets.length) return null;
  return <section className="rounded-2xl border border-cool/30 bg-panel p-5 md:p-6 space-y-5" aria-label="Personalized study engine">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cool/10 p-2 text-cool2"><Brain className="size-5" /></div>
        <div><p className="eyebrow text-cool2">Momentum Study Engine</p><h2 className="font-display text-xl md:text-2xl font-bold mt-1">Your next best study session</h2><p className="text-sm text-soft mt-1 max-w-2xl">A practical plan that adapts to your deadline, time available, due cards, and recurring mistakes. You can change modes whenever your goal changes.</p></div>
      </div>
      {loading && <Loader2 className="size-4 animate-spin text-cool2" aria-label="Loading study signals" />}
    </div>

    <div className="grid md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr] gap-3">
      <label className="text-xs text-soft">Study set<select value={setId} onChange={(e) => { setSetId(e.target.value); setBuilt(false); const next = readySets.find((s) => s.id === e.target.value); setExamDate(next?.exam_date?.slice(0, 10) ?? ""); }} className="block w-full mt-1 rounded-lg border border-line bg-accent px-3 py-2.5 text-sm text-foreground">{readySets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-xs text-soft">Exam / quiz date<input type="date" min={today} value={examDate} onChange={(e) => { setExamDate(e.target.value); setBuilt(false); }} className="block w-full mt-1 rounded-lg border border-line bg-accent px-3 py-2 text-sm text-foreground" /></label>
      <label className="text-xs text-soft">Time for this session<select value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); setBuilt(false); }} className="block w-full mt-1 rounded-lg border border-line bg-accent px-3 py-2.5 text-sm text-foreground"><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={20}>20 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option></select></label>
    </div>

    <div className="grid md:grid-cols-3 gap-3">{MODES.map((item) => { const Icon = item.icon; const active = (daysLeft != null && daysLeft >= 0 && daysLeft <= 2 ? "rescue" : mode) === item.id; return <button type="button" key={item.id} onClick={() => { setMode(item.id); setBuilt(false); }} aria-pressed={active} className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-cool2 bg-cool/10" : "border-line bg-accent hover:border-cool/50"}`}><span className="flex items-center gap-2"><Icon className="size-4 text-cool2" /><span className="font-semibold text-sm">{item.label}</span>{active && <CheckCircle2 className="size-4 ml-auto text-cool2" />}</span><span className="block text-xs text-soft mt-1">{item.subtitle}</span></button>; })}</div>

    <div className="rounded-xl border border-line bg-accent p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-cool2 font-semibold">Recommended session</p><h3 className="font-display text-lg font-bold mt-1">{effectiveMode === "rescue" ? "Prioritize, practice, correct" : effectiveMode === "prepare" ? "Build recall and confidence" : "Apply, connect, and retain"}</h3><p className="text-xs text-soft mt-1">{daysLeft == null ? "Add an exam date for deadline-aware recommendations." : daysLeft < 0 ? "That date has passed; choose a future date or use this as a review plan." : daysLeft === 0 ? "Your assessment is today. Focus on recall and correcting high-value gaps." : `${daysLeft} day${daysLeft === 1 ? "" : "s"} until your assessment.`}</p></div><button type="button" onClick={() => setBuilt(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold"><RefreshCw className="size-4" />{built ? "Refresh plan" : "Build my session"}</button></div>
      {built && <div className="mt-4 space-y-3">{visibleActions.map((action, index) => <div key={`${action.title}-${index}`} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-line bg-panel p-3"><div className="flex-1 min-w-0"><p className="text-sm font-semibold">{index + 1}. {action.title}</p><p className="text-xs text-soft mt-1">{action.detail}</p></div><span className="inline-flex items-center gap-1 text-xs text-soft whitespace-nowrap"><Clock3 className="size-3.5" />{action.minutes} min</span><Link to="/sets/$id" params={{ id: setId }} search={{ tab: action.tab } as never} className="inline-flex items-center justify-center gap-1 rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-cool2">Start <ArrowRight className="size-3.5" /></Link></div>)}</div>}
      {!built && <p className="text-xs text-soft mt-3">Build a session to see specific next steps. Momentum prioritizes overdue cards and concepts that repeatedly appear in your Mistake Bank.</p>}
    </div>

    <div className="grid sm:grid-cols-3 gap-3">
      <Signal label="Cards to review" value={String(cards.filter((c) => !c.due_at || Date.parse(c.due_at) <= Date.now()).length)} detail="Due or overdue" icon={Zap} />
      <Signal label="Open mistakes" value={String(mistakes.length)} detail="Concepts to repair" icon={Target} />
      <Signal label="Weakest topic" value={topics[0]?.topic ?? (cards.length ? "Still learning" : "Take a first quiz")} detail={topics[0] ? `${topics[0].lapses} lapses · ${topics[0].mistakes} mistake weight` : "Build a baseline"} icon={Flame} />
    </div>
    {selected && <div className="flex flex-wrap gap-2"><Link to="/sets/$id" params={{ id: selected.id }} search={{ tab: "quiz" } as never} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-cool2">Quick diagnostic quiz</Link><Link to="/sets/$id" params={{ id: selected.id }} search={{ tab: "mistakes" } as never} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-cool2">Review mistake notebook</Link><Link to="/sets/$id" params={{ id: selected.id }} search={{ tab: "exam" } as never} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-cool2">Simulate an exam</Link></div>}
  </section>;
}

function Signal({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof AlarmClock }) {
  return <div className="rounded-xl border border-line bg-accent p-3 min-w-0"><div className="flex items-center gap-2 text-cool2"><Icon className="size-4" /><span className="text-xs font-semibold">{label}</span></div><p className="font-display text-lg font-bold mt-2 truncate" title={value}>{value}</p><p className="text-xs text-soft mt-1 truncate" title={detail}>{detail}</p></div>;
}
