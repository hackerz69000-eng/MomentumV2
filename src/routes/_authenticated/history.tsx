import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ArrowUpRight, Filter, ClipboardCheck } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { dayKey } from "@/lib/activity";

export const Route = createFileRoute("/_authenticated/history")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Study History — Momentum" },
      {
        name: "description",
        content: "See what you studied today, yesterday and over the past month.",
      },
      { property: "og:title", content: "Study History — Momentum" },
      { property: "og:description", content: "Your recent study sessions and scores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

type Row = {
  id: string;
  kind: string;
  count: number;
  created_at: string;
  set_id: string | null;
  score: number | null;
  total: number | null;
  duration_seconds: number | null;
  meta: unknown;
};
type Item = {
  id: string;
  kind: string;
  at: string;
  setId: string | null;
  count: number;
  score: number | null;
  total: number | null;
  seconds: number | null;
  correct?: number;
  meta?: unknown;
};

const LABEL: Record<string, string> = {
  flashcard: "Flashcards",
  quiz: "Quiz",
  adaptive: "Adaptive Quiz",
  exam: "Practice Exam",
  comprehensive: "Comprehensive Exam",
  recall: "Active Recall",
  guide: "Study Guide generated",
  session: "Study Everything session",
  mistake: "Mistake Bank review",
  lecture: "Lecture recorded",
  audio: "Audio Study",
};
const TAB: Record<
  string,
  | "flashcards"
  | "quiz"
  | "exam"
  | "recall"
  | "guide"
  | "everything"
  | "mistakes"
  | "lectures"
  | "audio"
> = {
  mistake: "mistakes",
  lecture: "lectures",
  audio: "audio",
  flashcard: "flashcards",
  quiz: "quiz",
  adaptive: "quiz",
  exam: "exam",
  recall: "recall",
  guide: "guide",
  session: "everything",
};

/** Groups per-card/per-question rows into sessions (same set + kind, under 30 min apart). */
function group(rows: Row[]): Item[] {
  const out: Item[] = [];
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const last = out[out.length - 1];
    if (
      last &&
      (r.kind === "flashcard" || r.kind === "recall") &&
      last.kind === r.kind &&
      last.setId === r.set_id &&
      Date.parse(r.created_at) - Date.parse(last.at) < 30 * 60000
    ) {
      last.count += r.count;
      last.at = r.created_at;
      if (r.kind === "recall") {
        last.total = (last.total ?? 0) + (r.total ?? 1);
        last.score = (last.score ?? 0) + (r.score ?? 0);
      }
      continue;
    }
    out.push({
      id: r.id,
      kind: r.kind,
      at: r.created_at,
      setId: r.set_id,
      count: r.count,
      score: r.score,
      total: r.kind === "recall" ? (r.total ?? 1) : r.total,
      seconds: r.duration_seconds,
      meta: r.meta,
    });
  }
  return out.reverse();
}

function HistoryPage() {
  const [searchText, setSearchText] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const attemptsQ = useQuery({
    queryKey: ["attempts", "history-review"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quiz_attempts").select("id, kind, created_at, score, total, duration_seconds, set_id").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const q = useQuery({
    queryKey: ["activity", "history"],
    queryFn: async () => {
      try {
        const [{ data: rows, error }, { data: sets }] = await Promise.all([
          supabase
            .from("study_activity")
            .select("id, kind, count, created_at, set_id, score, total, duration_seconds, meta")
            .order("created_at", { ascending: false })
            .limit(3000),
          supabase.from("study_sets").select("id, name"),
        ]);
        if (!error && rows) {
          return {
            items: group(rows as Row[]),
            names: new Map((sets ?? []).map((s) => [s.id, s.name])),
          };
        }
      } catch {
        // fallback
      }
      return {
        items: [],
        names: new Map(),
      };
    },
  });
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  const filteredItems = (q.data?.items ?? []).filter((it) => {
    const name = it.setId ? q.data?.names.get(it.setId) ?? "" : "";
    const matchesText = `${LABEL[it.kind] ?? it.kind} ${name}`.toLowerCase().includes(searchText.trim().toLowerCase());
    const matchesKind = kindFilter === "all" || (kindFilter === "study" ? ["guide", "session", "lecture", "audio", "mistake"].includes(it.kind) : kindFilter === "practice" ? ["quiz", "adaptive", "exam", "comprehensive", "recall", "flashcard"].includes(it.kind) : it.kind === kindFilter);
    return matchesText && matchesKind;
  });
  const buckets: [string, Item[]][] = [
    ["Today", []],
    ["Yesterday", []],
    ["Previous 7 days", []],
    ["Previous 30 days", []],
    ["Earlier", []],
  ];
  for (const it of filteredItems) {
    const d = dayKey(it.at);
    const age = (Date.parse(today) - Date.parse(d)) / 86400000;
    (d === today
      ? buckets[0]
      : d === yesterday
        ? buckets[1]
        : age <= 7
          ? buckets[2]
          : age <= 30
            ? buckets[3]
            : buckets[4])![1].push(it);
  }

  return (
    <main className="flex-1 min-w-0">
      <header className="sticky top-0 z-20 px-5 md:px-8 py-5 bg-ink/60 backdrop-blur-xl border-b border-line/60">
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide">Study History</h1>
        <p className="text-sm text-soft">
          Your recorded study work across available dates. Search it, filter it, and reopen the relevant tool or study set.
        </p>
      </header>
      <div className="p-5 md:p-8 max-w-3xl space-y-6">
        <section className="rounded-2xl bg-panel border border-line/70 p-4 space-y-3">
          <div><h2 className="font-display text-lg uppercase tracking-wide">Quiz & Exam Results</h2><p className="text-xs text-soft">Open a completed attempt any time to review your answers and explanations.</p></div>
          {attemptsQ.isLoading && <Loader2 className="size-5 animate-spin text-cool2"/>}
          {attemptsQ.data?.length === 0 && <p className="text-sm text-soft">Your completed quizzes and exams will appear here.</p>}
          <div className="space-y-2">{(attemptsQ.data ?? []).map((a) => {
            const setName = a.set_id ? q.data?.names.get(a.set_id) : null;
            return <Link key={a.id} to="/attempts/$id" params={{ id: a.id }} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 p-3 hover:border-cool/50 transition-colors"><div className="flex items-center gap-3 min-w-0"><ClipboardCheck className="size-4 text-cool2 shrink-0"/><div className="min-w-0"><p className="text-sm font-semibold">{a.kind === "exam" || a.kind === "comprehensive" ? "Exam" : "Quiz"}{setName ? ` · ${setName}` : a.kind === "comprehensive" ? " · Multiple sets" : ""}</p><p className="text-xs text-soft">{new Date(a.created_at).toLocaleString()} {a.duration_seconds ? `· ${Math.max(1, Math.round(a.duration_seconds / 60))} min` : ""}</p></div></div><div className="text-right shrink-0"><p className="text-sm font-semibold">{a.score}/{a.total}</p><p className="text-xs text-cool2">{a.total ? Math.round(a.score / a.total * 100) : 0}% · Review</p></div></Link>;
          })}</div>
        </section>
        <div className="grid sm:grid-cols-[1fr_200px] gap-3">
          <label className="flex items-center gap-2 rounded-xl bg-panel border border-line px-3 py-2.5">
            <Search className="size-4 text-soft shrink-0" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search past study work or set names…" className="min-w-0 w-full bg-transparent text-sm outline-none" />
          </label>
          <label className="flex items-center gap-2 rounded-xl bg-panel border border-line px-3 py-2.5">
            <Filter className="size-4 text-soft shrink-0" />
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="w-full bg-transparent text-sm outline-none text-foreground">
              <option value="all">All activity</option>
              <option value="study">Study tools & sessions</option>
              <option value="practice">Practice & testing</option>
              <option value="flashcard">Flashcards</option>
              <option value="guide">Study guides</option>
              <option value="lecture">Lectures</option>
              <option value="audio">Audio study</option>
              <option value="mistake">Mistake Bank</option>
            </select>
          </label>
        </div>
        {q.isLoading && <Loader2 className="size-6 animate-spin text-cool2" />}
        {q.data && q.data.items.length === 0 && (
          <p className="text-sm text-soft">No saved activity found yet. Completed work will appear here when the activity is recorded.</p>
        )}
        {q.data && q.data.items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-soft">No past work matches that search or filter.</p>
        )}
        {buckets
          .filter(([, items]) => items.length)
          .map(([label, items]) => (
            <section key={label}>
              <h2 className="eyebrow text-cool2 mb-2">{label}</h2>
              <ul className="space-y-2">
                {items.map((it) => {
                  const name = it.setId ? q.data!.names.get(it.setId) : null;
                  const body = (
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-panel border border-line/70 p-3 hover:border-cool/40">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{LABEL[it.kind] ?? it.kind}</p>
                        <p className="text-xs text-soft truncate">
                          {new Date(it.at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {name
                            ? ` · ${name}`
                            : it.kind === "comprehensive"
                              ? " · multiple sets"
                              : ""}
                          {it.seconds ? ` · ${Math.max(1, Math.round(it.seconds / 60))} min` : ""}
                        </p>
                      </div>
                      <span className="text-sm text-right shrink-0">
                        {it.kind === "flashcard" && `${it.count} cards`}
                        {it.kind === "recall" && `${it.score ?? 0}/${it.total} correct`}
                        {it.total && !["flashcard", "recall"].includes(it.kind)
                          ? `${it.score}/${it.total} · ${Math.round(((it.score ?? 0) / it.total) * 100)}%`
                          : ""}
                      </span>
                      {(it.setId && name) || it.kind === "comprehensive" ? <span className="text-[11px] font-semibold text-cool2 inline-flex items-center gap-1 shrink-0">Reopen <ArrowUpRight className="size-3" /></span> : null}
                    </div>
                  );
                  return (
                    <li key={it.id}>
                      {it.setId && name ? (
                        <Link
                          to="/sets/$id"
                          params={{ id: it.setId }}
                          search={{ tab: TAB[it.kind] ?? "overview" }}
                        >
                          {body}
                        </Link>
                      ) : it.kind === "comprehensive" ? (
                        <Link
                          to="/exam"
                          search={
                            ((it.meta as { sets?: string[] } | null)?.sets?.length
                              ? {
                                  include: (it.meta as { sets: string[] }).sets.join(","),
                                }
                              : {}) as never
                          }
                        >
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>
    </main>
  );
}
