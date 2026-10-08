import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import type { TopicRow } from "@/lib/stats";

export const btnPrimary =
  "font-semibold text-sm bg-brand text-ink px-4 py-2 rounded-lg disabled:opacity-60 inline-flex items-center gap-2";
export const btnGhost =
  "font-semibold text-sm border border-foreground/20 px-4 py-2 rounded-lg hover:bg-foreground/5 disabled:opacity-60 inline-flex items-center gap-2";
export const inputCls =
  "bg-foreground/5 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-cool2/60";

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 flex gap-3 text-sm">
      <AlertCircle className="size-5 text-destructive shrink-0" />
      {msg}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  pct,
  tone = "text-cool2",
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-panel border border-line/70 p-4">
      <p className="eyebrow text-soft">{label}</p>
      <p className={cn("font-display text-3xl mt-1.5", tone)}>{value}</p>
      {sub && <p className="text-xs text-soft mt-0.5">{sub}</p>}
      {pct != null && <ProgressBar value={pct} className="mt-3" />}
    </div>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { v: T; l: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div>
      <p className="eyebrow text-soft mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            type="button"
            key={String(o.v)}
            onClick={() => onChange(o.v)}
            className={cn(
              "px-3.5 py-1.5 text-sm font-semibold rounded-lg border transition-colors",
              value === o.v
                ? "bg-cool/20 border-cool/40 text-foreground"
                : "border-line/70 text-soft hover:text-foreground",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

const statusTone = {
  "Needs review": "text-destructive",
  Improving: "text-cool2",
  Strong: "text-mint",
} as const;

export function TopicList({ topics, empty }: { topics: TopicRow[]; empty?: string }) {
  if (!topics.length)
    return (
      <p className="text-sm text-soft">{empty ?? "Take a quiz to see which topics need work."}</p>
    );
  return (
    <ul className="space-y-2.5">
      {topics.slice(0, 8).map((t) => (
        <li key={t.topic}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{t.topic}</span>
            <span className={cn("eyebrow shrink-0", statusTone[t.status])}>{t.status}</span>
          </div>
          <ProgressBar value={t.accuracy} className="mt-1.5 h-1" />
        </li>
      ))}
    </ul>
  );
}
