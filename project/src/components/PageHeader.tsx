import type { ReactNode } from "react";

export function PageHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 px-5 md:px-8 py-5 bg-ink/60 backdrop-blur-xl border-b border-line/60 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl md:text-3xl uppercase tracking-wide truncate">
          {title}
        </h1>
        {sub && <p className="text-sm text-soft">{sub}</p>}
      </div>
      {right}
    </header>
  );
}
