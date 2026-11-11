import { useServerFn } from "@tanstack/react-start";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Edit3, FileText, Headphones, Lightbulb, Loader2, Play, RefreshCw, Save, Square, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { prepareExplainPassageStream, regenerateNotes } from "@/lib/study.functions";
import { streamAiText, streamPreparedNotes } from "@/lib/ai-stream";
import type { StudySet } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { splitSpeechChunks } from "@/lib/speech-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { btnGhost } from "./ui";

type Mode =
  | "simple"
  | "university"
  | "example"
  | "detail"
  | "summary"
  | "analogy"
  | "compare"
  | "mistakes"
  | "practice";
const MODES: { v: Mode; l: string }[] = [
  { v: "simple", l: "Explain simply" },
  { v: "university", l: "Explain at university level" },
  { v: "example", l: "Give me an example" },
  { v: "analogy", l: "Use an analogy" },
  { v: "detail", l: "Explain in more detail" },
  { v: "compare", l: "Compare with related ideas" },
  { v: "mistakes", l: "Common mistakes" },
  { v: "practice", l: "Quick practice question" },
  { v: "summary", l: "Summarize this" },
];

/** Split markdown into an intro + one chunk per "## " section. */
function splitSections(md: string) {
  const parts = md.split(/\n(?=## )/);
  return parts.map((p) => p.trim()).filter(Boolean);
}


export function Notes({ set }: { set: StudySet }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const regen = useServerFn(regenerateNotes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState(set.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => { if (!editingNotes) setDraftNotes(set.notes ?? ""); }, [set.notes, editingNotes]);
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);
  const pdfsQ = useQuery({
    queryKey: ["notes-pdf", set.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("study_files").select("id,name,mime,path").eq("set_id", set.id).order("created_at");
      if (error) throw error;
      const rows = (data ?? []).filter((file) => file.mime?.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
      const signed = await Promise.all(rows.map(async (file) => {
        const { data: urlData, error: urlError } = await supabase.storage.from("study-files").createSignedUrl(file.path, 1800);
        if (urlError || !urlData?.signedUrl) return null;
        return { id: file.id, name: file.name, url: urlData.signedUrl };
      }));
      return signed.filter((file): file is NonNullable<typeof file> => Boolean(file));
    },
  });
  const [busy, setBusy] = useState(false);
  const [streamedNotes, setStreamedNotes] = useState("");
  const streamController = useRef<AbortController | null>(null);
  const speechController = useRef<AbortController | null>(null);
  const speechAudio = useRef<HTMLAudioElement | null>(null);
  const speechUrl = useRef<string | null>(null);
  const [speechState, setSpeechState] = useState<"idle" | "preparing" | "playing">("idle");
  const [speechProgress, setSpeechProgress] = useState(0);
  const stopSpeech = () => {
    speechController.current?.abort();
    speechController.current = null;
    speechAudio.current?.pause();
    speechAudio.current = null;
    if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
    speechUrl.current = null;
    setSpeechState("idle");
    setSpeechProgress(0);
  };
  useEffect(() => () => {
    const controller = speechController.current;
    speechController.current = null;
    controller?.abort();
    speechAudio.current?.pause();
    if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
  }, []);
  const listenToNotes = async () => {
    if (speechState !== "idle") { stopSpeech(); return; }
    if (!set.notes?.trim()) { toast.error("There are no saved notes to read aloud yet."); return; }
    const chunks = splitSpeechChunks(set.notes);
    if (!chunks.length) { toast.error("There isn't any readable note text to play."); return; }
    const controller = new AbortController();
    speechController.current = controller;
    setSpeechState("preparing");
    setSpeechProgress(0);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw new Error("Please sign in again.");
      for (let index = 0; index < chunks.length; index += 1) {
        if (controller.signal.aborted) break;
        setSpeechState("preparing");
        const response = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ text: chunks[index] }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error || `Speech generation failed (${response.status}).`);
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("Text-to-speech returned an empty audio file.");
        if (controller.signal.aborted) break;
        if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
        const url = URL.createObjectURL(blob);
        speechUrl.current = url;
        const audio = new Audio(url);
        speechAudio.current = audio;
        setSpeechState("playing");
        setSpeechProgress(index + 1);
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("error", onError);
            controller.signal.removeEventListener("abort", onAbort);
          };
          const onEnded = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("The generated audio couldn't be played.")); };
          const onAbort = () => { cleanup(); audio.pause(); resolve(); };
          audio.addEventListener("ended", onEnded, { once: true });
          audio.addEventListener("error", onError, { once: true });
          controller.signal.addEventListener("abort", onAbort, { once: true });
          audio.play().catch((error: unknown) => { cleanup(); reject(error); });
        });
        URL.revokeObjectURL(url);
        if (speechUrl.current === url) speechUrl.current = null;
        if (controller.signal.aborted) break;
      }
      if (!controller.signal.aborted) toast.success("Finished reading your notes.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && !controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Couldn't read your notes aloud.");
      }
    } finally {
      if (speechController.current === controller) {
        speechController.current = null;
        speechAudio.current = null;
        if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
        speechUrl.current = null;
        setSpeechState("idle");
        setSpeechProgress(0);
      }
    }
  };
  const run = async () => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    setBusy(true);
    try {
      const prepared = await regen({ data: { setId: set.id, prepareOnly: true } });
      if ("notesPrompts" in prepared && prepared.notesPrompts) {
        setStreamedNotes("");
        const notes = await streamPreparedNotes({ prepared, signal: controller.signal, onProgress: setStreamedNotes, onDelta: (chunk) => setStreamedNotes((old) => `${old}${chunk}`) });
        await regen({ data: { setId: set.id, generatedNotes: notes } });
      } else throw new Error("Couldn't prepare note generation.");
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
      toast.success("Notes regenerated");
    } catch (e) {
      toast.error(e instanceof DOMException && e.name === "AbortError" ? "Notes generation cancelled. Your saved notes are unchanged." : e instanceof Error ? e.message : "Failed");
    }
    streamController.current = null;
    setBusy(false);
  };
  const sections = set.notes ? splitSections(set.notes) : [];
  const saveEditedNotes = async () => {
    if (!draftNotes.trim()) { toast.error("Notes cannot be empty. You can replace them with your own content or regenerate them."); return; }
    setSavingNotes(true);
    try {
      const { error } = await supabase.from("study_sets").update({ notes: draftNotes.trim(), updated_at: new Date().toISOString() }).eq("id", set.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
      setEditingNotes(false);
      toast.success("Your notes were saved.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't save notes."); }
    finally { setSavingNotes(false); }
  };
  return (
    <div className="w-full max-w-none min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs text-soft inline-flex items-center gap-1.5">
          <Lightbulb className="size-3.5 text-cool2" /> Use "Explain" on any section for a simpler
          or deeper take.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={listenToNotes} disabled={!set.notes?.trim() || speechState !== "idle"} className={btnGhost}>
            {speechState === "idle" ? <Play className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
            {speechState === "idle" ? "Listen to notes" : speechState === "preparing" ? `Preparing ${speechProgress + 1}…` : `Playing ${speechProgress}…`}
          </button>
          {speechState !== "idle" && <button type="button" onClick={stopSpeech} className={btnGhost} aria-label="Stop reading notes"><Square className="size-4" /> Stop</button>}
          <button
            onClick={() =>
              navigate({ to: "/sets/$id", params: { id: set.id }, search: { tab: "audio" } })
            }
            className={btnGhost}
          >
            <Headphones className="size-4" /> Audio Study
          </button>
          {!editingNotes && <button type="button" onClick={() => { setDraftNotes(set.notes ?? ""); setEditingNotes(true); }} className={btnGhost}>
            <Edit3 className="size-4" /> Edit notes
          </button>}
          <button onClick={run} disabled={busy || editingNotes} className={btnGhost}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{" "}
            Regenerate
          </button>
        </div>
      </div>
      {busy && streamedNotes && <div className="rounded-xl border border-line bg-panel p-5 mb-4"><p className="eyebrow text-cool2 mb-2">Notes streaming from NVIDIA</p><div className="md text-sm"><MarkdownContent>{streamedNotes}</MarkdownContent></div><button type="button" onClick={() => streamController.current?.abort()} className="mt-3 text-xs text-soft underline">Cancel generation</button></div>}
      <div className={cn("grid gap-4 items-start", pdfsQ.data?.length ? "lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] 2xl:grid-cols-2" : "grid-cols-1")}>
        <section className={cn("min-w-0 rounded-2xl bg-panel border border-line/70 p-4 md:p-5", pdfsQ.data?.length && "lg:max-h-[82vh] lg:overflow-y-auto overscroll-contain")}>
          <div className="flex items-center justify-between gap-2 mb-3"><p className="eyebrow text-cool2">Study notes</p>{editingNotes && <div className="flex gap-2"><button type="button" onClick={() => { setEditingNotes(false); setDraftNotes(set.notes ?? ""); }} className={btnGhost}>Cancel</button><button type="button" onClick={saveEditedNotes} disabled={savingNotes} className={btnGhost}>{savingNotes ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save notes</button></div>}</div>
          {editingNotes ? <textarea aria-label="Edit study notes" value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} className="w-full min-h-[65vh] resize-y rounded-xl border border-line bg-ink2 p-4 text-sm leading-relaxed font-mono focus:outline-none focus:border-cool2" /> : <div className={cn("space-y-4 transition-opacity", busy && "opacity-50")}>
            {sections.length ? sections.map((sec, i) => <Section key={i} setId={set.id} md={sec} />) : <div className="rounded-xl bg-ink2 p-8 text-soft">No notes yet. Click regenerate to create them.</div>}
          </div>}
        </section>
        {Boolean(pdfsQ.data?.length) && <section className="min-w-0 rounded-2xl bg-panel border border-line/70 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="eyebrow text-cool2 inline-flex items-center gap-2"><FileText className="size-4" /> Original PDF</p><select aria-label="Choose uploaded PDF" value={selectedPdf ?? pdfsQ.data?.[0]?.id ?? ""} onChange={(event) => setSelectedPdf(event.target.value)} className="max-w-full rounded-lg border border-line bg-ink2 px-2 py-1.5 text-xs">{pdfsQ.data?.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select></div>
          {(() => { const file = pdfsQ.data?.find((item) => item.id === (selectedPdf ?? pdfsQ.data?.[0]?.id)); return file ? <iframe key={file.id} src={`${file.url}#toolbar=1&navpanes=1`} title={`PDF source: ${file.name}`} className="w-full h-[78vh] min-h-[620px] max-h-[1100px] rounded-xl border border-line bg-white" /> : <p className="text-sm text-soft">The uploaded PDF could not be opened.</p>; })()}
          <p className="text-xs text-soft mt-2">The PDF and notes stay in separate scroll areas on larger screens, so you can compare them without losing your place.</p>
        </section>}
      </div>
    </div>
  );
}

function Section({ setId, md }: { setId: string; md: string }) {
  const prepare = useServerFn(prepareExplainPassageStream);
  const [result, setResult] = useState<{ mode: Mode; text: string } | null>(null);
  const [loading, setLoading] = useState<Mode | null>(null);
  const ask = async (mode: Mode) => {
    setLoading(mode);
    try {
      const prompt = await prepare({ data: { setId, passage: md.slice(0, 8000), mode } });
      setResult({ mode, text: "" });
      const text = await streamAiText({ system: prompt.system, messages: prompt.messages, task: prompt.task, onDelta: (chunk) => setResult((old) => old?.mode === mode ? { ...old, text: old.text + chunk } : old) });
      setResult({ mode, text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't explain this");
    }
    setLoading(null);
  };
  return (
    <article className="group relative rounded-2xl bg-panel border border-line/70 p-6 md:p-8">
      <div className="absolute right-4 top-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!!loading}
            className="text-xs font-semibold inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cool/30 bg-cool/10 text-cool2 hover:bg-cool/20 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Lightbulb className="size-3.5" />
            )}{" "}
            Explain
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {MODES.map((m) => (
              <DropdownMenuItem key={m.v} onClick={() => ask(m.v)}>
                {m.l}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="md pr-24">
        <MarkdownContent>{md}</MarkdownContent>
      </div>
      {result && (
        <div className="mt-5 rounded-xl dpanel p-5 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow text-cool2">{MODES.find((m) => m.v === result.mode)?.l}</p>
            <button
              onClick={() => setResult(null)}
              className="text-soft hover:text-foreground"
              aria-label="Close explanation"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="md text-sm">
            <MarkdownContent>{result.text}</MarkdownContent>
          </div>
        </div>
      )}
    </article>
  );
}
