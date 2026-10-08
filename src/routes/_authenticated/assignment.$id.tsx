import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Loader2, Send } from "lucide-react";
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
}[] = [
  { k: "understand", l: "1. Understand it", field: "understanding" },
  { k: "brainstorm", l: "2. Brainstorm", field: "brainstorm" },
  { k: "outline", l: "3. Outline", field: "outline" },
];

function Editor({ row }: { row: Row }) {
  const qc = useQueryClient();
  const stepFn = useServerFn(assignmentStep);
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
    await supabase
      .from("assignments")
      .update({ ...f, updated_at: new Date().toISOString() })
      .eq("id", row.id);
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
        `Your work is saved, but this step didn't finish: ${e instanceof Error ? e.message : "please try again."}`,
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
          <Field
            label="Assignment instructions"
            value={f.instructions}
            onChange={(v) => set("instructions", v)}
            rows={6}
            placeholder="Paste the prompt or question exactly as given."
          />
          <Field
            label="Rubric / teacher requirements"
            value={f.rubric}
            onChange={(v) => set("rubric", v)}
          />
          <Field
            label="Sources you must use (paste text)"
            value={f.sources}
            onChange={(v) => set("sources", v)}
          />
          <Field
            label="Your own ideas so far"
            value={f.ideas}
            onChange={(v) => set("ideas", v)}
            rows={3}
          />
        </section>
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STEPS.map((s) => (
              <button
                key={s.k}
                onClick={() => run(s.k)}
                disabled={
                  !!busy || !f.instructions.trim() || (s.k === "outline" && !f.chosen.trim())
                }
                className={btnGhost}
              >
                {busy === s.k && <Loader2 className="size-4 animate-spin" />} {s.l}
              </button>
            ))}
          </div>
          {error && <ErrorBox msg={error} />}
          <div className="flex gap-1 border-b border-line/60">
            {STEPS.map((s) => (
              <button
                key={s.field}
                onClick={() => setTab(s.field)}
                className={
                  "px-3 py-2 text-sm " +
                  (tab === s.field ? "border-b-2 border-cool2 font-semibold" : "text-soft")
                }
              >
                {s.l.slice(3)}
              </button>
            ))}
          </div>
          <div className="md text-sm rounded-2xl bg-panel border border-line/70 p-5 min-h-40">
            {out[tab] ? (
              <ReactMarkdown>{out[tab]!}</ReactMarkdown>
            ) : (
              <p className="text-soft">
                {!f.instructions.trim()
                  ? "Add the assignment instructions to begin."
                  : "Press the step button above."}
              </p>
            )}
          </div>
          <Field
            label="Your chosen argument / thesis (needed for the outline)"
            value={f.chosen}
            onChange={(v) => set("chosen", v)}
            rows={2}
          />
          <Field
            label="Your draft"
            value={f.draft}
            onChange={(v) => set("draft", v)}
            rows={8}
            placeholder="Write or paste your own draft for feedback."
          />
          <div className="rounded-2xl bg-panel border border-line/70 p-4 space-y-3">
            <p className="eyebrow text-cool2">Draft feedback</p>
            {chat.map((m, i) => (
              <div
                key={i}
                className={
                  "md text-sm rounded-lg p-3 " +
                  (m.role === "user" ? "bg-cool/10" : "bg-foreground/5")
                }
              >
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Is my second paragraph's evidence strong enough?"
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
