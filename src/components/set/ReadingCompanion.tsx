import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { BookOpen, FileText, GraduationCap, Loader2, MessageCircle, Sparkles, Layers, RefreshCw, Send, Link2, Unlink, BookMarked, LibraryBig, AlertTriangle } from "lucide-react";
import type { StudySet } from "@/lib/queries";
import { readingAsk, readingGenerateCards, readingListSources, readingLinkSource, readingSaveCards, readingSummary, readingUnlinkSource } from "@/lib/reading.functions";
import { btnGhost, btnPrimary, inputCls } from "./ui";

type DraftCard = { q: string; a: string; t?: string };
type SourceOption = { key: string; title: string; kind: "reading" | "lecture"; linked: boolean };

export function ReadingCompanion({ set }: { set: StudySet }) {
  const qc = useQueryClient();
  const summaryFn = useServerFn(readingSummary);
  const askFn = useServerFn(readingAsk);
  const generateFn = useServerFn(readingGenerateCards);
  const saveFn = useServerFn(readingSaveCards);
  const listFn = useServerFn(readingListSources);
  const linkFn = useServerFn(readingLinkSource);
  const unlinkFn = useServerFn(readingUnlinkSource);
  const [busy, setBusy] = useState<"summary" | "ask" | "cards" | "save" | "link" | string | null>(null);
  const [summary, setSummary] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [sourceKey, setSourceKey] = useState("all");
  const [sourceKind, setSourceKind] = useState<"set_material" | "lecture">("set_material");
  const [sourceSetId, setSourceSetId] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [showLinker, setShowLinker] = useState(false);
  const sourcesQ = useQuery({ queryKey: ["reading-companion-sources", set.id], queryFn: () => listFn({ data: { setId: set.id } }), retry: false });
  const sources = sourcesQ.data?.sources ?? [];
  const sets = sourcesQ.data?.sets ?? [];
  const lectures = sourcesQ.data?.lectures ?? [];
  const availableLectures = useMemo(() => lectures.filter((l) => l.setId === sourceSetId && l.hasContent), [lectures, sourceSetId]);
  const selectedSourceKey = sourceKey === "all" ? undefined : sourceKey;
  const hasReading = sources.some((s) => s.kind === "reading");
  const hasLecture = sources.some((s) => s.kind === "lecture");
  const readingCount = sources.filter((s) => s.kind === "reading").length;
  const lectureCount = sources.filter((s) => s.kind === "lecture").length;

  const run = async <T,>(kind: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(kind);
    try { return await fn(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); return null; }
    finally { setBusy(null); }
  };
  const refreshSources = async () => {
    await qc.invalidateQueries({ queryKey: ["reading-companion-sources", set.id] });
  };
  const makeSummary = async () => {
    const result = await run("summary", () => summaryFn({ data: { setId: set.id, sourceKey: selectedSourceKey } }));
    if (result) setSummary(result.summary);
  };
  const ask = async (e: FormEvent) => {
    e.preventDefault(); if (!question.trim()) return;
    const q = question.trim();
    const result = await run("ask", () => askFn({ data: { setId: set.id, question: q, sourceKey: selectedSourceKey } }));
    if (result) { setAnswer(result.answer); setQuestion(""); }
  };
  const generate = async () => {
    const result = await run("cards", () => generateFn({ data: { setId: set.id } }));
    if (result) { setCards(result.cards); setSelected(result.cards.map((_: DraftCard, i: number) => i)); }
  };
  const saveCards = async () => {
    const chosen = cards.filter((_, i) => selected.includes(i)); if (!chosen.length) return;
    const result = await run("save", () => saveFn({ data: { setId: set.id, cards: chosen } }));
    if (result) { toast.success(`${result.added} flashcards added${result.skipped ? ` · ${result.skipped} duplicates skipped` : ""}`); setCards([]); setSelected([]); await qc.invalidateQueries({ queryKey: ["cards", set.id] }); }
  };
  const linkSource = async () => {
    if (!sourceSetId) { toast.error("Choose a Study Set first."); return; }
    const result = await run("link", () => linkFn({ data: { targetSetId: set.id, sourceSetId, sourceKind, sourceLectureId: sourceKind === "lecture" ? lectureId || null : null } }));
    if (result) { toast.success(sourceKind === "lecture" ? "Lecture connected" : "Reading connected"); setShowLinker(false); setLectureId(""); await refreshSources(); }
  };
  const unlinkSource = async (source: SourceOption) => {
    const linkId = source.key.startsWith("linked-reading:") ? source.key.slice("linked-reading:".length) : source.key.startsWith("linked-lecture:") ? source.key.slice("linked-lecture:".length) : "";
    if (!linkId) return;
    const result = await run(`unlink:${linkId}`, () => unlinkFn({ data: { targetSetId: set.id, linkId } }));
    if (result) { if (sourceKey === source.key) setSourceKey("all"); toast.success("Source unlinked. Saved cards and progress were not changed."); await refreshSources(); }
  };

  return <div className="max-w-4xl space-y-5">
    <div className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-cool/15 p-3"><BookOpen className="size-6 text-cool2" /></div><div className="flex-1"><p className="eyebrow text-cool2">Reading & Lecture Companion</p><h2 className="font-display text-2xl uppercase mt-1">Learn from your course sources</h2><p className="text-sm text-soft mt-1">Connect readings and lectures to this existing Study Set. Your cards, quizzes, folders, and learning history are kept as they are.</p></div></div>
      {sourcesQ.isError ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm flex gap-2"><AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400"/><span>Source connections need the database migration <code>0011_reading_companion_sources.sql</code>. Apply the migration included in this ZIP, then reload this page. Your existing study data is not changed by the migration.</span></div> : <>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line/70 p-4"><div className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-cool2"/> Reading material</div><p className="text-sm text-soft mt-2">{readingCount} reading source{readingCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft mt-1">PDFs, DOCX textbook chapters, text and Markdown documents are supported through Materials. PDF page markers are preserved when extraction supplies page boundaries.</p></div>
          <div className="rounded-xl border border-line/70 p-4"><div className="flex items-center gap-2 font-semibold"><GraduationCap className="size-4 text-mint"/> Lecture sources</div><p className="text-sm text-soft mt-2">{lectureCount} lecture source{lectureCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft mt-1">Includes lectures already in this set and lectures connected from your other sets.</p></div>
        </div>
        <div className="rounded-xl border border-line/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="font-semibold flex items-center gap-2"><LibraryBig className="size-4 text-cool2"/> Connected sources</h3><p className="text-xs text-soft mt-1">A source can be reused across sets. Unlinking never deletes the original reading, lecture, cards, or progress.</p></div><button className={btnPrimary} onClick={() => setShowLinker(v => !v)}><Link2 className="size-4"/>{showLinker ? "Close" : "Connect source"}</button></div>
          {showLinker && <div className="rounded-lg bg-foreground/[0.03] border border-line/70 p-3 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-soft space-y-1 block">Source type<select className={inputCls + " w-full"} value={sourceKind} onChange={e => { const v = e.target.value as "set_material" | "lecture"; setSourceKind(v); setSourceSetId(""); setLectureId(""); }}><option value="set_material">Reading / Study Set material</option><option value="lecture">Lecture</option></select></label>
            <label className="text-xs text-soft space-y-1 block">From Study Set<select className={inputCls + " w-full"} value={sourceSetId} onChange={e => { setSourceSetId(e.target.value); setLectureId(""); }}><option value="">Choose a Study Set…</option>{sets.filter(s => sourceKind === "set_material" ? s.hasMaterial : lectures.some(l => l.setId === s.id && l.hasContent)).map(s => <option key={s.id} value={s.id}>{s.name}{s.subject ? ` · ${s.subject}` : ""}</option>)}</select></label></div>
            {sourceKind === "lecture" && <label className="text-xs text-soft space-y-1 block">Lecture<select className={inputCls + " w-full"} value={lectureId} onChange={e => setLectureId(e.target.value)}><option value="">Choose a lecture…</option>{availableLectures.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>}
            <div className="flex flex-wrap gap-2"><button className={btnPrimary} disabled={busy === "link" || !sourceSetId || (sourceKind === "lecture" && !lectureId)} onClick={() => void linkSource()}>{busy === "link" ? <Loader2 className="size-4 animate-spin"/> : <Link2 className="size-4"/>}Connect</button><button className={btnGhost} onClick={() => setShowLinker(false)}>Cancel</button></div>
          </div>}
          {sources.length ? <div className="space-y-2">{sources.map((source) => <div key={source.key} className="flex items-center gap-2 rounded-lg border border-line/50 px-3 py-2"><div className="rounded-md bg-cool/10 p-2">{source.kind === "lecture" ? <GraduationCap className="size-4 text-mint"/> : <BookMarked className="size-4 text-cool2"/>}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{source.title}</p><p className="text-xs text-soft">{source.linked ? "Connected from another Study Set" : "In this Study Set"}</p></div>{source.linked && <button aria-label={`Unlink ${source.title}`} title="Unlink source" className="p-2 rounded-md hover:bg-foreground/5 text-soft" disabled={busy === `unlink:${source.key.split(":").slice(1).join(":")}`} onClick={() => void unlinkSource(source)}><Unlink className="size-4"/></button>}</div>)}</div> : <p className="text-sm text-soft">No extracted reading text or lecture transcript yet. Add material in Materials or connect a source from another Study Set.</p>}
        </div>
      </>}
    </div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Sparkles className="size-5 text-cool2"/><h3 className="font-semibold">Study brief</h3></div><p className="text-sm text-soft">Create an overview with key concepts, terms, relationships, understanding checks, and source references. Choose one source or combine everything connected to this set.</p><label className="block text-xs text-soft space-y-1">Use sources<select className={inputCls + " w-full sm:max-w-xl"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><button className={btnPrimary} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void makeSummary()}>{busy === "summary" ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}{summary ? "Refresh study brief" : "Generate study brief"}</button>{summary && <div className="prose prose-invert prose-sm max-w-none border-t border-line/60 pt-4"><ReactMarkdown>{summary}</ReactMarkdown></div>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><MessageCircle className="size-5 text-cool2"/><h3 className="font-semibold">Ask your course sources</h3></div><p className="text-sm text-soft">Ask for explanations or comparisons. Answers are instructed to cite source names and existing page, slide, or section markers rather than inventing page numbers.</p><form onSubmit={ask} className="space-y-2"><label className="block text-xs text-soft space-y-1">Answer from<select className={inputCls + " w-full"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><div className="flex gap-2"><input value={question} onChange={e => setQuestion(e.target.value)} className={inputCls + " flex-1 min-w-0"} placeholder="e.g. Compare the reading with the lecture…"/><button disabled={!!busy || !question.trim() || !sources.length || sourcesQ.isError} className={btnPrimary}>{busy === "ask" ? <Loader2 className="size-4 animate-spin"/> : <Send className="size-4"/>}Ask</button></div></form>{answer && <div className="prose prose-invert prose-sm max-w-none border-t border-line/60 pt-4"><ReactMarkdown>{answer}</ReactMarkdown></div>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Layers className="size-5 text-cool2"/><h3 className="font-semibold">Turn sources into flashcards</h3></div><p className="text-sm text-soft">Generate a preview from connected readings and lectures, select what to keep, and add it to this existing set. Duplicate questions are skipped, including duplicates within the preview.</p><button className={btnGhost} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void generate()}>{busy === "cards" ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}Generate preview</button>{cards.length > 0 && <div className="space-y-3 border-t border-line/60 pt-4">{cards.map((c, i) => <label key={`${i}-${c.q}`} className="flex gap-3 rounded-lg border border-line/70 p-3 cursor-pointer"><input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(old => e.target.checked ? [...old, i] : old.filter(n => n !== i))} className="mt-1"/><span className="min-w-0"><span className="block text-sm font-semibold">{c.q}</span><span className="block text-sm text-soft mt-1">{c.a}</span>{c.t && <span className="block text-xs text-cool2 mt-1">{c.t}</span>}</span></label>)}<div className="flex flex-wrap items-center gap-2"><button className={btnPrimary} disabled={!!busy || !selected.length} onClick={() => void saveCards()}>{busy === "save" ? <Loader2 className="size-4 animate-spin"/> : <Layers className="size-4"/>}Add {selected.length} selected</button><button className={btnGhost} onClick={() => {setCards([]);setSelected([])}}>Discard preview</button></div></div>}</div>
  </div>;
}
