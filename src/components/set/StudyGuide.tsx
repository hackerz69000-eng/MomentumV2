import { useServerFn } from "@tanstack/react-start";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, CheckSquare, Headphones, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { generateGuide } from "@/lib/study.functions";
import { fetchSets, type StudySet } from "@/lib/queries";
import { btnGhost, btnPrimary, ErrorBox, inputCls } from "./ui";

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function StudyGuide({ set }: { set: StudySet }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gen = useServerFn(generateGuide);
  const setsQ = useQuery({ queryKey: ["sets"], queryFn: fetchSets });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testDate, setTestDate] = useState("");
  const [includedSetIds, setIncludedSetIds] = useState<string[]>([]);
  const otherSets = useMemo(
    () => (setsQ.data ?? []).filter((item) => item.id !== set.id && item.status !== "error" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)),
    [setsQ.data, set.id],
  );

  const toggleSet = (id: string, checked: boolean) => {
    setIncludedSetIds((old) => checked ? [...new Set([...old, id])] : old.filter((value) => value !== id));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await gen({ data: { setId: set.id, includedSetIds, testDate: testDate || null } });
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate your study guide");
    } finally {
      setBusy(false);
    }
  };

  if (busy)
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">Building your study guide</h2>
        <p className="text-soft text-sm mt-1">Organizing topics across your selected study sets{testDate ? ` for your ${new Date(`${testDate}T12:00:00`).toLocaleDateString()} test` : ""}. This can take 20–60 seconds.</p>
      </div>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <section className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-cool/15 p-3"><ScrollText className="size-6 text-cool2" /></div>
          <div className="flex-1">
            <p className="eyebrow text-cool2">Personalized exam prep</p>
            <h2 className="font-display text-2xl uppercase mt-1">Build your study guide</h2>
            <p className="text-sm text-soft mt-1">Choose your test date and every study set that could be covered. Momentum will combine the material into one organized guide with clear explanations, key terms, examples, comparisons, practice questions, and a last-minute review.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-5">
          <div className="space-y-2">
            <label htmlFor="study-guide-test-date" className="text-sm font-semibold flex items-center gap-2"><CalendarDays className="size-4 text-cool2"/> Test date <span className="text-soft font-normal">(optional)</span></label>
            <input id="study-guide-test-date" type="date" min={localDateInputValue()} value={testDate} onChange={(e) => setTestDate(e.target.value)} className={inputCls + " w-full"} />
            <p className="text-xs text-soft">If you add a date, the guide will include a time-aware review plan.</p>
          </div>
          <div className="space-y-2 min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2"><CheckSquare className="size-4 text-cool2"/> Topics and study sets</p>
            <div className="rounded-xl border border-line/70 divide-y divide-line/60 max-h-64 overflow-y-auto">
              <label className="flex items-start gap-3 p-3 bg-cool/5 cursor-default">
                <input type="checkbox" checked disabled className="mt-1 accent-cool2" />
                <span className="min-w-0"><span className="block text-sm font-semibold">{set.name} <span className="text-cool2 text-xs">Current set</span></span><span className="block text-xs text-soft mt-0.5">Always included</span></span>
              </label>
              {setsQ.isLoading && <p className="p-3 text-sm text-soft">Loading your other study sets…</p>}
              {!setsQ.isLoading && otherSets.length === 0 && <p className="p-3 text-sm text-soft">No other study sets available yet. Create another lecture-based set to combine more topics.</p>}
              {otherSets.map((item) => (
                <label key={item.id} className="flex items-start gap-3 p-3 hover:bg-panel2/50 cursor-pointer">
                  <input type="checkbox" checked={includedSetIds.includes(item.id)} disabled={!includedSetIds.includes(item.id) && includedSetIds.length >= 10} onChange={(e) => toggleSet(item.id, e.target.checked)} className="mt-1 accent-cool2" />
                  <span className="min-w-0"><span className="block text-sm font-medium break-words">{item.name}</span><span className="block text-xs text-soft mt-0.5">{item.subject || "General subject"}</span></span>
                </label>
              ))}
            </div>
            <p className="text-xs text-soft">{includedSetIds.length + 1} study set{includedSetIds.length ? "s" : ""} selected.</p>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void run()} className={btnPrimary} disabled={setsQ.isLoading}>
            {set.study_guide ? <RefreshCw className="size-4" /> : <ScrollText className="size-4" />}
            {set.study_guide ? "Regenerate Study Guide" : "Generate Study Guide"}
          </button>
          <span className="text-xs text-soft">Uses the material in the selected study sets, not just the current one.</span>
        </div>
      </section>

      {set.study_guide && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-soft">Last generated {set.study_guide_at ? new Date(set.study_guide_at).toLocaleString() : ""}</p>
          <button onClick={() => navigate({ to: "/sets/$id", params: { id: set.id }, search: { tab: "audio" } })} className={btnGhost}><Headphones className="size-4" /> Audio Study</button>
        </div>
        <article className="study-guide-content rounded-2xl bg-panel border border-line/70 p-5 sm:p-7 md:p-9 max-w-none">
          <MarkdownContent
            components={{
              h1: ({ children }) => <h1 className="font-display text-3xl md:text-4xl leading-tight tracking-wide mb-4 pb-4 border-b border-line/70">{children}</h1>,
              h2: ({ children }) => <h2 className="font-display text-xl md:text-2xl tracking-wide mt-10 mb-4 pb-3 border-b border-line/70 text-cool2 first:mt-0">{children}</h2>,
              h3: ({ children }) => <h3 className="font-semibold text-base md:text-lg mt-6 mb-3 text-foreground">{children}</h3>,
              h4: ({ children }) => <h4 className="font-semibold mt-5 mb-2">{children}</h4>,
              p: ({ children }) => <p className="text-sm md:text-[0.95rem] leading-7 text-soft my-3">{children}</p>,
              ul: ({ children }) => <ul className="my-4 space-y-2 pl-5 list-disc marker:text-cool2">{children}</ul>,
              ol: ({ children }) => <ol className="my-4 space-y-3 pl-6 list-decimal marker:font-semibold marker:text-cool2">{children}</ol>,
              li: ({ children }) => <li className="pl-1 text-sm md:text-[0.95rem] leading-7 text-soft">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              blockquote: ({ children }) => <blockquote className="my-5 rounded-r-xl border-l-4 border-cool2 bg-cool/10 px-4 py-3">{children}</blockquote>,
              hr: () => <hr className="my-8 border-line/70" />,
              a: ({ children, href }) => <a className="text-cool2 underline underline-offset-4" href={href} target="_blank" rel="noreferrer">{children}</a>,
            }}
          >
            {set.study_guide}
          </MarkdownContent>
        </article>
      </>}
    </div>
  );
}
