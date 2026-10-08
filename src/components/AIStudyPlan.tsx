import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { CalendarDays, Check, Loader2, Sparkles } from "lucide-react";
import type { SetWithCards } from "@/lib/queries";
import { generatePlan } from "@/lib/study.functions";
import { supabase } from "@/integrations/supabase/client";
import { setStats, type Attempt, type Flashcard, type Mistake } from "@/lib/stats";
import { toast } from "sonner";

type Day = { date: string; title: string; tasks: string[] };

export function AIStudyPlan({ sets }: { sets: SetWithCards[] }) {
  const ready = useMemo(() => sets.filter((s) => s.status === "ready"), [sets]);
  const [setId, setSetId] = useState(ready[0]?.id ?? sets[0]?.id ?? "");
  const [examDate, setExamDate] = useState(ready.find((s) => s.exam_date)?.exam_date?.slice(0, 10) ?? "");
  const [minutes, setMinutes] = useState(45);
  const [plan, setPlan] = useState<Day[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = sets.find((s) => s.id === setId);
  const today = new Date().toISOString().slice(0, 10);

  const build = async () => {
    if (!selected || !examDate) {
      toast.error("Choose a study set and exam date first.");
      return;
    }
    setBusy(true);
    try {
      const [{ data: cards }, { data: attempts }, { data: mistakes }] = await Promise.all([
        supabase.from("flashcards").select("*").eq("set_id", selected.id),
        supabase.from("quiz_attempts").select("*").eq("set_id", selected.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("mistakes").select("topic,wrong_count,status").eq("set_id", selected.id).neq("status", "mastered").limit(50),
      ]);
      const stats = setStats((cards ?? []) as Flashcard[], (attempts ?? []) as Attempt[], (mistakes ?? []) as Pick<Mistake, "topic" | "wrong_count" | "status">[]);
      const result = await generatePlan({
        data: {
          setId: selected.id,
          examDate,
          today,
          minutesPerDay: minutes,
          weakTopics: stats.weak.slice(0, 6).map((x) => x.topic),
        },
      });
      setPlan(result.plan as Day[]);
      setDone([]);
      toast.success("AI study plan created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the study plan.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => setDone((d) => d.includes(key) ? d.filter((x) => x !== key) : [...d, key]);

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cool/10 p-2 text-cool2"><Sparkles className="size-5" /></div>
        <div>
          <p className="eyebrow text-cool2">Plan</p>
          <h2 className="font-display text-xl font-bold mt-1">AI study plan</h2>
          <p className="text-sm text-soft mt-1">Momentum uses your weak topics, mistakes and study set material to build a realistic path to the exam.</p>
        </div>
      </div>
      <div className="grid md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 mt-5">
        <select value={setId} onChange={(e) => { setSetId(e.target.value); setPlan([]); }} className="rounded-lg border border-line bg-accent px-3 py-2 text-sm">
          {ready.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="text-xs text-soft">Exam date<input type="date" min={today} value={examDate} onChange={(e) => setExamDate(e.target.value)} className="block w-full mt-1 rounded-lg border border-line bg-accent px-3 py-2 text-sm text-foreground" /></label>
        <label className="text-xs text-soft">Minutes/day<select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="block w-full mt-1 rounded-lg border border-line bg-accent px-3 py-2 text-sm text-foreground"><option value={20}>20 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></label>
        <button onClick={build} disabled={busy} className="self-end rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarDays className="size-4" />}{busy ? "Building…" : "Build plan"}</button>
      </div>
      {plan.length > 0 && (
        <div className="mt-5 space-y-3 max-h-[560px] overflow-auto pr-1">
          {plan.map((day) => (
            <div key={day.date} className="rounded-xl border border-line bg-accent p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-soft">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p><h3 className="font-semibold mt-1">{day.title}</h3></div><span className="text-[10px] uppercase tracking-wider text-soft">{day.tasks.length} tasks</span></div>
              <div className="space-y-2 mt-3">{day.tasks.map((task, i) => { const key = `${day.date}-${i}`; const checked = done.includes(key); return <label key={key} className="flex items-start gap-3 text-sm cursor-pointer"><button type="button" onClick={() => toggle(key)} className={`mt-0.5 size-5 shrink-0 rounded-md border grid place-items-center ${checked ? "bg-primary border-primary text-primary-foreground" : "border-line"}`}>{checked && <Check className="size-3" />}</button><span className={checked ? "line-through text-soft" : ""}>{task}</span></label>; })}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
