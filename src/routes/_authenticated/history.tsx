import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
    });
  }
  return out.reverse();
}

function HistoryPage() {
  const since = new Date(Date.now() - 31 * 86400000).toISOString();
  const q = useQuery({
    queryKey: ["activity", "history"],
    queryFn: async () => {
      try {
        const [{ data: rows, error }, { data: sets }] = await Promise.all([
          supabase
            .from("study_activity")
            .select("id, kind, count, created_at, set_id, score, total, duration_seconds, meta")
            .gte("created_at", since)
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
  const buckets: [string, Item[]][] = [
    ["Today", []],
    ["Yesterday", []],
    ["Previous 7 days", []],
    ["Previous 30 days", []],
  ];
  for (const it of q.data?.items ?? []) {
    const d = dayKey(it.at);
    const age = (Date.parse(today) - Date.parse(d)) / 86400000;
    (d === today
      ? buckets[0]
      : d === yesterday
        ? buckets[1]
        : age <= 7
          ? buckets[2]
          : buckets[3])![1].push(it);
  }

  return (
    <main className="flex-1 min-w-0">
      <header className="sticky top-0 z-20 px-5 md:px-8 py-5 bg-ink/60 backdrop-blur-xl border-b border-line/60">
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide">Study History</h1>
        <p className="text-sm text-soft">
          Your last 30 days. Click an item to go back to that study set.
        </p>
      </header>
      <div className="p-5 md:p-8 max-w-3xl space-y-6">
        {q.isLoading && <Loader2 className="size-6 animate-spin text-cool2" />}
        {q.data && q.data.items.length === 0 && (
          <p className="text-sm text-soft">No study activity in the last 30 days yet.</p>
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
                            ((it as { meta?: { sets?: string[] } }).meta?.sets?.length
                              ? {
                                  include: (it as { meta?: { sets?: string[] } }).meta!.sets!.join(
                                    ",",
                                  ),
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
