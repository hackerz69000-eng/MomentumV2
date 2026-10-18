import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2 } from "lucide-react";
import { generatePlan, type PlanDay } from "@/lib/study.functions";
import type { StudySet } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { btnPrimary, ErrorBox, inputCls } from "./ui";

const localISO = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function Plan({ set, weakTopics }: { set: StudySet; weakTopics: string[] }) {
  const qc = useQueryClient();
  const gen = useServerFn(generatePlan);
  const [examDate, setExamDate] = useState(set.exam_date ?? "");
  const [minutes, setMinutes] = useState(set.minutes_per_day ?? 45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = (set.plan as PlanDay[] | null) ?? null;
  const today = localISO();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examDate) return;
    setLoading(true);
    setError(null);
    try {
      await gen({
        data: { setId: set.id, examDate, today, minutesPerDay: Number(minutes), weakTopics },
      });
      await qc.invalidateQueries({ queryKey: ["set", set.id] });
      toast.success("Study plan ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create plan");
    }
    setLoading(false);
  };

  const daysLeft = set.exam_date
    ? Math.round((Date.parse(set.exam_date) - Date.parse(today)) / 86400000)
    : null;

  return (
    <div className="max-w-3xl space-y-5">
      <form onSubmit={create} className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6">
        <p className="eyebrow text-cool2">Study plan</p>
        <h2 className="font-display text-2xl uppercase mt-1">
          {plan ? "Update your plan" : "Plan your way to test day"}
        </h2>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <label className="space-y-1.5">
            <span className="text-sm block">Test date</span>
            <input
              type="date"
              required
              min={today}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm block">Minutes per day</span>
            <input
              type="number"
              min={10}
              max={600}
              step={5}
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={inputCls + " w-28"}
            />
          </label>
          <button disabled={loading} className={btnPrimary}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarDays className="size-4" />
            )}{" "}
            {plan ? "Rebuild plan" : "Create plan"}
          </button>
        </div>
        {weakTopics.length > 0 && (
          <p className="text-xs text-soft mt-3">Extra time will go to: {weakTopics.join(", ")}</p>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBox msg={error} />
          </div>
        )}
      </form>

      {plan && (
        <div className="space-y-2">
          {daysLeft != null && daysLeft >= 0 && (
            <p className="text-sm text-soft">
              {daysLeft === 0
                ? "Test is today — good luck!"
                : `${daysLeft} day${daysLeft === 1 ? "" : "s"} until your test`}
            </p>
          )}
          {plan.map((d) => {
            const isToday = d.date === today;
            const past = d.date < today;
            const label = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
            return (
              <div
                key={d.date}
                className={cn(
                  "rounded-xl border p-4 flex gap-4",
                  isToday ? "border-cool2/60 bg-cool/10" : "border-line/70 bg-panel",
                  past && "opacity-50",
                )}
              >
                <div className="w-32 shrink-0">
                  <p className={cn("eyebrow", isToday ? "text-cool2" : "text-soft")}>
                    {isToday ? "Today" : label.split(",")[0]}
                  </p>
                  <p className="text-xs text-soft mt-0.5">{label.split(",").slice(1).join(",")}</p>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{d.title}</p>
                  <ul className="text-sm text-soft mt-1 space-y-0.5">
                    {d.tasks.map((t, k) => (
                      <li key={k}>• {t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
