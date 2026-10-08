import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { BookOpenText, Globe, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askMaterials, type SourceRef } from "@/lib/ask.functions";
import type { StudySet } from "@/lib/queries";
import { ErrorBox } from "./ui";

type Msg = {
  id: string;
  role: string;
  content: string;
  sources: { refs?: SourceRef[]; notFound?: boolean; general?: boolean } | null;
};

const SUGGEST = [
  "What are the most important things I need to know?",
  "Explain the main concept simply.",
  "What did my teacher say about this topic?",
  "Give me an example based on my notes.",
];

export function AskMaterials({ set }: { set: StudySet }) {
  const ask = useServerFn(askMaterials);
  const qc = useQueryClient();
  const histQ = useQuery({
    queryKey: ["ask", set.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("material_messages")
        .select("id, role, content, sources")
        .eq("set_id", set.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const msgs: Msg[] = [
    ...(histQ.data ?? []),
    ...(pending ? [{ id: "p", role: "user", content: pending, sources: null }] : []),
  ];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, loading]);

  const send = async (text?: string, general = false) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setPending(general ? `${content} (general background)` : content);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      await ask({ data: { setId: set.id, content, general } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't answer");
      setInput(content);
    }
    await qc.invalidateQueries({ queryKey: ["ask", set.id] });
    setPending(null);
    setLoading(false);
  };
  const lastUserQ = (i: number) =>
    [...msgs.slice(0, i)]
      .reverse()
      .find((m) => m.role === "user")
      ?.content.replace(/\n\n_\(general background requested\)_$/, "") ?? "";
  const clear = async () => {
    if (loading) return;
    const { error: e } = await supabase.from("material_messages").delete().eq("set_id", set.id);
    if (e) toast.error("Couldn't clear");
    qc.invalidateQueries({ queryKey: ["ask", set.id] });
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-15rem)] min-h-[440px] rounded-2xl bg-panel border border-line/70 overflow-hidden">
      <div className="flex justify-between items-center px-5 py-2 border-b border-line/60">
        <span className="eyebrow text-cool2 inline-flex items-center gap-1.5">
          <BookOpenText className="size-3.5" /> Ask Your Materials · answers only from your files,
          lectures, notes & guides
        </span>
        {msgs.length > 0 && (
          <button
            onClick={clear}
            disabled={loading}
            className="text-xs text-soft hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {histQ.isLoading && <Loader2 className="size-5 animate-spin text-cool2 mx-auto" />}
        {!histQ.isLoading && msgs.length === 0 && (
          <div className="text-center py-8">
            <h2 className="font-display text-2xl uppercase">Ask your materials</h2>
            <p className="text-soft text-sm mt-1 max-w-md mx-auto">
              Searches everything in {set.name} and shows where each answer came from. If it isn't
              in your materials, Momentum says so.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {SUGGEST.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs border border-line/70 rounded-full px-3 py-1.5 text-soft hover:text-foreground hover:border-cool/50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-cool text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
                {m.content.replace(
                  /\n\n_\(general background requested\)_$/,
                  " · general background",
                )}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              <div className="md text-sm">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
              {!!m.sources?.refs?.length && (
                <div className="flex flex-wrap gap-1.5">
                  {m.sources.refs.map((r) => (
                    <details
                      key={r.id}
                      className="group text-xs rounded-lg border border-cool/30 bg-cool/5 max-w-full"
                    >
                      <summary className="cursor-pointer px-2 py-1 list-none">
                        <span className="text-cool2 font-semibold">[{r.id}]</span> {r.label}
                      </summary>
                      <p className="px-2 pb-2 text-soft whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {r.excerpt}
                        {r.excerpt.length >= 600 ? "…" : ""}
                      </p>
                    </details>
                  ))}
                </div>
              )}
              {m.sources?.notFound && i === msgs.length - 1 && !loading && (
                <button
                  onClick={() => send(lastUserQ(i), true)}
                  className="text-xs inline-flex items-center gap-1.5 border border-violet/40 text-violet rounded-full px-3 py-1.5 hover:bg-violet/10"
                >
                  <Globe className="size-3.5" /> Give me general background instead
                </button>
              )}
            </div>
          ),
        )}
        {loading && (
          <div className="text-soft text-sm inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Searching your materials…
          </div>
        )}
        {error && <ErrorBox msg={error} />}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="border-t border-line/60 p-3 flex gap-2 bg-ink2/60"
      >
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask anything about your materials…"
          className="flex-1 resize-none bg-foreground/5 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-cool2/60"
        />
        <button
          disabled={loading || !input.trim()}
          className="bg-brand text-ink rounded-lg px-4 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
