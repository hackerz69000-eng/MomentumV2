import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ocrFile } from "@/lib/study.functions";
import { ACCEPT, MAX_BYTES, extractFile, fileKind } from "@/lib/extract";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { gradeEssay, type EssayResult } from "@/lib/writing.functions";
import { useAutosave } from "@/hooks/use-autosave";
import { PageHeader } from "@/components/PageHeader";
import { SaveStatus } from "@/components/SaveStatus";
import { Field, SetPicker } from "@/components/SetPicker";
import { ProgressBar } from "@/components/ProgressBar";
import { btnPrimary, ErrorBox, inputCls } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/essay/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Essay Feedback — Momentum" },
      {
        name: "description",
        content: "Section-by-section essay feedback, rubric check and an estimated score.",
      },
      { property: "og:title", content: "Essay Feedback — Momentum" },
      { property: "og:description", content: "Detailed essay feedback from Momentum." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EssayPage,
});

type Row = Tables<"essay_grades">;

function EssayPage() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["essay", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("essay_grades").select("*").eq("id", id).single();
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
        <ErrorBox msg="This essay couldn't be found." />
      </div>
    );
  return <Editor row={q.data} />;
}

function Editor({ row }: { row: Row }) {
  const qc = useQueryClient();
  const gradeFn = useServerFn(gradeEssay);
  const [f, setF] = useState({
    title: row.title,
    set_id: row.set_id,
    instructions: row.instructions,
    rubric: row.rubric,
    teacher_notes: row.teacher_notes,
    sources: row.sources,
    essay: row.essay,
  });
  const [result, setResult] = useState<EssayResult | null>(
    (row.result as EssayResult | null) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const words = f.essay.trim() ? f.essay.trim().split(/\s+/).length : 0;

  const saveState = useAutosave(f, async (v) => {
    const { error } = await supabase
      .from("essay_grades")
      .update({ ...v, title: v.title.trim() || "Untitled essay" })
      .eq("id", row.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["essays"] });
  });

  const grade = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await supabase.from("essay_grades").update(f).eq("id", row.id);
      const r = await gradeFn({ data: { id: row.id } });
      setResult(r.result);
      qc.invalidateQueries({ queryKey: ["essays"] });
    } catch (e) {
      setError(
        `Your essay is saved, but grading didn't finish: ${e instanceof Error ? e.message : "please try again."}`,
      );
    }
    setBusy(false);
  };

  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title={f.title || "Essay"}
        sub={
          <Link to="/essay" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> All essays
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
          <UploadText
            label="Upload instructions (PDF, Word, text or photo)"
            onText={(t) =>
              set("instructions", f.instructions.trim() ? `${f.instructions}\n\n${t}` : t)
            }
          />
          <Field
            label="Assignment instructions / essay question"
            value={f.instructions}
            onChange={(v) => set("instructions", v)}
          />
          <Field
            label="Rubric (optional — the grade follows it when given)"
            value={f.rubric}
            onChange={(v) => set("rubric", v)}
          />
          <Field
            label="Teacher notes (optional)"
            value={f.teacher_notes}
            onChange={(v) => set("teacher_notes", v)}
            rows={2}
          />
          <Field
            label="Required sources (optional)"
            value={f.sources}
            onChange={(v) => set("sources", v)}
            rows={3}
          />
          <UploadText
            label="Upload your essay (PDF, Word, text or photo)"
            onText={(t) => set("essay", f.essay.trim() ? `${f.essay}\n\n${t}` : t)}
          />
          <Field
            label={`Your essay · ${words} words`}
            value={f.essay}
            onChange={(v) => set("essay", v)}
            rows={16}
          />
          {error && <ErrorBox msg={error} />}
          <button
            onClick={grade}
            disabled={busy || f.essay.trim().length < 200}
            className={btnPrimary}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}{" "}
            {busy
              ? "Grading — this takes about a minute…"
              : result
                ? "Grade again"
                : "Grade my essay"}
          </button>
          {f.essay.trim().length < 200 && (
            <p className="text-xs text-soft">Paste at least a few paragraphs to grade.</p>
          )}
        </section>
        <section className="space-y-4">
          {result ? (
            <ResultView r={result} />
          ) : (
            <p className="text-sm text-soft rounded-2xl bg-panel border border-line/70 p-5">
              Your feedback will appear here.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function UploadText({ label, onText }: { label: string; onText: (t: string) => void }) {
  const ocr = useServerFn(ocrFile);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!fileKind(file)) {
      setErr("That file type isn't supported. Use PDF, Word, text or a photo.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr("That file is over 20MB.");
      return;
    }
    try {
      const t = await extractFile(file, ocr, setMsg);
      if (!t) throw new Error("No text was found in that file.");
      onText(t);
      toast.success(`Added text from ${file.name} — check it below.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that file.");
    }
    setMsg(null);
  };
  return (
    <div className="text-sm">
      <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-line/70 px-3 py-2 hover:border-cool/50">
        {msg ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        <span>{msg ?? label}</span>
        <input
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={!!msg}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-panel border border-line/70 p-5 space-y-2 text-sm">
      <p className="eyebrow text-cool2">{title}</p>
      {children}
    </div>
  );
}
const List = ({ items, tone = "" }: { items: string[]; tone?: string }) =>
  items.length ? (
    <ul className={"list-disc pl-5 space-y-1 " + tone}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : null;

function ResultView({ r }: { r: EssayResult }) {
  const pct = r.finalMax ? Math.round((r.finalScore / r.finalMax) * 100) : 0;
  return (
    <>
      <div className="rounded-2xl dpanel p-6">
        <p className="eyebrow text-soft">
          Estimated score{r.rubricUsed ? " (from your rubric)" : ""}
        </p>
        <p className="font-display text-6xl text-cool2">
          {r.finalScore}
          <span className="text-2xl text-soft">/{r.finalMax}</span>
        </p>
        <ProgressBar value={pct} className="mt-3" />
        <p className="text-xs text-soft mt-2">
          An AI estimate based on what you provided — not your teacher's grade.
        </p>
        {r.summary.overall && <p className="text-sm mt-3">{r.summary.overall}</p>}
      </div>
      {r.threeChanges.length > 0 && (
        <Card title="Three changes that matter most">
          <ol className="list-decimal pl-5 space-y-1">
            {r.threeChanges.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </Card>
      )}
      <Card title="Scores">
        {r.scores.map((s, i) => (
          <div key={i} className="py-1.5 border-b border-line/40 last:border-0">
            <div className="flex justify-between font-semibold">
              <span>{s.category}</span>
              <span>
                {s.score}/{s.max}
              </span>
            </div>
            <p className="text-soft text-xs">{s.reasoning}</p>
          </div>
        ))}
      </Card>
      {r.sections.map((s, i) => (
        <Card key={i} title={s.name}>
          <List items={s.works} tone="text-mint" />
          <List items={s.improve} />
        </Card>
      ))}
      {r.paragraphs.length > 0 && (
        <Card title="Paragraph by paragraph">
          {r.paragraphs.map((p, i) => (
            <div key={i} className="py-2 border-b border-line/40 last:border-0 space-y-1">
              <p className="font-semibold">{p.label}</p>
              {p.works && (
                <p>
                  <span className="text-mint">Works:</span> {p.works}
                </p>
              )}
              {p.doesnt && (
                <p>
                  <span className="text-destructive">Doesn't:</span> {p.doesnt}
                </p>
              )}
              {p.missing && (
                <p>
                  <span className="text-soft">Missing:</span> {p.missing}
                </p>
              )}
              {p.change && (
                <p>
                  <span className="text-cool2">Change:</span> {p.change}{" "}
                  {p.why && <span className="text-soft">— {p.why}</span>}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
      <Card title="Requirements check">
        {r.check.met.length > 0 && (
          <>
            <p className="text-mint font-semibold">Met</p>
            <List items={r.check.met} />
          </>
        )}
        {r.check.partial.length > 0 && (
          <>
            <p className="text-cool2 font-semibold">Partly met</p>
            <List items={r.check.partial} />
          </>
        )}
        {r.check.missing.length > 0 && (
          <>
            <p className="text-destructive font-semibold">Missing</p>
            <List items={r.check.missing} />
          </>
        )}
        {r.requirements.unclear.length > 0 && (
          <>
            <p className="text-soft font-semibold">Unclear in the assignment</p>
            <List items={r.requirements.unclear} />
          </>
        )}
      </Card>
      {r.changes.length > 0 && (
        <Card title="Suggested changes">
          {r.changes.map((c, i) => (
            <div key={i} className="py-1.5 border-b border-line/40 last:border-0">
              <p>
                <span className="text-[11px] px-1.5 py-0.5 rounded border border-line mr-2">
                  {c.kind === "style" ? "Style" : "Fix"}
                </span>
                {c.improve}
              </p>
              <p className="text-xs text-soft">
                {c.current} — {c.why}
              </p>
            </div>
          ))}
        </Card>
      )}
      {r.verify.length > 0 && (
        <Card title="Double-check these claims or citations">
          <List items={r.verify} />
        </Card>
      )}
    </>
  );
}
