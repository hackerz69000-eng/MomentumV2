import { useQuery } from "@tanstack/react-query";
import { Flame, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { achievements, activityStats } from "@/lib/activity";
import { cn } from "@/lib/utils";

export function StreakCard() {
  const { data } = useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_activity")
        .select("kind, count, created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const s = activityStats(data ?? []);
  const ach = achievements(s);
  const stats: [string, number][] = [
    ["Longest streak", s.longest],
    ["Days studied", s.daysStudied],
    ["Sessions", s.sessions],
    ["Cards reviewed", s.flashcards],
    ["Quizzes", s.quizzes],
    ["Exams", s.exams],
    ["Active Recall", s.recall],
  ];
  return (
    <section className="px-5 md:px-8 pt-8">
      <div className="rounded-2xl bg-panel border border-line/70 p-5 grid lg:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="flex items-center gap-3">
          <Flame className={cn("size-8", s.current ? "text-cool2" : "text-soft")} />
          <div>
            <p className="font-display text-3xl">
              {s.current} day{s.current === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-soft">
              {s.studiedToday
                ? "Studied today"
                : s.current
                  ? "Study today to keep your streak"
                  : "Current streak"}
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {stats.map(([l, v]) => (
              <span key={l}>
                <span className="text-soft">{l}</span> <span className="font-semibold">{v}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ach.map((a) => (
              <span
                key={a.name}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1",
                  a.done
                    ? "border-mint/40 bg-mint/10 text-foreground"
                    : "border-line/70 text-soft/70",
                )}
              >
                {a.done && <Check className="size-3 text-mint" />} {a.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
