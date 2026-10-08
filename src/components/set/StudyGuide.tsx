import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Headphones, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { generateGuide } from "@/lib/study.functions";
import type { StudySet } from "@/lib/queries";
import { btnGhost, btnPrimary, ErrorBox } from "./ui";

export function StudyGuide({ set }: { set: StudySet }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gen = useServerFn(generateGuide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await gen({ data: { setId: set.id } });
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
  };

  if (busy)
    return (
      <div className="rounded-2xl dpanel p-10 text-center max-w-xl mx-auto">
        <Loader2 className="size-8 animate-spin text-cool2 mx-auto" />
        <h2 className="font-display text-2xl uppercase mt-4">Writing your study guide</h2>
        <p className="text-soft text-sm mt-1">
          Uses your material, notes and results. Usually 20–60 seconds.
        </p>
      </div>
    );

  if (!set.study_guide)
    return (
      <div className="max-w-2xl mx-auto rounded-2xl bg-panel border border-line/70 p-8 text-center space-y-4">
        <ScrollText className="size-8 text-cool2 mx-auto" />
        <h2 className="font-display text-3xl uppercase">Generate Study Guide</h2>
        <p className="text-sm text-soft">
          A structured guide with main topics, key concepts, definitions, facts, examples, common
          mistakes, your weak areas and a quick review.
        </p>
        {error && <ErrorBox msg={error} />}
        <button onClick={run} className={btnPrimary}>
          Generate Study Guide
        </button>
      </div>
    );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-soft">
          Generated {set.study_guide_at ? new Date(set.study_guide_at).toLocaleString() : ""}
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
          <button onClick={run} className={btnGhost}>
            <RefreshCw className="size-4" /> Regenerate
          </button>
        </div>
      </div>
      {error && <ErrorBox msg={error} />}
      <article className="rounded-2xl bg-panel border border-line/70 p-6 md:p-8 prose prose-invert max-w-none prose-headings:font-display prose-headings:uppercase prose-h2:text-cool2">
        <ReactMarkdown>{set.study_guide}</ReactMarkdown>
      </article>
    </div>
  );
}
