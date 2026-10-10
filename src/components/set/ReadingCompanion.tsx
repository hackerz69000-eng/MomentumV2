import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { BookOpen, FileText, GraduationCap, Loader2, MessageCircle, Sparkles, Layers, RefreshCw, Send, Link2, Unlink, BookMarked, LibraryBig, AlertTriangle, Trash2 } from "lucide-react";
import type { StudySet } from "@/lib/queries";
import { readingAddDocument, readingDeleteDocument, readingAsk, readingGenerateCards, readingListSources, readingLinkSource, readingSaveCards, readingSummary, readingUnlinkSource } from "@/lib/reading.functions";
import { btnGhost, btnPrimary, inputCls } from "./ui";
import { ACCEPT, MAX_BYTES, extractFile, fileKind } from "@/lib/extract";
import { ocrFile } from "@/lib/study.functions";
import { storeOriginal } from "@/lib/extract";
import { useAuth } from "@/hooks/use-auth";

type DraftCard = { q: string; a: string; t?: string };
type SourceOption = { key: string; title: string; kind: "reading" | "lecture"; linked: boolean };

export function ReadingCompanion({ set }: { set: StudySet }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const summaryFn = useServerFn(readingSummary);
  const addReadingFn = useServerFn(readingAddDocument);
  const deleteReadingFn = useServerFn(readingDeleteDocument);
  const ocrFn = useServerFn(ocrFile);
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
  const [uploadingReading, setUploadingReading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
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
  const uploadReadingFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files);
    const valid = picked.filter((file) => fileKind(file) && file.size <= MAX_BYTES);
    if (valid.length !== picked.length) toast.error("Some files were skipped. Use PDF, DOCX, PPTX, TXT, Markdown, or supported images under 20 MB.");
    if (!valid.length) return;
    setUploadingReading(true);
    let added = 0;
    try {
      for (const file of valid) {
        setUploadMessage(`Reading ${file.name}…`);
        const text = await extractFile(file, ocrFn, setUploadMessage);
        if (!text.trim() || text.trim().length < 20) {
          toast.error(`Couldn't extract enough readable text from ${file.name}.`);
          continue;
        }
        await addReadingFn({ data: { setId: set.id, filename: file.name, contentText: text.slice(0, 500000) } });
        if (user?.id) {
          try { const stored = await storeOriginal(user.id, set.id, file, text.length); if (!stored) toast.error(`${file.name} text was saved, but its original file could not be stored for download.`); }
          catch { toast.error(`${file.name} text was saved, but its original file could not be stored for download.`); }
        }
        added += 1;
      }
      if (added) {
        toast.success(`${added} reading${added === 1 ? "" : "s"} added to this Study Set. Your original lecture material was left unchanged.`);
        await refreshSources();
        await qc.invalidateQueries({ queryKey: ["files", set.id] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add reading material.");
    } finally {
      setUploadingReading(false);
      setUploadMessage("");
    }
  };

  const deleteReading = async (source: SourceOption) => {
    if (!source.key.startsWith("reading-doc:")) return;
    const readingId = source.key.slice("reading-doc:".length);
    const result = await run(`delete-reading:${readingId}`, () => deleteReadingFn({ data: { setId: set.id, readingId } }));
    if (result) {
      if (sourceKey === source.key) setSourceKey("all");
      toast.success("Reading removed from this Study Set. Your lecture material and saved study progress are unchanged.");
      await refreshSources();
    }
  };

  const unlinkSource = async (source: SourceOption) => {
    const linkId = source.key.startsWith("linked-reading:") ? source.key.slice("linked-reading:".length) : source.key.startsWith("linked-lecture:") ? source.key.slice("linked-lecture:".length) : "";
    if (!linkId) return;
    const result = await run(`unlink:${linkId}`, () => unlinkFn({ data: { targetSetId: set.id, linkId } }));
    if (result) { if (sourceKey === source.key) setSourceKey("all"); toast.success("Source unlinked. Saved cards and progress were not changed."); await refreshSources(); }
  };

  return <div className="max-w-4xl space-y-5">
    <div className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-cool/15 p-3"><BookOpen className="size-6 text-cool2" /></div><div className="flex-1"><p className="eyebrow text-cool2">Reading & Lecture Companion</p><h2 className="font-display text-2xl uppercase mt-1">Understand your lecture better</h2><p className="text-sm text-soft mt-1">Your lecture or primary course material stays at the center of this Study Set. Add the assigned reading here and Momentum will use it to clarify lecture concepts without replacing or mixing up your original material.</p></div></div>
      {sourcesQ.isError ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm flex gap-2"><AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400"/><span>Reading Companion needs database migrations <code>0011_reading_companion_sources.sql</code> and <code>0012_reading_documents.sql</code>. Apply both migrations included in this ZIP, then reload this page. Your existing study data is not changed by the migration.</span></div> : <>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line/70 p-4 space-y-3"><div className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-cool2"/> Assigned reading</div><p className="text-sm text-soft">{readingCount} reading source{readingCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft">Upload the textbook chapter or assigned reading for this lecture. It is stored separately, so it will not overwrite or blend into your original lecture upload.</p><label className={btnPrimary + " cursor-pointer inline-flex"}><FileText className="size-4"/>{uploadingReading ? "Processing reading…" : "Upload reading"}<input type="file" accept={ACCEPT} multiple className="sr-only" disabled={uploadingReading} onChange={(e) => { void uploadReadingFiles(e.currentTarget.files); e.currentTarget.value = ""; }}/></label>{uploadingReading && <p className="text-xs text-soft" aria-live="polite">{uploadMessage || "Extracting text…"}</p>}</div>
          <div className="rounded-xl border border-line/70 p-4"><div className="flex items-center gap-2 font-semibold"><GraduationCap className="size-4 text-mint"/> Lecture / primary material</div><p className="text-sm text-soft mt-2">{lectureCount} lecture source{lectureCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft mt-1">The material uploaded when you created this Study Set is treated as the primary course source, alongside any lecture transcripts or connected lectures.</p></div>
        </div>
        <div className="rounded-xl border border-line/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="font-semibold flex items-center gap-2"><LibraryBig className="size-4 text-cool2"/> Connected sources</h3><p className="text-xs text-soft mt-1">A source can be reused across sets. Unlinking never deletes the original reading, lecture, cards, or progress.</p></div><button className={btnPrimary} onClick={() => setShowLinker(v => !v)}><Link2 className="size-4"/>{showLinker ? "Close" : "Connect source"}</button></div>
          {showLinker && <div className="rounded-lg bg-foreground/[0.03] border border-line/70 p-3 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-soft space-y-1 block">Source type<select className={inputCls + " w-full"} value={sourceKind} onChange={e => { const v = e.target.value as "set_material" | "lecture"; setSourceKind(v); setSourceSetId(""); setLectureId(""); }}><option value="set_material">Reading / Study Set material</option><option value="lecture">Lecture</option></select></label>
            <label className="text-xs text-soft space-y-1 block">From Study Set<select className={inputCls + " w-full"} value={sourceSetId} onChange={e => { setSourceSetId(e.target.value); setLectureId(""); }}><option value="">Choose a Study Set…</option>{sets.filter(s => sourceKind === "set_material" ? s.hasMaterial : lectures.some(l => l.setId === s.id && l.hasContent)).map(s => <option key={s.id} value={s.id}>{s.name}{s.subject ? ` · ${s.subject}` : ""}</option>)}</select></label></div>
            {sourceKind === "lecture" && <label className="text-xs text-soft space-y-1 block">Lecture<select className={inputCls + " w-full"} value={lectureId} onChange={e => setLectureId(e.target.value)}><option value="">Choose a lecture…</option>{availableLectures.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>}
            <div className="flex flex-wrap gap-2"><button className={btnPrimary} disabled={busy === "link" || !sourceSetId || (sourceKind === "lecture" && !lectureId)} onClick={() => void linkSource()}>{busy === "link" ? <Loader2 className="size-4 animate-spin"/> : <Link2 className="size-4"/>}Connect</button><button className={btnGhost} onClick={() => setShowLinker(false)}>Cancel</button></div>
          </div>}
          {sources.length ? <div className="space-y-2">{sources.map((source) => <div key={source.key} className="flex items-center gap-2 rounded-lg border border-line/50 px-3 py-2"><div className="rounded-md bg-cool/10 p-2">{source.kind === "lecture" ? <GraduationCap className="size-4 text-mint"/> : <BookMarked className="size-4 text-cool2"/>}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{source.title}</p><p className="text-xs text-soft">{source.linked ? "Connected from another Study Set" : "In this Study Set"}</p></div>{source.linked && <button aria-label={`Unlink ${source.title}`} title="Unlink source" className="p-2 rounded-md hover:bg-foreground/5 text-soft" disabled={!!busy} onClick={() => void unlinkSource(source)}><Unlink className="size-4"/></button>}{source.key.startsWith("reading-doc:") && <button aria-label={`Remove ${source.title}`} title="Remove reading" className="p-2 rounded-md hover:bg-foreground/5 text-soft" disabled={!!busy} onClick={() => void deleteReading(source)}><Trash2 className="size-4"/></button>}</div>)}</div> : <p className="text-sm text-soft">No course text is available yet. Your original lecture material appears here when it has extractable text; you can add the assigned reading above or connect another source.</p>}
        </div>
      </>}
    </div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Sparkles className="size-5 text-cool2"/><h3 className="font-semibold">Study brief</h3></div><p className="text-sm text-soft">Start with the lecture material, then use the reading to explain difficult ideas, define unfamiliar terms, and identify what the reading adds or does not cover. Source references are included when available.</p><label className="block text-xs text-soft space-y-1">Use sources<select className={inputCls + " w-full sm:max-w-xl"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><button className={btnPrimary} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void makeSummary()}>{busy === "summary" ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}{summary ? "Refresh lecture guide" : "Explain my lecture using the reading"}</button>{summary && <div className="prose prose-invert prose-sm max-w-none border-t border-line/60 pt-4"><ReactMarkdown>{summary}</ReactMarkdown></div>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><MessageCircle className="size-5 text-cool2"/><h3 className="font-semibold">Ask your course sources</h3></div><p className="text-sm text-soft">Ask why a lecture concept works, how the reading explains it, what the teacher added, or what to review. Momentum should distinguish source evidence from explanation and never invent page numbers.</p><form onSubmit={ask} className="space-y-2"><label className="block text-xs text-soft space-y-1">Answer from<select className={inputCls + " w-full"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><div className="flex gap-2"><input value={question} onChange={e => setQuestion(e.target.value)} className={inputCls + " flex-1 min-w-0"} placeholder="e.g. Compare the reading with the lecture…"/><button disabled={!!busy || !question.trim() || !sources.length || sourcesQ.isError} className={btnPrimary}>{busy === "ask" ? <Loader2 className="size-4 animate-spin"/> : <Send className="size-4"/>}Ask</button></div></form>{answer && <div className="prose prose-invert prose-sm max-w-none border-t border-line/60 pt-4"><ReactMarkdown>{answer}</ReactMarkdown></div>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Layers className="size-5 text-cool2"/><h3 className="font-semibold">Turn sources into flashcards</h3></div><p className="text-sm text-soft">Generate a preview from connected readings and lectures, select what to keep, and add it to this existing set. Duplicate questions are skipped, including duplicates within the preview.</p><button className={btnGhost} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void generate()}>{busy === "cards" ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}Generate preview</button>{cards.length > 0 && <div className="space-y-3 border-t border-line/60 pt-4">{cards.map((c, i) => <label key={`${i}-${c.q}`} className="flex gap-3 rounded-lg border border-line/70 p-3 cursor-pointer"><input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(old => e.target.checked ? [...old, i] : old.filter(n => n !== i))} className="mt-1"/><span className="min-w-0"><span className="block text-sm font-semibold">{c.q}</span><span className="block text-sm text-soft mt-1">{c.a}</span>{c.t && <span className="block text-xs text-cool2 mt-1">{c.t}</span>}</span></label>)}<div className="flex flex-wrap items-center gap-2"><button className={btnPrimary} disabled={!!busy || !selected.length} onClick={() => void saveCards()}>{busy === "save" ? <Loader2 className="size-4 animate-spin"/> : <Layers className="size-4"/>}Add {selected.length} selected</button><button className={btnGhost} onClick={() => {setCards([]);setSelected([])}}>Discard preview</button></div></div>}</div>
  </div>;
}
