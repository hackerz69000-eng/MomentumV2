import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { Compass, Loader2, Send } from "lucide-react";
import { askCoach } from "@/lib/study.functions";
import { dayKey } from "@/lib/activity";
import { btnPrimary, ErrorBox, inputCls } from "@/components/set/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/coach")({
  ssr: false,
  validateSearch: z.object({ set: z.string().min(1).max(200).optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Momentum Coach — Momentum" },
      {
        name: "description",
        content: "Personalized study recommendations from your progress and exam dates.",
      },
      { property: "og:title", content: "Momentum Coach — Momentum" },
      { property: "og:description", content: "Know exactly what to study next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoachPage,
});

type Msg = { role: "user" | "assistant"; content: string };
const SUGGEST = [
  "What should I review before my test?",
  "What am I weakest at?",
  "Am I ready for my test?",
  "How should I use my 30 minutes today?",
];

function CoachPage() {
  const { set } = Route.useSearch();
  const ask = useServerFn(askCoach);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, busy]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = msgs.slice(-8);
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await ask({
        data: {
          question: q,
          history,
          setId: set ?? null,
          today: dayKey(new Date().toISOString()),
          tzOffset: new Date().getTimezoneOffset(),
        },
      });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The coach couldn't respond");
    }
    setBusy(false);
  };

  return (
    <main className="flex-1 min-w-0">
      <header className="sticky top-0 z-20 px-5 md:px-8 py-5 bg-ink/60 backdrop-blur-xl border-b border-line/60">
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide">
          Momentum Coach
        </h1>
        <p className="text-sm text-soft">
          Your study planner — uses your exam dates, results and streak. For explanations of
          content, use the AI Tutor in a study set.
        </p>
      </header>
      <div className="p-5 md:p-8 max-w-3xl mx-auto space-y-4">
        <button
          onClick={() => send("What should I study now?")}
          disabled={busy}
          className={btnPrimary + " w-full justify-center py-3"}
        >
          <Compass className="size-4" /> What should I study now?
        </button>
        <div className="flex flex-wrap gap-2">
          {SUGGEST.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-full border border-line/70 text-soft hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {msgs.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-2xl p-4 text-sm",
                m.role === "user"
                  ? "bg-cool/15 border border-cool/30 ml-12"
                  : "bg-panel border border-line/70 prose prose-invert prose-sm max-w-none",
              )}
            >
              {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-soft">
              <Loader2 className="size-4 animate-spin" /> Looking at your progress…
            </div>
          )}
          {error && <ErrorBox msg={error} />}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the coach…"
            className={cn(inputCls, "flex-1")}
          />
          <button disabled={busy || !input.trim()} className={btnPrimary} aria-label="Send">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </main>
  );
}
