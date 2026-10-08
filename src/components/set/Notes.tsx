import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Headphones, Lightbulb, Loader2, RefreshCw, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { explainPassage, regenerateNotes } from "@/lib/study.functions";
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
  const [busy, setBusy] = useState(false);
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
        <ReactMarkdown>{md}</ReactMarkdown>
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
            <ReactMarkdown>{result.text}</ReactMarkdown>
          </div>
        </div>
      )}
    </article>
  );
}
