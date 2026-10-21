import { useServerFn } from "@tanstack/react-start";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Headphones, Lightbulb, Loader2, RefreshCw, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { explainPassage, ocrFile, regenerateNotes } from "@/lib/study.functions";
import { extractFile, storeVisuals, type ExtractedVisual } from "@/lib/extract";
import type { StudySet } from "@/lib/queries";
import { cn } from "@/lib/utils";
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
  const ocr = useServerFn(ocrFile);
  const [busy, setBusy] = useState(false);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualStatus, setVisualStatus] = useState("");
  const run = async () => {
    setBusy(true);
    try {
      await regen({ data: { setId: set.id } });
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
      toast.success("Notes regenerated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
  };
  const sections = set.notes ? splitSections(set.notes) : [];
  const visualsQ = useQuery({
    queryKey: ["lecture-visuals", set.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("study_files")
        .select("id,name,path,mime")
        .eq("set_id", set.id)
        .like("name", "Lecture visual — %")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []).filter((row) => row.mime.startsWith("image/"));
      const signed: Array<{ id: string; name: string; url: string } | null> = await Promise.all(rows.map(async (row) => {
        const { data: urlData, error: urlError } = await supabase.storage.from("study-files").createSignedUrl(row.path, 3600);
        if (urlError || !urlData?.signedUrl) return null;
        return { id: row.id, name: row.name, url: urlData.signedUrl };
      }));
      return signed.filter((row): row is { id: string; name: string; url: string } => row !== null);
    },
  });
  const rebuildVisualGallery = async () => {
    setVisualBusy(true);
    setVisualStatus("Finding original lecture files…");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user?.id) throw new Error("Sign in again to access your original lecture files.");
      const { data: fileRows, error: filesError } = await supabase.from("study_files")
        .select("name,path,mime")
        .eq("set_id", set.id)
        .order("created_at", { ascending: true });
      if (filesError) throw filesError;
      const originals = (fileRows ?? []).filter((row) => !row.name.startsWith("Lecture visual — ")).slice(0, 5);
      if (!originals.length) throw new Error("No saved original lecture files were found. Add the PDF or PowerPoint in Materials first.");
      const visuals: ExtractedVisual[] = [];
      const extractedSources: { name: string; text: string }[] = [];
      for (const [index, row] of originals.entries()) {
        setVisualStatus(`Analyzing ${row.name} (${index + 1}/${originals.length})…`);
        const { data: blob, error: downloadError } = await supabase.storage.from("study-files").download(row.path);
        if (downloadError || !blob) {
          console.warn(`Could not download ${row.name} for visual extraction.`, downloadError);
          continue;
        }
        const file = new File([blob], row.name, { type: row.mime || blob.type || "application/octet-stream" });
        const extractedText = await extractFile(file, ocr, setVisualStatus, set.material_text.slice(0, 12000), visuals);
        extractedSources.push({ name: row.name, text: extractedText });
        if (visuals.length >= 12) break;
      }
      if (!visuals.length) throw new Error("No meaningful lecture images were detected in the saved files.");
      const saved = await storeVisuals(auth.user.id, set.id, visuals);
      await qc.invalidateQueries({ queryKey: ["lecture-visuals", set.id] });
      if (!saved.stored) throw new Error("Images were detected but none could be saved. Check your study-files storage permissions.");
      // Preserve newly discovered explanations in source text without duplicating text already present.
      const currentMaterial = set.material_text || "";
      const additions: string[] = [];
      for (const source of extractedSources) {
        const sections = source.text.match(/(?:^## Slide \d+ — Visual explanation|^## Visual explanations for figures and diagrams|^### Page \d+|^### Document image \d+ — Visual explanation)[\s\S]*?(?=^#{2,3}\s|$)/gm) ?? [];
        const uniqueSections = sections.filter((section) => {
          const heading = section.split("\n")[0]?.trim();
          return heading && !currentMaterial.includes(heading) && !additions.some((item) => item.includes(heading));
        });
        if (uniqueSections.length) additions.push(`### Visual explanations recovered from ${source.name}\n\n${uniqueSections.join("\n\n")}`);
      }
      if (additions.length) {
        const { error: materialError } = await supabase.from("study_sets").update({
          material_text: `${currentMaterial.trim()}\n\n${additions.join("\n\n")}`.trim(),
        }).eq("id", set.id);
        if (materialError) console.warn("Lecture images were saved, but recovered visual explanations could not be added to source text.", materialError);
        else {
          await regen({ data: { setId: set.id } });
          await qc.invalidateQueries({ queryKey: ["set", set.id] });
        }
      }
      await qc.invalidateQueries({ queryKey: ["lecture-visuals", set.id] });
      toast.success(`Added ${saved.stored} lecture visual${saved.stored === 1 ? "" : "s"} to Notes.`);
      if (saved.failed) toast.error(`${saved.failed} additional visual(s) could not be saved.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't extract lecture visuals.");
    } finally {
      setVisualBusy(false);
      setVisualStatus("");
    }
  };
  const visualDescription = (name: string) => {
    const marker = name.match(/(Slide|Page|Document image)\s+(\d+)/i);
    if (!marker) {
      const visualSection = set.material_text.match(/Visual explanation[\s\S]{0,1200}/i);
      return visualSection?.[0] || "This uploaded lecture image is part of the source material for these notes.";
    }
    const kind = marker[1]!.toLowerCase();
    const number = marker[2]!;
    const heading = kind === "slide"
      ? new RegExp(`## Slide ${number} — Visual explanation\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)`, "i")
      : kind === "page"
        ? new RegExp(`### Page ${number}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)`, "i")
        : new RegExp(`### Document image ${number} — Visual explanation\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)`, "i");
    const match = set.material_text.match(heading);
    return match?.[1]?.trim() || `From ${marker[1]} ${number}. See the corresponding visual explanation in the notes and compare it with the lecture text.`;
  };
  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs text-soft inline-flex items-center gap-1.5">
          <Lightbulb className="size-3.5 text-cool2" /> Use "Explain" on any section for a simpler
          or deeper take.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() =>
              navigate({ to: "/sets/$id", params: { id: set.id }, search: { tab: "audio" } })
            }
            className={btnGhost}
          >
            <Headphones className="size-4" /> Audio Study
          </button>
          <button onClick={run} disabled={busy} className={btnGhost}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{" "}
            Regenerate
          </button>
        </div>
      </div>
      {!visualsQ.isLoading && !visualsQ.data?.length ? (
        <section className="mb-5 rounded-2xl bg-panel border border-line/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Add the original lecture images to these notes</p>
            <p className="text-xs text-soft mt-1">For study sets created before visual images were saved, Momentum can re-analyze up to five stored source files without duplicating their extracted text.</p>
            {visualStatus && <p className="text-xs text-cool2 mt-2">{visualStatus}</p>}
          </div>
          <button onClick={() => void rebuildVisualGallery()} disabled={visualBusy} className={btnGhost}>
            {visualBusy ? <Loader2 className="size-4 animate-spin" /> : <Lightbulb className="size-4" />}
            {visualBusy ? "Analyzing visuals…" : "Find lecture images"}
          </button>
        </section>
      ) : null}
      {visualsQ.data?.length ? (
        <section className="mb-5 rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
          <div>
            <h2 className="font-display text-xl uppercase">Lecture visuals explained</h2>
            <p className="text-xs text-soft mt-1">Original slide/page images are shown with their source context. The written notes below explain how each visual relates to the lecture.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {visualsQ.data.map((visual) => (
              <figure key={visual.id} className="rounded-xl border border-line/70 overflow-hidden bg-background/40">
                <a href={visual.url} target="_blank" rel="noreferrer" aria-label={`Open ${visual.name}`}>
                  <img src={visual.url} alt={visual.name} loading="lazy" className="w-full max-h-72 object-contain bg-black/5" />
                </a>
                <figcaption className="p-3 space-y-2">
                  <p className="text-sm font-semibold">{visual.name.replace(/^Lecture visual — /, "")}</p>
                  <p className="text-xs text-soft leading-5">{visualDescription(visual.name)}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
      <div className={cn("space-y-4 transition-opacity", busy && "opacity-50")}>
        {sections.length ? (
          sections.map((sec, i) => <Section key={i} setId={set.id} md={sec} />)
        ) : (
          <div className="rounded-2xl bg-panel border border-line/70 p-8 text-soft">
            No notes yet. Click regenerate to create them.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ setId, md }: { setId: string; md: string }) {
  const explain = useServerFn(explainPassage);
  const [result, setResult] = useState<{ mode: Mode; text: string } | null>(null);
  const [loading, setLoading] = useState<Mode | null>(null);
  const ask = async (mode: Mode) => {
    setLoading(mode);
    try {
      const { text } = await explain({ data: { setId, passage: md.slice(0, 8000), mode } });
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
