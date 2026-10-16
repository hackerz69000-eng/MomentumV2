import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchSets } from "@/lib/queries";
import type { Attempt } from "@/lib/stats";
import { QuizRunner } from "@/components/set/QuizRunner";
import { btnPrimary } from "@/components/set/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/exam")({
  ssr: false,
  validateSearch: z.object({ include: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Comprehensive Exam — Momentum" },
      { name: "description", content: "Combine several study sets into one large practice exam." },
      { property: "og:title", content: "Comprehensive Exam — Momentum" },
      { property: "og:description", content: "One exam across all your study sets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamPage,
});

function ExamPage() {
  const { include } = Route.useSearch();
  const setsQ = useQuery({ queryKey: ["sets"], queryFn: fetchSets });
  const attemptsQ = useQuery({
    queryKey: ["all-attempts"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("kind", "comprehensive")
          .order("created_at");
        if (error) return [];
        return (data ?? []) as Attempt[];
      } catch {
        return [];
      }
    },
  });
  const [picked, setPicked] = useState<string[]>(include ? include.split(",") : []);
  const [started, setStarted] = useState(false);
  const ready = (setsQ.data ?? []).filter((s) => s.status === "ready");
  const chosen = ready.filter((s) => picked.includes(s.id));

  return (
    <main className="flex-1 min-w-0">
      <header className="sticky top-0 z-20 px-5 md:px-8 py-5 bg-ink/60 backdrop-blur-xl border-b border-line/60">
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide">
          Comprehensive Exam
        </h1>
        <p className="text-sm text-soft">Combine multiple study sets into one exam.</p>
      </header>
      <div className="p-5 md:p-8">
        {setsQ.isLoading ? (
          <Loader2 className="size-6 animate-spin text-cool2 mx-auto" />
        ) : started && chosen.length >= 2 ? (
          <QuizRunner
            kind="comprehensive"
            sets={chosen}
            attempts={attemptsQ.data ?? []}
            onExit={() => setStarted(false)}
          />
        ) : (
          <div className="max-w-2xl mx-auto rounded-2xl bg-panel border border-line/70 p-6 space-y-4">
            <p className="eyebrow text-soft">Select at least 2 study sets</p>
            {ready.length < 2 && (
              <p className="text-sm text-soft">
                You need at least two ready study sets to build a comprehensive exam.
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-2">
              {ready.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setPicked((p) =>
                        on ? p.filter((x) => x !== s.id) : p.length >= 10 ? p : [...p, s.id],
                      )
                    }
                    className={cn(
                      "text-left rounded-xl border p-3 text-sm",
                      on ? "border-cool/50 bg-cool/15" : "border-line/70 hover:border-cool/30",
                    )}
                  >
                    <p className="font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-soft">{s.subject || "General"}</p>
                  </button>
                );
              })}
            </div>
            <button
              disabled={chosen.length < 2}
              onClick={() => setStarted(true)}
              className={btnPrimary}
            >
              Continue with {chosen.length} {chosen.length === 1 ? "set" : "sets"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
