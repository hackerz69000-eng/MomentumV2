import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ocrFile, regenerateNotes } from "@/lib/study.functions";
import { ACCEPT, MAX_BYTES, extractFile, fileKind, storeOriginal } from "@/lib/extract";
import type { StudySet } from "@/lib/queries";
import { trashRow } from "@/lib/trash";
import { cn } from "@/lib/utils";
import { btnGhost, btnPrimary, inputCls } from "./ui";

export function Materials({ set }: { set: StudySet }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ocr = useServerFn(ocrFile);
  const renotes = useServerFn(regenerateNotes);
  const filesQ = useQuery({
    queryKey: ["files", set.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_files")
        .select("*")
        .eq("set_id", set.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [ci, setCi] = useState(set.custom_instructions ?? "");
  const [savingCi, setSavingCi] = useState(false);
  const [pending, setPending] = useState<{
    files: File[];
    text: string;
    meta: { file: File; chars: number }[];
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [material, setMaterial] = useState(set.material_text);
  const [refreshAsk, setRefreshAsk] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["set", set.id] });
    qc.invalidateQueries({ queryKey: ["files", set.id] });
    qc.invalidateQueries({ queryKey: ["sets"] });
  };

  const saveCi = async (value: string) => {
    setSavingCi(true);
    const { error } = await supabase
      .from("study_sets")
      .update({ custom_instructions: value.trim().slice(0, 2000) })
      .eq("id", set.id);
    setSavingCi(false);
    if (error) toast.error("Couldn't save instructions");
    else {
      toast.success(value.trim() ? "Custom instructions saved" : "Custom instructions cleared");
      refresh();
    }
  };

  const pick = async (list: File[]) => {
    const files = list.filter((f) => fileKind(f) && f.size <= MAX_BYTES);
    if (files.length < list.length)
      toast.error("Some files were skipped (unsupported type or over 20MB).");
    if (!files.length) return;
    const parts: string[] = [];
    const meta: { file: File; chars: number }[] = [];
    const failedFiles: File[] = [];
    for (const f of files) {
      try {
        const t = await extractFile(f, ocr, setMsg);
        if (t) parts.push(`=== ${f.name} ===\n${t}`);
        meta.push({ file: f, chars: t.length });
      } catch (e) {
        failedFiles.push(f);
        toast.error(e instanceof Error ? e.message : `Couldn't read ${f.name}`);
      }
    }
    setMsg(null);
    if (failedFiles.length)
      toast.error(`${failedFiles.length} file(s) couldn't be read.`, {
        action: { label: "Retry", onClick: () => void pick(failedFiles) },
        duration: 15000,
      });
    if (!parts.length) {
      if (!failedFiles.length) toast.error("No readable text found in those files.");
      return;
    }
    setPending({ files: meta.map((m) => m.file), text: parts.join("\n\n"), meta });
  };

  const addPending = async () => {
    if (!pending || !user) return;
    setMsg("Saving…");
    const merged = `${set.material_text.trim()}\n\n${pending.text.trim()}`;
    const names = [set.material_filename, ...pending.files.map((f) => f.name)]
      .filter(Boolean)
      .join(", ")
      .slice(0, 300);
    const { error } = await supabase
      .from("study_sets")
      .update({ material_text: merged, material_source: "pdf", material_filename: names })
      .eq("id", set.id);
    if (error) {
      toast.error("Couldn't add the material");
      setMsg(null);
      return;
    }
    const stored = await Promise.allSettled(
      pending.meta.map((m) => storeOriginal(user.id, set.id, m.file, m.chars)),
    );
    const lost = stored.filter((r) => r.status === "rejected").length;
    setPending(null);
    setMsg(null);
    setMaterial(merged);
    refresh();
    toast.success(
      "Material added — quizzes, Active Recall, the tutor and study guides now use it.",
    );
    if (lost)
      toast.error(
        `The text was added, but ${lost} original file(s) couldn't be stored for download.`,
      );
    setRefreshAsk(true);
  };

  const updateNotes = async () => {
    setRefreshAsk(false);
    setMsg("Rewriting your notes with the new material…");
    try {
      await renotes({ data: { setId: set.id } });
      toast.success("Notes updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
    setMsg(null);
    refresh();
  };

  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("study-files").createSignedUrl(path, 120);
    if (error || !data) {
      toast.error("Couldn't open file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const removeFile = async (id: string, _path: string) => {
    const row = filesQ.data?.find((f) => f.id === id);
    if (!row) return;
    try {
      await trashRow("file", "study_files", row, `File: ${row.name}`);
      toast.success("File moved to Recently Deleted. Its extracted text stays in your material.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove file");
    }
    refresh();
  };

  const saveMaterial = async () => {
    const { error } = await supabase
      .from("study_sets")
      .update({ material_text: material })
      .eq("id", set.id);
    if (error) toast.error("Couldn't save");
    else {
      setEditing(false);
      refresh();
      toast.success("Material saved");
      setRefreshAsk(true);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3">
        <p className="eyebrow text-cool2">Custom instructions</p>
        <p className="text-xs text-soft">
          Applies to notes, flashcards, quizzes, exams, Active Recall, study guides, Explain and
          Coach for this set only.
        </p>
        <textarea
          rows={3}
          maxLength={2000}
          value={ci}
          onChange={(e) => setCi(e.target.value)}
          className={cn(inputCls, "w-full")}
          placeholder={`e.g. "Use Ontario curriculum terminology" or "Make quiz questions difficult"`}
        />
        <div className="flex gap-2">
          <button
            onClick={() => saveCi(ci)}
            disabled={savingCi || ci.trim() === (set.custom_instructions ?? "").trim()}
            className={btnPrimary}
          >
            Save
          </button>
          {(set.custom_instructions ?? "") && (
            <button
              onClick={() => {
                setCi("");
                void saveCi("");
              }}
              className={btnGhost}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-soft">Files</p>
          <label className={cn(btnGhost, "cursor-pointer")}>
            <Plus className="size-4" /> Add files
            <input
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                void pick(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {msg && (
          <p className="text-sm text-soft flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {msg}
          </p>
        )}
        {(filesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-soft">
            {set.material_source === "pdf"
              ? `${set.material_filename || "Uploaded files"} (original files weren't kept for older sets)`
              : "Pasted text"}{" "}
            — add PDF, DOCX, PPTX, TXT or photos.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {filesQ.data!.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 text-sm rounded-lg bg-foreground/5 px-3 py-2"
              >
                <span className="truncate flex items-center gap-2">
                  <FileText className="size-4 text-cool2 shrink-0" />
                  {f.name}{" "}
                  <span className="text-soft text-xs">· {f.chars.toLocaleString()} chars</span>
                </span>
                <span className="flex gap-1 shrink-0">
                  <button
                    onClick={() => download(f.path)}
                    className="p-1.5 text-soft hover:text-foreground"
                    aria-label="Download"
                  >
                    <Download className="size-4" />
                  </button>
                  <button
                    onClick={() => removeFile(f.id, f.path)}
                    className="p-1.5 text-soft hover:text-destructive"
                    aria-label="Remove"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {pending && (
          <div className="space-y-2 border-t border-line/60 pt-3">
            <p className="text-sm">
              Review the text from {pending.files.length} new file
              {pending.files.length === 1 ? "" : "s"} before adding it:
            </p>
            <textarea
              rows={10}
              value={pending.text}
              onChange={(e) => setPending({ ...pending, text: e.target.value })}
              className={cn(inputCls, "w-full font-mono text-xs")}
            />
            <div className="flex gap-2">
              <button onClick={addPending} className={btnPrimary}>
                Add to study set
              </button>
              <button onClick={() => setPending(null)} className={btnGhost}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {refreshAsk && (
          <div className="rounded-lg border border-cool/30 bg-cool/10 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
            <span>
              Update your notes to include the new material? (Flashcards can be regenerated in the
              Flashcards tab.)
            </span>
            <span className="flex gap-2">
              <button onClick={updateNotes} className={btnPrimary}>
                Update notes
              </button>
              <button onClick={() => setRefreshAsk(false)} className={btnGhost}>
                Not now
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-panel border border-line/70 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow text-soft">
            Extracted text · {set.material_text.length.toLocaleString()} characters
          </p>
          {editing ? (
            <span className="flex gap-2">
              <button onClick={saveMaterial} className={btnPrimary}>
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setMaterial(set.material_text);
                }}
                className={btnGhost}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => {
                setMaterial(set.material_text);
                setEditing(true);
              }}
              className="text-xs text-cool2 font-semibold"
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <textarea
            rows={20}
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className={cn(inputCls, "w-full font-mono text-xs")}
          />
        ) : (
          <pre className="text-xs text-soft whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-y-auto">
            {set.material_text}
          </pre>
        )}
      </div>
    </div>
  );
}
