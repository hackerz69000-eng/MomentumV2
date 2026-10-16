import { useMemo, useState, type ReactNode } from "react";
import { Search as SearchIcon } from "lucide-react";
import type { StudySet } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { inputCls } from "./ui";

type Source = "Material" | "Notes" | "Study Guide";
type Section = { id: string; source: Source; title: string; text: string };

function sections(source: Source, text: string | null): Section[] {
  if (!text?.trim()) return [];
  const md = source !== "Material";
  const parts = md ? text.split(/\n(?=#{1,3} )/) : text.split(/\n\s*\n|(?=\n=== )|(?=\n## Slide )/);
  const out: Section[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t)
      out.push({
        id: `${source}-${out.length}`,
        source,
        title: md ? (t.match(/^#{1,3} (.+)/)?.[1] ?? "Section") : t.split("\n")[0]!.slice(0, 80),
        text: t,
      });
    buf = "";
  };
  for (const p of parts) {
    buf += (buf ? "\n\n" : "") + p;
    if (md || buf.length > 600) flush();
  }
  flush();
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${esc(q)})`, "gi"));
  return parts.map((p, i) =>
    i % 2 ? (
      <mark key={i} className="bg-cool2/40 text-foreground rounded px-0.5">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, i - 90);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, i + q.length + 140).replace(/\s+/g, " ") +
    (i + q.length + 140 < text.length ? "…" : "")
  );
}

export function Search({ set }: { set: StudySet }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(
    () => [
      ...sections("Notes", set.notes),
      ...sections("Study Guide", set.study_guide),
      ...sections("Material", set.material_text),
    ],
    [set.notes, set.study_guide, set.material_text],
  );
  const term = q.trim();
  const results = useMemo(() => {
    if (term.length < 2) return [];
    const t = term.toLowerCase();
    return all
      .map((s) => ({
        s,
        n: s.text.toLowerCase().split(t).length - 1,
        title: s.title.toLowerCase().includes(t),
      }))
      .filter((r) => r.n > 0)
      .sort((a, b) => Number(b.title) - Number(a.title) || b.n - a.n)
      .slice(0, 50);
  }, [all, term]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="relative">
        <SearchIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(null);
          }}
          placeholder="Search words, definitions, topics, names, formulas…"
          className={cn(inputCls, "w-full pl-9 py-3")}
        />
      </div>
      <p className="text-xs text-soft">
        Searches your original material, notes{set.study_guide ? " and study guide" : ""}.
      </p>
      {term.length >= 2 && results.length === 0 && (
        <div className="rounded-2xl bg-panel border border-line/70 p-6 text-center text-sm">
          Nothing matching "{term}" was found in this study set.
        </div>
      )}
      {results.length > 0 && (
        <p className="text-sm text-soft">
          {results.length} matching section{results.length === 1 ? "" : "s"}
        </p>
      )}
      <ul className="space-y-2">
        {results.map(({ s, n }) => (
          <li key={s.id} className="rounded-2xl bg-panel border border-line/70">
            <button
              onClick={() => setOpen(open === s.id ? null : s.id)}
              className="w-full text-left p-4"
            >
              <div className="flex justify-between gap-3">
                <span className="font-semibold text-sm truncate">
                  <Highlight text={s.title} q={term} />
                </span>
                <span className="eyebrow text-cool2 shrink-0">
                  {s.source} · {n}×
                </span>
              </div>
              {open !== s.id && (
                <p className="text-sm text-soft mt-1.5">
                  <Highlight text={snippet(s.text, term)} q={term} />
                </p>
              )}
            </button>
            {open === s.id && (
              <div className="px-4 pb-4 text-sm whitespace-pre-wrap leading-relaxed border-t border-line/60 pt-3 max-h-[60vh] overflow-y-auto">
                <Highlight text={s.text} q={term} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
