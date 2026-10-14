import { createFileRoute, Link } from "@tanstack/react-router";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, Clock3, FileText, FileUp, Loader2, Send, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ocrFile } from "@/lib/study.functions";
import { ACCEPT, MAX_BYTES, extractFile, fileKind } from "@/lib/extract";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { assignmentStep, type AssignmentStep } from "@/lib/writing.functions";
import { useAutosave } from "@/hooks/use-autosave";
import { PageHeader } from "@/components/PageHeader";
import { SaveStatus } from "@/components/SaveStatus";
import { Field, SetPicker } from "@/components/SetPicker";
import { btnGhost, btnPrimary, ErrorBox, inputCls } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/assignment/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Assignment — Momentum" },
      {
        name: "description",
        content:
          "Work through your assignment step by step: understand it, brainstorm, outline and get draft feedback.",
      },
      { property: "og:title", content: "Assignment — Momentum" },
      { property: "og:description", content: "Step-by-step assignment guidance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssignmentPage,
});

type Row = Tables<"assignments">;

function AssignmentPage() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["assignment", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("assignments").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Row;
    },
  });
  if (q.isLoading)
    return (
      <div className="p-8">
        <Loader2 className="size-6 animate-spin text-cool2" />
      </div>
    );
  if (!q.data)
    return (
      <div className="p-8">
        <ErrorBox msg="This assignment couldn't be found." />
      </div>
    );
  return <Editor row={q.data} />;
}

const STEPS: {
  k: Exclude<AssignmentStep, "feedback">;
  l: string;
  field: "understanding" | "brainstorm" | "outline";
  desc: string;
  result: string;
}[] = [
  { k: "understand", l: "1. Understand it", field: "understanding", desc: "Translate the teacher's instructions into plain language, identify requirements, and spot source restrictions.", result: "A clear assignment brief and a roadmap" },
  { k: "brainstorm", l: "2. Brainstorm", field: "brainstorm", desc: "Explore several possible directions, compare their strengths, and find evidence to investigate—without forcing a thesis too early.", result: "Options, questions, and evidence leads" },
  { k: "outline", l: "3. Outline", field: "outline", desc: "Turn your chosen direction—or a provisional example—into an ordered, section-by-section plan you can write from.", result: "A practical outline and drafting checklist" },
];

type AssignmentAttachment = {
  id: string;
  filename: string;
  category: "allowed-source" | "supporting-material";
  usageLimit: string;
  text: string;
  chars: number;
};
type AssignmentSourceBundle = { __momentumAssignmentSources: 1; notes: string; attachments: AssignmentAttachment[] };
const emptySourceBundle = (): AssignmentSourceBundle => ({ __momentumAssignmentSources: 1, notes: "", attachments: [] });
function parseSourceBundle(raw: string): AssignmentSourceBundle {
  try {
    const value = JSON.parse(raw);
    if (value?.__momentumAssignmentSources === 1 && Array.isArray(value.attachments)) {
      return { __momentumAssignmentSources: 1, notes: String(value.notes ?? ""), attachments: value.attachments.filter((x: any) => x && typeof x.filename === "string" && typeof x.text === "string") };
    }
  } catch { /* Older assignments store source notes as plain text. */ }
  return { ...emptySourceBundle(), notes: raw || "" };
}
function encodeSourceBundle(bundle: AssignmentSourceBundle) { return JSON.stringify(bundle); }

type StepTimeSuggestions = Record<"understand" | "brainstorm" | "outline", string>;

/** Lightweight, explainable estimate based on visible assignment complexity. These are optional planning hints, never timers or requirements. */
function getAssignmentTimeSuggestions(instructions: string): StepTimeSuggestions {
  const text = instructions.trim().replace(/\u2011/g, "-");
  const wordRange = text.match(/\b(\d[\d,]{2,5})\s*(?:-|–|—|to)\s*(\d[\d,]{2,5})\s*[-–—]?\s*words?\b/i);
  const singleWordCount = text.match(/\b(\d[\d,]{2,5})\s*[-–—]?\s*words?\b/i);
  const wordCountText = wordRange?.[2] || singleWordCount?.[1] || "0";
  const wordCount = Number(wordCountText.replace(/,/g, ""));
  const checklistItems = (text.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) || []).length;
  const complexity =
    (text.length > 2200 ? 2 : text.length > 800 ? 1 : 0) +
    (wordCount >= 1500 ? 2 : wordCount >= 700 ? 1 : 0) +
    (checklistItems >= 8 ? 1 : checklistItems >= 4 ? 0.5 : 0) +
    (/rubric|assessment criteria|multiple sources|citation|counterargument|research|presentation|deliverables/i.test(text) ? 1 : 0);
  if (!text) return { understand: "a few minutes", brainstorm: "as needed", outline: "as needed" };
  if (complexity >= 4) return { understand: "8–15 min", brainstorm: "15–25 min", outline: "15–30 min" };
  if (complexity >= 2) return { understand: "5–10 min", brainstorm: "10–15 min", outline: "10–20 min" };
  return { understand: "3–5 min", brainstorm: "5–10 min", outline: "5–10 min" };
}

function Editor({ row }: { row: Row }) {
  const qc = useQueryClient();
  const stepFn = useServerFn(assignmentStep);
  const ocr = useServerFn(ocrFile);
  const [uploadCategory, setUploadCategory] = useState<"instructions" | "allowed-source" | "supporting-material" | "draft">("instructions");
  const [usageLimit, setUsageLimit] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [f, setF] = useState({
    title: row.title,
    set_id: row.set_id,
    instructions: row.instructions,
    rubric: row.rubric,
    sources: row.sources,
    ideas: row.ideas,
    chosen: row.chosen,
    draft: row.draft,
  });
  const [out, setOut] = useState({
    understanding: row.understanding,
    brainstorm: row.brainstorm,
    outline: row.outline,
  });
  const [chat, setChat] = useState(
    (Array.isArray(row.chat) ? row.chat : []) as { role: string; content: string }[],
  );
  const [tab, setTab] = useState<"understanding" | "brainstorm" | "outline">("understanding");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const sourceBundle = parseSourceBundle(f.sources);
  const timeSuggestions = getAssignmentTimeSuggestions(f.instructions);
  const updateSourceBundle = (bundle: AssignmentSourceBundle) => set("sources", encodeSourceBundle(bundle));
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || uploadBusy) return;
    const selected = Array.from(files);
    const categoryForBatch = uploadCategory;
    const scopeForBatch = usageLimit.trim();
    setUploadBusy(true); setUploadError(null);
    let added = 0;
    const fileErrors: string[] = [];
    try {
      for (const file of selected) {
        if (!fileKind(file)) { fileErrors.push(`${file.name}: unsupported file type. Use PDF, DOCX, PPTX, TXT, Markdown, or PNG/JPG/WEBP images.`); continue; }
        if (file.size > MAX_BYTES) { fileErrors.push(`${file.name}: this file is over 100 MB. Split it into smaller files and try again.`); continue; }
        try {
          const text = (await extractFile(file, ocr, (m) => setUploadMessage(m))).trim();
          if (!text) throw new Error("No readable text was found. If this is a scanned PDF, try a clearer scan or upload the permitted pages separately.");
          if (categoryForBatch === "instructions") {
            setF((prev) => ({ ...prev, instructions: `${prev.instructions.trim()}${prev.instructions.trim() ? "\n\n" : ""}--- Uploaded assignment file: ${file.name} ---\n${text}` }));
          } else if (categoryForBatch === "draft") {
            setF((prev) => ({ ...prev, draft: `${prev.draft.trim()}${prev.draft.trim() ? "\n\n" : ""}--- Uploaded draft: ${file.name} ---\n${text}` }));
          } else {
            setF((prev) => {
              const bundle = parseSourceBundle(prev.sources);
              const attachment: AssignmentAttachment = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                filename: file.name,
                category: categoryForBatch,
                usageLimit: categoryForBatch === "allowed-source" ? scopeForBatch : "",
                text,
                chars: text.length,
              };
              return { ...prev, sources: encodeSourceBundle({ ...bundle, attachments: [...bundle.attachments, attachment] }) };
            });
          }
          added++;
        } catch (e) {
          fileErrors.push(`${file.name}: ${e instanceof Error ? e.message : "couldn't read this file."}`);
        }
      }
      if (added) toast.success(`Added ${added} file${added === 1 ? "" : "s"} to the assignment.`);
      if (fileErrors.length) setUploadError(fileErrors.join("\n"));
    } finally { setUploadBusy(false); setUploadMessage(""); }
  };

  const saveState = useAutosave(f, async (v) => {
    const { error } = await supabase
      .from("assignments")
      .update({
        ...v,
        title: v.title.trim() || "Untitled assignment",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["assignments"] });
  });

  const flush = async () => {
    const { error } = await supabase
      .from("assignments")
      .update({ ...f, title: f.title.trim() || "Untitled assignment", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error("Couldn't save your latest changes before generating. Check your connection and try again.");
  };

  const run = async (step: AssignmentStep) => {
    setBusy(step);
    setError(null);
    try {
      await flush();
      const r = await stepFn({
        data: { id: row.id, step, question: step === "feedback" ? question : undefined },
      });
      if (step === "feedback") {
        setChat((c) => [
          ...c,
          { role: "user", content: question || "How can I make this stronger?" },
          { role: "assistant", content: r.text },
        ]);
        setQuestion("");
      } else {
        const s = STEPS.find((x) => x.k === step)!;
        setOut((o) => ({ ...o, [s.field]: r.text }));
        setTab(s.field);
      }
    } catch (e) {
      setError(
        `This step didn't finish: ${e instanceof Error ? e.message : "please try again."} Check the save status before leaving this page.`,
      );
    }
    setBusy(null);
  };

  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title={f.title || "Assignment"}
        sub={
          <Link to="/assignment" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> All assignments
          </Link>
        }
        right={<SaveStatus state={saveState} />}
      />
      <div className="p-5 md:p-8 grid lg:grid-cols-2 gap-6 max-w-6xl">
        <section className="space-y-4">
          <label className="block text-sm">
            <span className="eyebrow text-soft">Title</span>
            <input
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls + " w-full mt-1.5"}
              maxLength={160}
            />
          </label>
          <SetPicker value={f.set_id} onChange={(v) => set("set_id", v)} />
          <div className="rounded-2xl border border-line/70 bg-panel p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-cool/10 p-2"><FileUp className="size-5 text-cool2" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Assignment materials</p>
                <p className="text-xs text-soft mt-1">Upload multiple files at once for any category, including PDFs, DOCX, PPTX, TXT, Markdown, and PNG/JPG/WEBP images. Each file can be up to 100 MB. Choose the category first; you can repeat uploads to add more files later or mix different file types.</p>
              </div>
            </div>
            <label className="block text-xs font-medium text-soft">What are you uploading?</label>
            <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value as typeof uploadCategory)} className={inputCls + " w-full"}>
              <option value="instructions">Assignment instructions / teacher guidelines</option>
              <option value="allowed-source">A source I am allowed or required to use</option>
              <option value="supporting-material">Class notes, slides, feedback or other helpful material</option>
              <option value="draft">My draft or partial work</option>
            </select>
            {uploadCategory === "allowed-source" && <div className="space-y-1.5">
              <label className="text-xs font-medium text-soft">Are there limits on what part of this source you may use? (optional)</label>
              <input value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} className={inputCls + " w-full"} placeholder="e.g. Chapter 4 only, PDF pages 82–96, or section 'Causes'" />
              <p className="text-xs text-soft">For books or long sources, specify the exact chapter, pages, section, or excerpt permitted by your teacher. The limit applies to every file in this upload batch; upload different ranges separately. For page ranges, specify PDF pages (for example, PDF pages 82–96). If you mean printed book page numbers that differ from the PDF, upload the permitted pages separately so Momentum can isolate them safely.</p>
            </div>}
            <label className={btnPrimary + " cursor-pointer inline-flex items-center gap-2 " + (uploadBusy ? "opacity-60 pointer-events-none" : "")}>
              {uploadBusy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              {uploadBusy ? (uploadMessage || "Reading files…") : "Choose files"}
              <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={uploadBusy} onChange={(e) => { void uploadFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
            </label>
            {uploadBusy && <p className="text-xs text-soft" aria-live="polite">Extracting text from your selected files. Large or scanned files may take longer.</p>}
            {uploadError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-line">{uploadError}</div>}
          </div>
          <Field label="Assignment instructions / teacher guidelines" value={f.instructions} onChange={(v) => set("instructions", v)} rows={7} placeholder="Paste the prompt exactly as given, or upload it above." />
          <div className="rounded-2xl border border-line/70 p-4 space-y-3">
            <div className="flex items-center gap-2"><BookOpen className="size-4 text-cool2" /><p className="font-semibold">Sources and supporting materials <span className="text-xs font-normal text-soft">· optional</span></p></div>
            <p className="text-xs text-soft">Upload as many allowed/required source files and supporting materials as you need, including PDFs, textbook excerpts, slides, notes, or teacher feedback. Use the upload category above to choose whether a batch is an allowed source or supporting material. Each file is kept separate by filename and type. This section is optional and can be completed later.</p>
            <Field label="Other source notes, links or citation details (optional)" value={sourceBundle.notes} onChange={(v) => updateSourceBundle({ ...sourceBundle, notes: v })} rows={3} placeholder="Paste source URLs, citation details, or notes about which sources are permitted." />
            {sourceBundle.attachments.length > 0 ? <div className="space-y-2">
              {sourceBundle.attachments.map((a) => <div key={a.id} className="rounded-xl border border-line/60 p-3 space-y-1.5">
                <div className="flex items-start gap-2"><FileText className="size-4 mt-0.5 text-cool2 shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-medium break-words">{a.filename}</p><p className="text-xs text-soft">{a.category === "allowed-source" ? "Allowed / required source" : "Supporting material"} · {a.chars.toLocaleString()} characters extracted</p></div><button type="button" aria-label={`Remove ${a.filename}`} className="rounded-md p-1 text-soft hover:text-destructive" onClick={() => updateSourceBundle({ ...sourceBundle, attachments: sourceBundle.attachments.filter((x) => x.id !== a.id) })}><Trash2 className="size-4" /></button></div>
                {a.usageLimit && <p className="text-xs"><span className="font-medium">Permitted portion:</span> {a.usageLimit}</p>}
              </div>)}
            </div> : <p className="text-xs text-soft">No source files added yet. This is optional if your assignment has no source restrictions or you haven't collected sources yet.</p>}
          </div>
          <Field label="Your own ideas so far (optional)" value={f.ideas} onChange={(v) => set("ideas", v)} rows={3} placeholder="Your thoughts, possible arguments, questions or a rough plan." />
          <Field label="Your draft or partial work (optional)" value={f.draft} onChange={(v) => set("draft", v)} rows={5} placeholder="Paste your draft here or upload it above. You can add this later." />
          <div className="rounded-xl bg-cool/5 border border-cool/15 p-3 text-xs text-soft flex gap-2"><ShieldCheck className="size-4 shrink-0 text-cool2" /><p>Only assignment instructions are needed to begin. Sources, your ideas and your draft are optional and can be added later. If your instructions contain a rubric, Momentum should identify it automatically; you don't need a separate rubric field.</p></div>
        </section>
        <section className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-line/70 bg-panel p-4 space-y-1">
            <p className="eyebrow text-cool2">Your assignment journey</p>
            <h2 className="font-display text-xl font-bold">One step at a time</h2>
            <p className="text-sm text-soft">Start with understanding, then explore ideas, then build an outline. Time suggestions adapt to the instructions and are only a guide—not a timer or requirement. Skip ahead or revisit any step whenever you need to. Each step saves its result so you can keep working later.</p>
          </div>
          <div className="grid gap-3">
            {STEPS.map((s, index) => (
              <article key={s.k} className={"rounded-2xl border p-4 space-y-3 " + (tab === s.field ? "border-cool2/60 bg-cool/5" : "border-line/70 bg-panel")}>
                <div className="flex items-start gap-3">
                  <div className={"rounded-xl p-2 shrink-0 " + (out[s.field] ? "bg-emerald-500/10 text-emerald-400" : "bg-cool/10 text-cool2")}>
                    {out[s.field] ? <CheckCircle2 className="size-5" /> : <span className="inline-flex size-5 items-center justify-center text-sm font-bold">{index + 1}</span>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{s.l.slice(3)}</h3>{out[s.field] && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">Generated</span>}</div>
                    <p className="text-sm text-soft">{s.desc}</p>
                    <p className="text-xs text-soft">{s.result}</p>
                    <p className="inline-flex items-center gap-1 text-xs text-soft"><Clock3 className="size-3.5" /> Suggested time: {timeSuggestions[s.k]} <span className="text-soft/80">(optional)</span></p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setTab(s.field); void run(s.k); }} disabled={!!busy || !f.instructions.trim()} className={btnPrimary}>
                    {busy === s.k ? <Loader2 className="size-4 animate-spin" /> : null}{out[s.field] ? "Regenerate this step" : "Generate this step"}
                  </button>
                  {out[s.field] && <button type="button" onClick={() => setTab(s.field)} className={btnGhost}>Read result</button>}
                </div>
              </article>
            ))}
          </div>
          {error && <ErrorBox msg={error} />}
          <div className="rounded-2xl border border-line/70 bg-panel overflow-hidden">
            <div className="border-b border-line/60 p-4 space-y-1">
              <p className="eyebrow text-cool2">Your workspace</p>
              <h3 className="font-semibold">{STEPS.find((s) => s.field === tab)?.l.slice(3) ?? "Assignment guide"}</h3>
              <p className="text-xs text-soft">Your generated result appears below. Headings and lists are formatted for scanning; use it as a working guide, not as a finished submission.</p>
              <div className="flex flex-wrap gap-1 pt-2">
                {STEPS.map((s) => (
                  <button type="button" key={s.field} onClick={() => setTab(s.field)} className={"rounded-lg px-3 py-1.5 text-sm " + (tab === s.field ? "bg-cool/15 text-cool2 font-semibold" : "text-soft hover:bg-foreground/5")}>
                    {s.l.slice(3)} {out[s.field] ? "✓" : ""}
                  </button>
                ))}
              </div>
            </div>
            <div className="md text-sm p-5 md:p-6 min-h-48 overflow-x-auto">
              {out[tab] ? (
                <MarkdownContent>{out[tab]!}</MarkdownContent>
              ) : (
                <div className="max-w-prose space-y-2 text-soft">
                  <p className="font-medium text-foreground">{!f.instructions.trim() ? "Add the assignment instructions to begin." : `Your ${STEPS.find((s) => s.field === tab)?.l.slice(3).toLowerCase()} guide will appear here.`}</p>
                  <p>{!f.instructions.trim() ? "Paste the prompt or upload your teacher's instructions in the materials panel." : STEPS.find((s) => s.field === tab)?.desc}</p>
                  <p className="text-xs">You can generate any step again as your ideas or materials change. Momentum should label verified information, recommendations, and anything you still need to check.</p>
                </div>
              )}
            </div>
          </div>
          <Field
            label="Your chosen argument / thesis (optional)"
            value={f.chosen}
            onChange={(v) => set("chosen", v)}
            rows={2}
            placeholder="Already have an argument? Add it here. If not, leave this blank and Momentum will help you explore a suitable direction in the outline."
          />
          <p className="text-xs text-soft -mt-2">You do not need to decide on your argument before starting. The outline can suggest a provisional direction based on your instructions and brainstorm; you can change it later.</p>
          <div className="rounded-2xl bg-panel border border-line/70 p-4 space-y-3">
            <p className="eyebrow text-cool2">4. Review and improve</p>
            <h3 className="font-semibold">Draft feedback</h3>
            <p className="text-sm text-soft">When you have a draft or even a partial section, ask for focused feedback. Momentum should point to specific places, prioritize the most important fixes, and give you actions to revise in your own words. You can upload or paste a draft in the materials panel; feedback is optional until you are ready.</p>
            {chat.map((m, i) => (
              <div
                key={i}
                className={
                  "md text-sm rounded-lg p-3 " +
                  (m.role === "user" ? "bg-cool/10" : "bg-foreground/5")
                }
              >
                <MarkdownContent>{m.content}</MarkdownContent>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about a specific section, argument, evidence, or requirement…"
                className={inputCls + " flex-1"}
              />
              <button
                aria-label="Get draft feedback"
                onClick={() => run("feedback")}
                disabled={!!busy || !f.draft.trim()}
                className={btnPrimary}
              >
                {busy === "feedback" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
