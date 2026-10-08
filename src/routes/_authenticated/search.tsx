import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Search as SearchIcon, Sparkles } from "lucide-react";
import { z } from "zod";
import { looksLikeQuestion, searchAll, terms, type Hit } from "@/lib/global-search";
import { searchAnswer } from "@/lib/explain.functions";
import { PageHeader } from "@/components/PageHeader";
import { btnGhost, btnPrimary, ErrorBox, inputCls } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/search")({
  ssr: false,
  validateSearch: z.object({ q: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Search Momentum" },
      {
        name: "description",
        content:
          "Search all your study sets, lectures, notes, flashcards, mistakes, essays and assignments at once.",
      },
      { property: "og:title", content: "Search Momentum" },
      { property: "og:description", content: "One search across everything you've studied." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

const TONE: Record<string, string> = {
  "Study Set": "border-cool/40 text-cool2",
  Material: "border-cool/40 text-cool2",
  Note: "border-mint/40 text-mint",
  "Study Guide": "border-mint/40 text-mint",
  Lecture: "border-violet/40 text-violet",
  Flashcard: "border-foreground/30 text-soft",
  Mistake: "border-destructive/40 text-destructive",
  File: "border-foreground/30 text-soft",
  "Essay Feedback": "border-violet/40 text-violet",
  Assignment: "border-violet/40 text-violet",
};

function highlight(text: string, ts: string[]) {
  if (!ts.length) return text;
  const re = new RegExp(
    `(${ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text.split(re).map((p, i) =>
    i % 2 ? (
      <mark key={i} className="bg-cool/30 text-foreground rounded px-0.5">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

function SearchPage() {
  const initial = Route.useSearch().q ?? "";
  const navigate = Route.useNavigate();
  const ask = useServerFn(searchAnswer);
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<"search" | "answer" | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState("");

  const getAnswer = async (query: string, found: Hit[]) => {
    setBusy("answer");
    try {
      const r = await ask({
        data: {
          query,
          snippets: found
            .slice(0, 12)
            .map((h) => ({
              label: `${h.kind}: ${h.title}`.slice(0, 200),
              text: h.context.slice(0, 4000),
            })),
        },
      });
      setAnswer(r.text);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't write an answer. Your results are still below.",
      );
    }
    setBusy(null);
  };

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (query.length < 2) return;
    navigate({ search: { q: query }, replace: true });
    setBusy("search");
    setError(null);
    setAnswer(null);
    try {
      const found = await searchAll(query);
      setHits(found);
      setRan(query);
      setBusy(null);
      if (found.length && looksLikeQuestion(query)) await getAnswer(query, found);
    } catch {
      setError("Search didn't finish. Check your connection and try again.");
      setBusy(null);
    }
  };

  useEffect(() => {
    if (initial) void run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ts = terms(ran);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title="Search Momentum"
        sub="Find anything across your sets, lectures, notes, flashcards, mistakes, essays and assignments."
      />
      <div className="p-5 md:p-8 max-w-3xl space-y-5">
        <form onSubmit={run} className="flex gap-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Try "separation of powers" or "what did I get wrong about federalism?"'
            className={inputCls + " flex-1 py-3"}
          />
          <button disabled={busy === "search"} className={btnPrimary}>
            {busy === "search" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SearchIcon className="size-4" />
            )}{" "}
            Search
          </button>
        </form>
        {error && <ErrorBox msg={error} />}
        {hits && ran && (
          <>
            {(answer || busy === "answer") && (
              <div className="rounded-2xl dpanel p-5">
                <p className="eyebrow text-cool2 mb-2 inline-flex items-center gap-1">
                  <Sparkles className="size-3" /> Answer from your materials
                </p>
                {busy === "answer" ? (
                  <p className="text-sm text-soft inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Reading your matches…
                  </p>
                ) : (
                  <div className="md text-sm">
                    <ReactMarkdown>{answer!}</ReactMarkdown>
                  </div>
                )}
                {answer && (
                  <p className="text-xs text-soft mt-3">
                    [S1], [S2]… refer to the numbered results below.
                  </p>
                )}
              </div>
            )}
            {hits.length > 0 && !answer && busy !== "answer" && (
              <button onClick={() => getAnswer(ran, hits)} className={btnGhost}>
                <Sparkles className="size-4" /> Answer this from my materials
              </button>
            )}
            <p className="text-xs text-soft">
              {hits.length
                ? `${hits.length} matches for "${ran}"`
                : `Nothing in your Momentum content matches "${ran}". Try different keywords.`}
            </p>
            {hits.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Matches by type">
                {[
                  ...hits.reduce(
                    (m, h) => m.set(h.kind, (m.get(h.kind) ?? 0) + 1),
                    new Map<string, number>(),
                  ),
                ].map(([k, n]) => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(kindFilter === k ? null : k)}
                    aria-pressed={kindFilter === k}
                    className={
                      "text-[11px] px-2.5 py-1 rounded-full border " +
                      (kindFilter === k
                        ? "border-cool2 bg-cool/20"
                        : (TONE[k as keyof typeof TONE] ?? "border-line/70"))
                    }
                  >
                    {k} · {n}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {hits.map((h, i) =>
                kindFilter && h.kind !== kindFilter ? null : (
                  <Link
                    key={i}
                    to={h.link.to as never}
                    params={h.link.params as never}
                    search={h.link.search as never}
                    className="block rounded-2xl bg-panel border border-line/70 p-4 hover:border-cool/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-soft font-mono">S{i + 1}</span>
                      <span
                        className={
                          "text-[11px] px-2 py-0.5 rounded-full border " + (TONE[h.kind] ?? "")
                        }
                      >
                        {h.kind}
                      </span>
                      <span className="text-sm font-semibold truncate">{h.title}</span>
                    </div>
                    <p className="text-sm text-soft">{highlight(h.snippet, ts)}</p>
                  </Link>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
