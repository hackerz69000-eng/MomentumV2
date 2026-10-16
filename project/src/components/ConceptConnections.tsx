import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpenCheck, Check, ChevronRight, Loader2, Network, RefreshCw, Sparkles } from "lucide-react";
import type { SetWithCards } from "@/lib/queries";
import { generateConceptConnections } from "@/lib/study.functions";
import { toast } from "sonner";

type SavedMap = { id: string; title: string; setId: string; createdAt: string; concepts: Concept[] };
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
  const [selectedName, setSelectedName] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<Record<string, "learning" | "practising" | "confident">>({});
  const [busy, setBusy] = useState(false);
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [activeMapId, setActiveMapId] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("momentum:saved-concept-maps:v1");
      if (raw) {
        const parsed = JSON.parse(raw) as SavedMap[];
        setSavedMaps(parsed);
        if (parsed[0]) {
          setActiveMapId(parsed[0].id); setSetId(parsed[0].setId);
          setConcepts(parsed[0].concepts); setSelectedName(parsed[0].concepts[0]?.name ?? "");
        }
      }
    } catch { /* ignore malformed local cache */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("momentum:saved-concept-maps:v1", JSON.stringify(savedMaps)); } catch { /* storage may be unavailable */ }
  }, [savedMaps]);
  const openSavedMap = (map: SavedMap) => {
    setActiveMapId(map.id); setSetId(map.setId); setConcepts(map.concepts);
    setSelectedName(map.concepts[0]?.name ?? ""); setRevealed(false); setConfidence({});
  };
  const selected = sets.find((s) => s.id === setId);
  const selectedConcept = concepts.find((c) => c.name === selectedName) ?? concepts[0];
  const connections = useMemo(() => {
    if (!selectedConcept) return [];
    const outgoing = selectedConcept.connections.map((c) => ({ ...c, direction: "outgoing" as const }));
    const incoming = concepts.flatMap((c) => c.connections.filter((x) => x.to === selectedConcept.name).map((x) => ({ to: c.name, relationship: x.relationship, direction: "incoming" as const })));
    const unique = new Map<string, (typeof outgoing)[number] | (typeof incoming)[number]>();
    [...outgoing, ...incoming].forEach((c) => unique.set(`${c.direction}:${c.to}:${c.relationship}`, c));
    return [...unique.values()];
  }, [concepts, selectedConcept]);

  const run = async () => {
    if (!setId || busy) return;
    setBusy(true);
    try {
      const result = await generate({ data: { setId, focus: focus.trim() || undefined } });
      const next = result.concepts as Concept[];
      const saved: SavedMap = { id: crypto.randomUUID(), title: `${selected?.name ?? "Study set"}${focus.trim() ? ` · ${focus.trim()}` : " · Concept map"}`, setId, createdAt: new Date().toISOString(), concepts: next };
      setSavedMaps((current) => [saved, ...current]); setActiveMapId(saved.id);
      setConcepts(next); setSelectedName(next[0]?.name ?? ""); setRevealed(false); setConfidence({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the concept map.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-5 md:px-8 py-6">
      <div className="rounded-2xl border border-line bg-panel p-5 md:p-6">
        {savedMaps.length > 0 && <div className="mt-4 border-b border-line pb-3"><p className="text-xs font-semibold text-soft mb-2">Your saved maps · {savedMaps.length}</p><div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Saved concept maps">{savedMaps.map((map) => <div key={map.id} className={`shrink-0 flex items-center rounded-lg border ${activeMapId === map.id ? "border-cool2 bg-cool/10" : "border-line bg-accent"}`}><button role="tab" aria-selected={activeMapId === map.id} onClick={() => openSavedMap(map)} className="px-3 py-2 text-xs font-medium max-w-52 truncate">{map.title}<span className="block text-[10px] text-soft">{new Date(map.createdAt).toLocaleDateString()}</span></button><button aria-label={`Delete ${map.title}`} title="Delete saved map" onClick={() => { setSavedMaps((all) => all.filter((item) => item.id !== map.id)); if (activeMapId === map.id) { setActiveMapId(""); setConcepts([]); setSelectedName(""); } }} className="px-2 text-soft hover:text-destructive">×</button></div>)}</div></div>}
        <div className="flex flex-col xl:flex-row xl:items-end gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 text-cool2"><Network className="size-5" /><span className="eyebrow">Understand & Connect</span></div>
            <h2 className="font-display text-2xl font-bold mt-2">Interactive concept map</h2>
            <p className="text-sm text-soft mt-1 max-w-2xl">Explore the concepts, inspect how they connect, then practise explaining the relationship from memory. This is a study tool, not just a generated summary.</p>
          </div>
          <div className="flex flex-wrap gap-2 min-w-0 xl:max-w-2xl xl:justify-end">
            <select aria-label="Study set for concept map" value={setId} onChange={(e) => { setSetId(e.target.value); setActiveMapId(""); setConcepts([]); setSelectedName(""); setRevealed(false); }} className="rounded-lg border border-line bg-accent px-3 py-2 text-sm min-w-48">
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input aria-label="Focus topic" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Focus on a topic (optional)" className="rounded-lg border border-line bg-accent px-3 py-2 text-sm w-56" />
            <button onClick={run} disabled={busy || !selected} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : concepts.length ? <RefreshCw className="size-4" /> : <Network className="size-4" />}
              {busy ? "Building map…" : concepts.length ? "Regenerate" : "Build map"}
            </button>
          </div>
        </div>

        {!concepts.length ? (
          <div className="mt-5 rounded-xl border border-dashed border-line bg-accent/40 p-8 text-center">
            <Network className="size-8 mx-auto text-cool2" />
            <p className="font-semibold mt-3">Build a map you can actually study from.</p>
            <p className="text-sm text-soft mt-1 max-w-xl mx-auto">Momentum will identify the key concepts and evidence-based links from your selected set. Select a node to inspect its links, then use the recall prompt to test whether you understand it.</p>
            <div className="grid sm:grid-cols-3 gap-2 max-w-3xl mx-auto mt-5 text-left">
              {["See cause, contrast, and dependency", "Follow links to related concepts", "Practise explaining without notes"].map((x) => <div key={x} className="rounded-lg border border-line bg-panel p-3 text-xs text-soft"><Check className="size-4 text-cool2 mb-2" />{x}</div>)}
            </div>
          </div>
        ) : (
          <div className="grid xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)] gap-4 mt-5">
            <div className="rounded-xl border border-line bg-accent/40 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3 mb-3"><p className="text-sm font-semibold">Concepts in this set</p><span className="text-xs text-soft">{concepts.length} concepts · select one</span></div>
              <div className="grid sm:grid-cols-2 gap-2">
                {concepts.map((c, i) => {
                  const active = selectedConcept?.name === c.name;
                  return <button key={c.name} onClick={() => { setSelectedName(c.name); setRevealed(false); }} className={`text-left rounded-xl border p-3 transition-colors ${active ? "border-cool2 bg-cool/10 ring-1 ring-cool2/30" : "border-line bg-panel hover:border-cool2/50"}`}>
                    <div className="flex items-start gap-2"><span className={`size-7 rounded-lg grid place-items-center text-xs font-bold shrink-0 ${active ? "bg-cool2 text-white" : "bg-foreground/5 text-soft"}`}>{i + 1}</span><span className="font-semibold text-sm flex-1">{c.name}</span><ChevronRight className={`size-4 shrink-0 ${active ? "text-cool2" : "text-soft"}`} /></div>
                    <p className="text-xs text-soft mt-2 line-clamp-3">{c.summary}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-[10px] text-soft"><span className={`size-1.5 rounded-full ${c.importance === "high" ? "bg-amber-400" : c.importance === "low" ? "bg-foreground/30" : "bg-cool2"}`} />{c.importance} importance · {c.connections.length} outgoing links · {confidence[c.name] ?? "learning"}</div>
                  </button>;
                })}
              </div>
            </div>

            {selectedConcept && <div className="rounded-xl border border-line bg-panel p-4 sm:p-5">
              <div className="flex items-center gap-2 text-cool2"><Sparkles className="size-4" /><span className="eyebrow">Explore concept</span></div>
              <h3 className="font-display text-xl font-bold mt-2">{selectedConcept.name}</h3>
              <p className="text-sm text-soft leading-relaxed mt-2">{selectedConcept.summary}</p>
              <div className="mt-5"><p className="text-sm font-semibold flex items-center gap-2"><Network className="size-4 text-cool2" />Connections <span className="text-xs text-soft font-normal">({connections.length})</span></p>
                {connections.length ? <div className="space-y-2 mt-2">{connections.map((c, i) => <button key={`${c.direction}-${c.to}-${i}`} onClick={() => { setSelectedName(c.to); setRevealed(false); }} className="w-full rounded-lg border border-line bg-accent p-3 text-left hover:border-cool2/50"><div className="flex items-center gap-2 text-xs text-cool2 font-semibold"><ArrowRight className={`size-3 ${c.direction === "incoming" ? "rotate-180" : ""}`} />{c.relationship}<span className="ml-auto text-[10px] text-soft font-normal">{c.direction === "incoming" ? "links here" : "links to"}</span></div><p className="text-sm font-medium mt-1">{c.to}</p></button>)}</div> : <p className="text-xs text-soft mt-2 rounded-lg bg-accent p-3">No direct links were returned for this concept. Try another node or regenerate the map.</p>}
              </div>
              <div className="mt-5 rounded-xl border border-cool2/30 bg-cool/5 p-4">
                <div className="flex items-center gap-2"><BookOpenCheck className="size-4 text-cool2" /><p className="font-semibold text-sm">Active-recall challenge</p></div>
                <p className="text-sm mt-2">Without looking at the summary, explain what <strong>{selectedConcept.name}</strong> means and how it connects to at least one other concept. Include the reason for the relationship, not just the names.</p>
                <button onClick={() => setRevealed((v) => !v)} className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold hover:border-cool2/50">{revealed ? "Hide self-check" : "Reveal self-check"}</button>
                {revealed && <div className="mt-3 rounded-lg bg-panel border border-line p-3"><p className="text-xs font-semibold text-cool2 mb-1">Compare your explanation</p><p className="text-sm text-soft">{selectedConcept.summary}</p>{connections.length > 0 && <p className="text-sm text-soft mt-2">Connection to mention: {connections[0]!.relationship} {connections[0]!.to}.</p>}<p className="text-xs text-soft mt-2">Can you explain both the concept and the relationship without copying these lines?</p></div>}
                <div className="mt-3"><p className="text-xs font-semibold mb-2">How well can you explain this concept from memory?</p><div className="grid grid-cols-3 gap-2">{([{id:"learning",label:"Need review"},{id:"practising",label:"Getting there"},{id:"confident",label:"Can explain it"}] as const).map((item) => <button key={item.id} onClick={() => setConfidence((old) => ({...old, [selectedConcept.name]: item.id}))} className={`rounded-lg border px-2 py-2 text-xs ${confidence[selectedConcept.name] === item.id ? "border-cool2 bg-cool/10 text-cool2" : "border-line bg-accent text-soft"}`}>{item.label}</button>)}</div><p className="text-[11px] text-soft mt-2">Use this self-rating to decide which concepts to revisit. It is a study aid, not an automatic grade.</p></div>
              </div>
            </div>}
          </div>
        )}
      </div>
    </section>
  );
}
