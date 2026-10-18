import { useServerFn } from "@tanstack/react-start";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BookOpen, FileText, GraduationCap, Loader2, MessageCircle, Sparkles, Layers, RefreshCw, Send, Link2, Unlink, BookMarked, LibraryBig, AlertTriangle, Trash2, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { StudySet } from "@/lib/queries";
import { readingAddDocument, readingDeleteDocument, readingAsk, readingGenerateCards, readingListSources, readingLinkSource, readingSaveCards, readingSummary, readingUnlinkSource, readingImplementIntoNotes, readingApplyNotesAdditions } from "@/lib/reading.functions";
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
  const implementNotesFn = useServerFn(readingImplementIntoNotes);
  const applyNotesFn = useServerFn(readingApplyNotesAdditions);
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
  const [notesAdditions, setNotesAdditions] = useState("");
  const [activeSummarySection, setActiveSummarySection] = useState(0);
  const [expandedSummarySections, setExpandedSummarySections] = useState<number[]>([]);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [summarySourceKey, setSummarySourceKey] = useState("all");
  const [completedSections, setCompletedSections] = useState<number[]>([]);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
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
  const summaryIsStale = Boolean(summary) && summarySourceKey !== sourceKey;
  const completedCount = completedSections.length;
  const hasReading = sources.some((s) => s.kind === "reading");
  const hasLecture = sources.some((s) => s.kind === "lecture");
  const readingCount = sources.filter((s) => s.kind === "reading").length;
  const lectureCount = sources.filter((s) => s.kind === "lecture").length;
  const summarySections = useMemo(() => {
    if (!summary.trim()) return [];
    const lines = summary.replace(/\r\n/g, "\n").split("\n");
    const sections: { title: string; body: string }[] = [];
    let currentTitle = "Overview";
    let currentBody: string[] = [];
    for (const line of lines) {
      const heading = line.match(/^#{1,3}\s+(.+?)\s*#*$/);
      if (heading) {
        if (currentBody.join("\n").trim() || sections.length === 0) sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
        currentTitle = heading[1].replace(/\*\*/g, "").trim();
        currentBody = [];
      } else currentBody.push(line);
    }
    if (currentBody.join("\n").trim()) sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
    return sections.filter(section => section.body || section.title !== "Overview");
  }, [summary]);
  const copySummary = async () => {
    try { await navigator.clipboard.writeText(summary); setCopiedSummary(true); window.setTimeout(() => setCopiedSummary(false), 1800); }
    catch { toast.error("Couldn't copy the study brief. Select the text and copy it instead."); }
  };

  const run = async <T,>(kind: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(kind);
    try { return await fn(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); return null; }
    finally { setBusy(null); }
  };
  const refreshSources = async () => {
    await qc.invalidateQueries({ queryKey: ["reading-companion-sources", set.id] });
  };
  const implementIntoNotes = async () => {
    const result = await run("implement-notes", () => implementNotesFn({ data: { setId: set.id } }));
    if (result) {
      setNotesAdditions(result.additions);
      if (!result.additions) toast.success(result.message);
      else toast.success("Review the proposed additions before applying them.");
    }
  };
  const applyNotesAdditions = async () => {
    if (!notesAdditions.trim()) return;
    const result = await run("apply-notes", () => applyNotesFn({ data: { setId: set.id, additions: notesAdditions } }));
    if (result) {
      toast.success(result.message);
      setNotesAdditions("");
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
    }
  };
  const makeSummary = async () => {
    const result = await run("summary", () => summaryFn({ data: { setId: set.id, sourceKey: selectedSourceKey } }));
    if (result) { setSummary(result.summary); setSummarySourceKey(sourceKey); setActiveSummarySection(0); setExpandedSummarySections([]); setCompletedSections([]); setShowAnswerKey(false); }
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
    const skipped = picked.filter((file) => !fileKind(file) || file.size > MAX_BYTES);
    if (skipped.length) {
      const details = skipped.map((file) => !fileKind(file)
        ? `${file.name}: unsupported file type`
        : `${file.name}: ${(file.size / (1024 * 1024)).toFixed(1)} MiB (limit 100 MiB)`).join("\n");
      toast.error(`Some files couldn't be added:\n${details}`, { duration: 8000 });
    }
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
          <div className="rounded-xl border border-line/70 p-4 space-y-3"><div className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-cool2"/> Assigned reading</div><p className="text-sm text-soft">{readingCount} reading source{readingCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft">Upload the textbook chapter or assigned reading. Momentum checks for usable body text and tries OCR when a PDF contains only page headings, rather than silently saving a nearly empty source. Your original lecture material stays separate.</p><label className={btnPrimary + " cursor-pointer inline-flex"}><FileText className="size-4"/>{uploadingReading ? "Processing reading…" : "Upload reading"}<input type="file" accept={ACCEPT} multiple className="sr-only" disabled={uploadingReading} onChange={(e) => { void uploadReadingFiles(e.currentTarget.files); e.currentTarget.value = ""; }}/></label>{uploadingReading && <p className="text-xs text-soft" aria-live="polite">{uploadMessage || "Extracting text…"}</p>}</div>
          <div className="rounded-xl border border-line/70 p-4"><div className="flex items-center gap-2 font-semibold"><GraduationCap className="size-4 text-mint"/> Lecture / primary material</div><p className="text-sm text-soft mt-2">{lectureCount} lecture source{lectureCount === 1 ? "" : "s"} available</p><p className="text-xs text-soft mt-1">The material uploaded when you created this Study Set is treated as the primary course source, alongside any lecture transcripts or connected lectures. If a file has only headings, re-upload a searchable/OCR PDF or a DOCX/TXT version for better results.</p></div>
        </div>
        <div className="rounded-xl border border-mint/30 bg-mint/[0.04] p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-mint"/> Implement into Notes</div>
          <p className="text-sm text-soft">Compare your reading PDFs with the existing notes and prepare only useful missing information. Existing notes are never replaced or deleted. Review the additions before saving.</p>
          <button type="button" className={btnPrimary} disabled={!!busy || !readingCount || sourcesQ.isError} onClick={() => void implementIntoNotes()}>{busy === "implement-notes" ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}Scan readings and prepare additions</button>
          {notesAdditions && <div className="space-y-3 border-t border-line/60 pt-3"><p className="text-xs text-soft">Preview — these additions will be merged without removing existing notes.</p><div className="max-h-[28rem] overflow-auto rounded-xl border border-line/70 bg-background/40 p-4"><div className="prose prose-sm dark:prose-invert max-w-none"><MarkdownContent>{notesAdditions}</MarkdownContent></div></div><div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void applyNotesAdditions()}>{busy === "apply-notes" ? <Loader2 className="size-4 animate-spin"/> : <Check className="size-4"/>}Add to Notes</button><button type="button" className={btnGhost} disabled={!!busy} onClick={() => setNotesAdditions("")}>Discard preview</button></div></div>}
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
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Sparkles className="size-5 text-cool2"/><h3 className="font-semibold">Study brief</h3></div><p className="text-sm text-soft">Build an active study session, not just a summary: compare the sources, mark sections as reviewed, attempt practice questions before revealing the key, and turn the hardest concepts into flashcards.</p><label className="block text-xs text-soft space-y-1">Use sources<select className={inputCls + " w-full sm:max-w-xl"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><button className={btnPrimary} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void makeSummary()}>{busy === "summary" ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}{summary ? "Refresh lecture guide" : "Explain my lecture using the reading"}</button>{summary && <section className="reading-output border-t border-line/60 pt-5 space-y-4" aria-label="Generated study brief">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="eyebrow text-cool2">Your study workspace</p><h4 className="font-display text-xl mt-1">Study brief, section by section</h4><p className="text-xs text-soft mt-1">Jump to a topic, compare the sources, then use the practice questions to check what you remember.</p></div><button type="button" className={btnGhost} onClick={() => void copySummary()}>{copiedSummary ? <Check className="size-4"/> : <Copy className="size-4"/>}{copiedSummary ? "Copied" : "Copy brief"}</button></div>
      {summaryIsStale && <div role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm">You changed the selected sources after this brief was generated. Refresh the brief to compare the current selection.</div>}
      <div className="rounded-xl border border-line/70 p-4 space-y-2"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Study session progress</p><p className="text-xs text-soft">Mark a section reviewed when you can explain it without looking.</p></div><span className="text-sm font-semibold tabular-nums">{completedCount}/{summarySections.length}</span></div><div className="h-2 rounded-full bg-foreground/10 overflow-hidden"><div className="h-full rounded-full bg-mint transition-all" style={{width: `${summarySections.length ? completedCount / summarySections.length * 100 : 0}%`}} /></div><div className="flex flex-wrap gap-2"><button type="button" className={btnGhost} onClick={() => setCompletedSections(summarySections.map((_, i) => i))}>Mark all reviewed</button><button type="button" className={btnGhost} onClick={() => setCompletedSections([])}>Reset progress</button></div></div>
      {summarySections.length > 1 && <nav className="flex gap-2 overflow-x-auto pb-2" aria-label="Study brief sections">{summarySections.map((section, index) => <button type="button" key={`${section.title}-${index}`} onClick={() => { setActiveSummarySection(index); document.getElementById(`reading-summary-section-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${activeSummarySection === index ? "border-cool/50 bg-cool/15 text-cool2" : "border-line/70 text-soft hover:bg-foreground/5"}`}>{section.title}</button>)}</nav>}
      <div className="space-y-3">{summarySections.map((section, index) => {
        const collapsible = section.body.length > 900;
        const expanded = !collapsible || expandedSummarySections.includes(index) || activeSummarySection === index;
        return <section id={`reading-summary-section-${index}`} key={`${section.title}-${index}`} className={`scroll-mt-6 rounded-xl border ${activeSummarySection === index ? "border-cool/40 bg-cool/[0.035]" : "border-line/70 bg-foreground/[0.015]"} p-4 md:p-5 space-y-3`}>
          <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3 min-w-0"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cool/10 text-cool2 text-sm font-bold">{index + 1}</span><div className="min-w-0"><h5 className="font-display text-lg leading-snug">{section.title}</h5><p className="text-xs text-soft mt-1">{index === 0 ? "Start here" : /clarif|compare|lecture adds|difference/i.test(section.title) ? "Connect and compare sources" : /question|practice|check understanding/i.test(section.title) ? "Test your recall" : /term|glossary/i.test(section.title) ? "Build your vocabulary" : /source|reference/i.test(section.title) ? "Trace claims to course material" : "Review this topic"}</p></div></div>{collapsible && <button type="button" className="p-1.5 rounded-md hover:bg-foreground/5 text-soft" aria-label={`${expanded ? "Collapse" : "Expand"} ${section.title}`} onClick={() => setExpandedSummarySections(old => expanded ? old.filter(n => n !== index) : [...old, index])}>{expanded ? <ChevronUp className="size-4"/> : <ChevronDown className="size-4"/>}</button>}</div>
          {expanded && <>{/answer key|answers/i.test(section.title) && <div className="mb-3"><button type="button" className={btnGhost} onClick={() => setShowAnswerKey(v => !v)}>{showAnswerKey ? "Hide answers" : "Reveal answer key"}</button></div>}{(!/answer key|answers/i.test(section.title) || showAnswerKey) ? <div className="prose prose-invert prose-sm max-w-none prose-headings:normal-case prose-headings:font-display prose-headings:tracking-normal prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:leading-7 prose-li:my-1 prose-strong:text-foreground prose-h2:mt-5 prose-h3:mt-4"><MarkdownContent>{section.body}</MarkdownContent></div> : <p className="text-sm text-soft">Try the questions first, then reveal the answers to check your understanding.</p>}</>}
          {index === summarySections.length - 1 && /question|practice|check understanding/i.test(section.title) && <p className="rounded-lg bg-mint/10 border border-mint/20 px-3 py-2 text-xs text-soft">Study tip: answer before revealing or checking the key. For any missed question, return to the relevant section and explain the idea in your own words.</p>}
          <label className="flex items-center gap-2 border-t border-line/50 pt-3 text-sm cursor-pointer"><input type="checkbox" checked={completedSections.includes(index)} onChange={e => setCompletedSections(old => e.target.checked ? [...old, index] : old.filter(n => n !== index))} />I can explain this section without looking</label>
        </section>;
      })}</div>
    </section>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><MessageCircle className="size-5 text-cool2"/><h3 className="font-semibold">Ask your course sources</h3></div><p className="text-sm text-soft">Ask why a lecture concept works, how the reading explains it, what the teacher added, or what to review. Momentum should distinguish source evidence from explanation and never invent page numbers.</p><form onSubmit={ask} className="space-y-2"><label className="block text-xs text-soft space-y-1">Answer from<select className={inputCls + " w-full"} value={sourceKey} onChange={e => setSourceKey(e.target.value)}><option value="all">All connected sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.title}</option>)}</select></label><div className="flex gap-2"><input value={question} onChange={e => setQuestion(e.target.value)} className={inputCls + " flex-1 min-w-0"} placeholder="e.g. Compare the reading with the lecture…"/><button disabled={!!busy || !question.trim() || !sources.length || sourcesQ.isError} className={btnPrimary}>{busy === "ask" ? <Loader2 className="size-4 animate-spin"/> : <Send className="size-4"/>}Ask</button></div></form>{answer && <article className="rounded-xl border border-line/70 bg-foreground/[0.025] p-4 md:p-5"><div className="prose prose-invert prose-sm max-w-none prose-headings:normal-case prose-headings:font-display prose-headings:tracking-normal prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:leading-7 prose-li:my-1 prose-strong:text-foreground prose-h2:mt-6 prose-h3:mt-4"><MarkdownContent>{answer}</MarkdownContent></div></article>}</div>
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Layers className="size-5 text-cool2"/><h3 className="font-semibold">Turn sources into flashcards</h3></div><p className="text-sm text-soft">Generate a preview from connected readings and lectures, select what to keep, and add it to this existing set. Duplicate questions are skipped, including duplicates within the preview.</p><button className={btnGhost} disabled={!!busy || !sources.length || sourcesQ.isError} onClick={() => void generate()}>{busy === "cards" ? <Loader2 className="size-4 animate-spin"/> : <Sparkles className="size-4"/>}Generate preview</button>{cards.length > 0 && <div className="space-y-3 border-t border-line/60 pt-4">{cards.map((c, i) => <label key={`${i}-${c.q}`} className="flex gap-3 rounded-lg border border-line/70 p-3 cursor-pointer"><input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(old => e.target.checked ? [...old, i] : old.filter(n => n !== i))} className="mt-1"/><span className="min-w-0"><span className="block text-sm font-semibold">{c.q}</span><span className="block text-sm text-soft mt-1">{c.a}</span>{c.t && <span className="block text-xs text-cool2 mt-1">{c.t}</span>}</span></label>)}<div className="flex flex-wrap items-center gap-2"><button className={btnPrimary} disabled={!!busy || !selected.length} onClick={() => void saveCards()}>{busy === "save" ? <Loader2 className="size-4 animate-spin"/> : <Layers className="size-4"/>}Add {selected.length} selected</button><button className={btnGhost} onClick={() => {setCards([]);setSelected([])}}>Discard preview</button></div></div>}</div>
  </div>;
}
