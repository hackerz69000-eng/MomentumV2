import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FileText, Upload, Loader2, X, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { processSet, ocrFile } from "@/lib/study.functions";
import { ACCEPT, MAX_BYTES, extractFile, fileKind, storeOriginal } from "@/lib/extract";
import { cn } from "@/lib/utils";
import { fetchStudyFolders, createStudyFolder, type StudyFolder } from "@/lib/folders";

export const Route = createFileRoute("/_authenticated/sets/new")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create study set — Momentum" },
      {
        name: "description",
        content:
          "Upload PDF, Word, PowerPoint or text files to generate notes, flashcards and quizzes.",
      },
      { property: "og:title", content: "Create study set — Momentum" },
      { property: "og:description", content: "Build a new AI study set from your school files." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewSet,
});

const inputCls =
  "w-full bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60";

function NewSet() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const process = useServerFn(processSet);
  const ocr = useServerFn(ocrFile);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [extracted, setExtracted] = useState<{ file: File; chars: number }[] | null>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [stage, setStage] = useState<null | "reading" | "generating">(null);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [newFolder, setNewFolder] = useState("");

  useEffect(() => {
    fetchStudyFolders().then(setFolders).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load folders"));
  }, []);

  const extract = async () => {
    if (!files.length) {
      toast.error("Choose at least one file");
      return;
    }
    setStage("reading");
    const parts: string[] = [];
    const meta: { file: File; chars: number }[] = [];
    for (const [idx, f] of files.entries()) {
      try {
        const t = await extractFile(f, ocr, (m) =>
          setProgressMsg(files.length > 1 ? `${m} (${idx + 1}/${files.length})` : m),
        );
        if (t) parts.push(files.length > 1 ? `=== ${f.name} ===\n${t}` : t);
        meta.push({ file: f, chars: t.length });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Couldn't read ${f.name}`);
      }
    }
    setStage(null);
    const material = parts.join("\n\n").trim();
    if (!material) {
      toast.error(
        "Couldn't find readable text in those files. Try clearer photos or another format.",
      );
      return;
    }
    setText(material);
    setExtracted(meta);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!user) return;
    if (mode === "pdf" && !extracted) {
      await extract();
      return;
    }

    try {
      if (!folderId) {
        toast.error("Choose an existing folder or create a new one before creating this study set.");
        return;
      }
      const material = text.trim();
      if (material.length < 30) {
        toast.error("Please add study material or upload a document to proceed.");
        return;
      }

      setStage("generating");

      // Create the real Supabase study set first. This keeps the set ID used by
      // Quiz, Exam, Recall, Tutor, Notes and Flashcards consistent everywhere.
      const { data: sbData, error: insertError } = await supabase
        .from("study_sets")
        .insert({
          user_id: user.id,
          name: name.trim(),
          subject: subject.trim(),
          description: description.trim(),
          custom_instructions: instructions.trim().slice(0, 2000),
          folder_id: folderId,
          material_text: material,
          material_source: mode,
          material_filename:
            mode === "pdf"
              ? files.map((f) => f.name).join(", ").slice(0, 300)
              : null,
          status: "processing",
        })
        .select("id")
        .single();

      if (insertError || !sbData?.id) {
        throw new Error(insertError?.message || "Couldn't create the study set.");
      }

      const targetId = sbData.id;

      // Keep every uploaded file attached to the same study set.
      if (mode === "pdf" && extracted?.length) {
        const stored = await Promise.allSettled(
          extracted.map((m) => storeOriginal(user.id, targetId, m.file, m.chars)),
        );
        const failed = stored.filter((r) => r.status === "rejected").length;
        if (failed) {
          console.warn(`${failed} original file(s) could not be stored.`);
        }
      }

      // Gemini generates the notes first, then flashcards from those notes.
      await process({ data: { setId: targetId } });

      toast.success("Study set created.");
      qc.invalidateQueries({ queryKey: ["sets"] });
      navigate({ to: "/sets/$id", params: { id: targetId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setStage(null);
    }
  };

  if (stage) {
    return (
      <main className="flex-1 grid place-items-center p-8">
        <div className="text-center max-w-sm animate-in fade-in">
          <div className="relative size-20 mx-auto">
            <div className="absolute inset-0 rounded-full bg-cool/30 blur-xl animate-pulse" />
            <div className="relative size-20 rounded-full dpanel grid place-items-center">
              <Loader2 className="size-8 animate-spin text-cool2" />
            </div>
          </div>
          <h2 className="font-display text-3xl uppercase mt-6">
            {stage === "reading" ? "Reading your files" : "Building your study set"}
          </h2>
          <p className="text-soft text-sm mt-2">
            {stage === "reading"
              ? progressMsg || "Extracting text…"
              : "Writing notes and generating flashcards. This usually takes 20–60 seconds."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <header className="px-5 md:px-8 py-5 border-b border-line/60 bg-ink/60 backdrop-blur-xl">
        <h1 className="font-display text-2xl md:text-3xl tracking-wide uppercase">
          Create study set
        </h1>
        <p className="text-sm text-soft">Add your material and we'll do the rest.</p>
      </header>
      <form onSubmit={submit} className="p-5 md:p-8 max-w-3xl space-y-6">
        <div className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
          <p className="eyebrow text-cool2">Details</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-sm">Name</span>
              <input
                required
                className={inputCls}
                placeholder="Cellular Respiration"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm">Subject</span>
              <input
                className={inputCls}
                placeholder="Biology"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          </div>
          <label className="space-y-1.5 block">
            <span className="text-sm">Description</span>
            <textarea
              rows={2}
              className={inputCls}
              placeholder="What does this set cover?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-sm">
              Custom instructions <span className="text-soft">(optional)</span>
            </span>
            <textarea
              rows={2}
              maxLength={2000}
              className={inputCls}
              placeholder={`e.g. "Keep everything at a Grade 12 level" or "Focus heavily on formulas"`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
        </div>

        <div className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
          <div><p className="eyebrow text-cool2">Folder</p><p className="text-sm text-soft mt-1">Every new study set lives inside a folder so your subjects stay organized.</p></div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <select required value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputCls}>
              <option value="">Choose a folder…</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={80} placeholder="New folder name" className={inputCls} />
              <button type="button" disabled={!newFolder.trim()} onClick={async () => { try { const f = await createStudyFolder(newFolder); setFolders((x) => [...x, f].sort((a,b) => a.name.localeCompare(b.name))); setFolderId(f.id); setNewFolder(""); toast.success(`Created ${f.name}`); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't create folder"); } }} className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-brand text-ink px-3 py-2 text-sm font-semibold disabled:opacity-50"><FolderPlus className="size-4" />Create</button>
            </div>
          </div>
          {!folders.length && <p className="text-xs text-soft">No folders yet — create your first one above.</p>}
        </div>

        <div className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
          <p className="eyebrow text-cool2">Study material</p>
          <div className="flex gap-1 p-1 rounded-lg bg-ink2 w-fit">
            {(["pdf", "text"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-4 py-2 text-sm font-semibold rounded-md flex items-center gap-2",
                  mode === m
                    ? "bg-cool/20 text-foreground border border-cool/30"
                    : "text-soft border border-transparent",
                )}
              >
                {m === "pdf" ? <Upload className="size-4" /> : <FileText className="size-4" />}
                {m === "pdf" ? "Upload files" : "Paste text"}
              </button>
            ))}
          </div>
          {mode === "pdf" && extracted ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  Review the extracted text from {extracted.length} file
                  {extracted.length === 1 ? "" : "s"} — edit anything that looks wrong.
                </p>
                <button
                  type="button"
                  onClick={() => setExtracted(null)}
                  className="text-xs text-soft hover:text-foreground"
                >
                  Change files
                </button>
              </div>
              <textarea
                rows={16}
                className={inputCls + " font-mono text-xs leading-relaxed"}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="text-xs text-soft">
                {text.length.toLocaleString()} characters · original files will be saved with the
                set
              </p>
            </div>
          ) : mode === "pdf" ? (
            <div className="space-y-3">
              {files.map((f, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-cool/30 bg-cool/10 px-4 py-3"
                >
                  <span className="text-sm truncate flex items-center gap-2">
                    <FileText className="size-4 text-cool2" />
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((fs) => fs.filter((_, k) => k !== idx))}
                    className="text-soft"
                    aria-label="Remove file"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <label className="block rounded-xl border-2 border-dashed border-line hover:border-cool2/60 transition-colors p-8 text-center cursor-pointer">
                <Upload className="size-8 mx-auto text-cool2" />
                <p className="mt-3 text-sm font-semibold">
                  {files.length ? "Add more files" : "Choose school files"}
                </p>
                <p className="text-xs text-soft mt-1">
                  PDF, Word (DOCX), PowerPoint (PPTX), TXT, or photos of pages · up to 20MB each ·
                  scans are read with OCR
                </p>
                <input
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const all = Array.from(e.target.files ?? []);
                    const picked = all.filter((f) => fileKind(f) && f.size <= MAX_BYTES);
                    if (picked.length < all.length)
                      toast.error("Some files were skipped (unsupported type or over 20MB).");
                    setFiles((fs) => [...fs, ...picked].slice(0, 20));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <textarea
              rows={12}
              className={inputCls + " font-mono text-xs leading-relaxed"}
              placeholder="Paste lecture notes, textbook sections, articles…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
        <button className="font-semibold bg-brand text-ink px-6 py-3 rounded-lg">
          {mode === "pdf" && !extracted ? "Extract text" : "Generate study set"}
        </button>
      </form>
    </main>
  );
}
