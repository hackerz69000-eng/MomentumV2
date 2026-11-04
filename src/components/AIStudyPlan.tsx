import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Loader2, Sparkles } from "lucide-react";
import type { SetWithCards } from "@/lib/queries";
import { generatePlan, type PlanDay } from "@/lib/study.functions";
import { streamAiJson } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { setStats, type Attempt, type Flashcard, type Mistake } from "@/lib/stats";
import { toast } from "sonner";

type Day = { date: string; title: string; tasks: string[] };

const localDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function AIStudyPlan({ sets }: { sets: SetWithCards[] }) {
  const ready = useMemo(() => sets.filter((s) => s.status === "ready"), [sets]);
  const generate = useServerFn(generatePlan);
  const [setId, setSetId] = useState(ready[0]?.id ?? sets[0]?.id ?? "");
  const [examDate, setExamDate] = useState(ready.find((s) => s.exam_date)?.exam_date?.slice(0, 10) ?? "");
  const [minutes, setMinutes] = useState(45);
  const [plan, setPlan] = useState<Day[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamedPlan, setStreamedPlan] = useState("");
  const streamController = useRef<AbortController | null>(null);
  const selected = sets.find((s) => s.id === setId);
  const today = localDateInputValue();

  const build = async () => {
    if (!selected || !examDate) {
      toast.error("Choose a study set and exam date first.");
      return;
    }
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    setBusy(true);
    try {
      const [{ data: cards }, { data: attempts }, { data: mistakes }] = await Promise.all([
        supabase.from("flashcards").select("*").eq("set_id", selected.id),
        supabase.from("quiz_attempts").select("*").eq("set_id", selected.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("mistakes").select("topic,wrong_count,status").eq("set_id", selected.id).neq("status", "mastered").limit(50),
      ]);
      const stats = setStats((cards ?? []) as Flashcard[], (attempts ?? []) as Attempt[], (mistakes ?? []) as Pick<Mistake, "topic" | "wrong_count" | "status">[]);
      const input = { setId: selected.id, examDate, today, minutesPerDay: minutes, weakTopics: stats.weak.slice(0, 6).map((x) => x.topic) };
      const prepared = await generate({ data: { ...input, prepareOnly: true } });
      if (!("system" in prepared) || !prepared.system || !Array.isArray(prepared.messages)) throw new Error("Couldn't prepare the study plan.");
      setStreamedPlan("");
      const days = await streamAiJson({ system: prepared.system, messages: prepared.messages, signal: controller.signal, onDelta: (chunk) => setStreamedPlan((old) => old + chunk), validate: (value) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { days?: unknown }).days)) throw new Error("The study plan response was not valid.");
        const result = (value as { days: unknown[] }).days.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({ date: String(item["date"] ?? ""), title: String(item["title"] ?? ""), tasks: Array.isArray(item["tasks"]) ? item["tasks"].map(String).slice(0, 6) : [] })).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.title && item.tasks.length);
        if (!result.length) throw new Error("Could not create a usable study plan. Please try again.");
        return result as PlanDay[];
      }});
      const result = await generate({ data: { ...input, generatedPlan: JSON.stringify({ days }) } });
      if (!("plan" in result)) throw new Error("The study plan couldn't be finalized.");
      setPlan(result.plan as Day[]);
      setDone([]);
      toast.success("AI study plan created.");
    } catch (e) {
      toast.error(e instanceof DOMException && e.name === "AbortError" ? "Plan generation cancelled. Nothing was saved." : e instanceof Error ? e.message : "Couldn't create the study plan.");
    } finally {
      streamController.current = null;
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
      {busy && streamedPlan && <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-accent p-3 text-xs text-soft">{streamedPlan}</pre>}
      {busy && <button type="button" onClick={() => streamController.current?.abort()} className="mt-2 text-xs text-soft underline">Cancel plan generation</button>}
      {busy && <button type="button" onClick={() => streamController.current?.abort()} className="mt-2 text-xs text-soft underline">Cancel plan generation</button>}
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
