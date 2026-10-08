import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Link2, Loader2, Network, RefreshCw } from "lucide-react";
import type { SetWithCards } from "@/lib/queries";
import { generateConceptConnections } from "@/lib/study.functions";
import { toast } from "sonner";

type Concept = {
  name: string;
  summary: string;
  importance: string;
  connections: { to: string; relationship: string }[];
};

export function ConceptConnections({ sets }: { sets: SetWithCards[] }) {
  const generate = useServerFn(generateConceptConnections);
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [focus, setFocus] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = sets.find((s) => s.id === setId);

  const run = async () => {
    if (!setId || busy) return;
    setBusy(true);
    try {
      const result = await generate({ data: { setId, focus: focus.trim() || undefined } });
      setConcepts(result.concepts as Concept[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the concept map.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-5 md:px-8 py-6">
      <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 text-cool2"><Network className="size-5" /><span className="eyebrow">Understand</span></div>
            <h2 className="font-display text-2xl font-bold mt-2">Concept connections</h2>
            <p className="text-sm text-soft mt-1 max-w-2xl">See how the important ideas in your material relate, contrast, depend on, or explain one another.</p>
          </div>
          <div className="flex flex-wrap gap-2 min-w-0 lg:max-w-xl lg:justify-end">
            <select value={setId} onChange={(e) => { setSetId(e.target.value); setConcepts([]); }} className="rounded-lg border border-line bg-accent px-3 py-2 text-sm min-w-48">
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional focus (e.g. genetics)" className="rounded-lg border border-line bg-accent px-3 py-2 text-sm w-52" />
            <button onClick={run} disabled={busy || !selected} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : concepts.length ? <RefreshCw className="size-4" /> : <Network className="size-4" />}
              {busy ? "Mapping…" : concepts.length ? "Refresh map" : "Build map"}
            </button>
          </div>
        </div>
        {!concepts.length ? (
          <div className="mt-5 rounded-xl border border-dashed border-line bg-accent/40 p-8 text-center">
            <Link2 className="size-7 mx-auto text-cool2" />
            <p className="font-semibold mt-3">Connect the ideas, not just the facts.</p>
            <p className="text-xs text-soft mt-1">Momentum will build this from your study material using NVIDIA NIM.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
            {concepts.map((c) => (
              <article key={c.name} className="rounded-xl border border-line bg-accent p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{c.name}</h3>
                  <span className="text-[10px] uppercase tracking-wider text-soft">{c.importance}</span>
                </div>
                <p className="text-sm text-soft mt-2 leading-relaxed">{c.summary}</p>
                {c.connections.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {c.connections.map((x, i) => (
                      <div key={`${c.name}-${x.to}-${i}`} className="text-xs rounded-lg bg-panel border border-line/70 px-3 py-2">
                        <span className="text-cool2 font-semibold">{x.relationship}</span> <span className="text-foreground">{x.to}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
