// Universal Momentum search: keyword matching across the user's content (RLS scopes it to their rows).
import { supabase } from "@/integrations/supabase/client";

export type HitKind =
  | "Study Set"
  | "Material"
  | "Note"
  | "Study Guide"
  | "Lecture"
  | "Flashcard"
  | "Mistake"
  | "File"
  | "Essay Feedback"
  | "Assignment";
export type Hit = {
  kind: HitKind;
  title: string;
  snippet: string;
  context: string; // larger text window for grounded answers
  score: number;
  link: { to: string; params?: Record<string, string>; search?: Record<string, string> };
};

const STOP = new Set(
  "the a an and or of to in on at for is are was were be by with about what did do does i my me we you your where when why how which who find show notes note get got wrong mention mentioned this that it from into as can could should would there their them have has had any all say said tell".split(
    " ",
  ),
);

export function terms(q: string) {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 5);
}

function window(text: string, ts: string[], phrase: string, radius: number) {
  const lower = text.toLowerCase();
  let idx = phrase ? lower.indexOf(phrase) : -1;
  if (idx < 0)
    for (const t of ts) {
      idx = lower.indexOf(t);
      if (idx >= 0) break;
    }
  if (idx < 0) return "";
  const s = Math.max(0, idx - radius);
  return (
    (s > 0 ? "…" : "") +
    text
      .slice(s, idx + radius)
      .replace(/\s+/g, " ")
      .trim() +
    (idx + radius < text.length ? "…" : "")
  );
}

function scoreText(text: string, ts: string[], phrase: string) {
  const l = text.toLowerCase();
  let sc = phrase && l.includes(phrase) ? 5 : 0;
  for (const t of ts) if (l.includes(t)) sc += 1;
  return sc;
}

const orFor = (cols: string[], ts: string[]) =>
  cols.flatMap((c) => ts.map((t) => `${c}.ilike.%${t}%`)).join(",");

export async function searchAll(query: string): Promise<Hit[]> {
  const ts = terms(query);
  if (!ts.length) return [];
  const phrase = ts.length > 1 ? ts.join(" ") : "";
  const hits: Hit[] = [];
  const add = (kind: HitKind, title: string, text: string, link: Hit["link"], bonus = 0) => {
    if (!text) return;
    const sc = scoreText(text + " " + title, ts, phrase);
    if (!sc) return;
    hits.push({
      kind,
      title,
      snippet: window(text, ts, phrase, 140) || text.slice(0, 200),
      context: window(text, ts, phrase, 900) || text.slice(0, 1500),
      score: sc + bonus,
      link,
    });
  };
  const sb = supabase as any;
  const [sets, lectures, cards, mistakes, files, essays, assignments] = await Promise.all([
    sb
      .from("study_sets")
      .select("id, name, subject, material_text, notes, study_guide")
      .or(orFor(["name", "material_text", "notes", "study_guide"], ts))
      .limit(30),
    sb
      .from("lectures")
      .select("id, set_id, title, transcript, notes, study_sets(name)")
      .or(orFor(["title", "transcript", "notes"], ts))
      .limit(30),
    sb
      .from("flashcards")
      .select("id, set_id, question, answer, study_sets(name)")
      .or(orFor(["question", "answer"], ts))
      .limit(40),
    sb
      .from("mistakes")
      .select(
        "id, set_id, question, correct_answer, student_answer, topic, explanation, study_sets(name)",
      )
      .or(orFor(["question", "correct_answer", "topic", "explanation"], ts))
      .limit(40),
    sb
      .from("study_files")
      .select("id, set_id, name, study_sets(name)")
      .or(orFor(["name"], ts))
      .limit(20),
    sb
      .from("essay_grades")
      .select("id, title, essay, result")
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("assignments")
      .select("id, title, instructions, understanding, brainstorm, outline, draft")
      .or(orFor(["title", "instructions", "understanding", "brainstorm", "outline", "draft"], ts))
      .limit(20),
  ]);
  for (const s of sets.data ?? []) {
    const setLink = (tab: string) => ({ to: "/sets/$id", params: { id: s.id }, search: { tab } });
    add("Study Set", s.name, `${s.name} ${s.subject ?? ""}`, setLink("overview"), 2);
    add("Material", s.name, s.material_text ?? "", setLink("materials"));
    add("Note", s.name, s.notes ?? "", setLink("notes"), 1);
    add("Study Guide", s.name, s.study_guide ?? "", setLink("guide"));
  }
  for (const l of lectures.data ?? [])
    add(
      "Lecture",
      `${l.title} · ${l.study_sets?.name ?? ""}`,
      `${l.notes ?? ""}\n${l.transcript ?? ""}`,
      { to: "/sets/$id", params: { id: l.set_id }, search: { tab: "lectures" } },
    );
  for (const c of cards.data ?? [])
    add("Flashcard", c.study_sets?.name ?? "Flashcard", `Q: ${c.question}\nA: ${c.answer}`, {
      to: "/sets/$id",
      params: { id: c.set_id },
      search: { tab: "flashcards" },
    });
  for (const m of mistakes.data ?? [])
    add(
      "Mistake",
      `${m.topic} · ${m.study_sets?.name ?? ""}`,
      `Question: ${m.question}\nYour answer: ${m.student_answer}\nCorrect answer: ${m.correct_answer}\n${m.explanation ?? ""}`,
      { to: "/sets/$id", params: { id: m.set_id }, search: { tab: "mistakes" } },
      /wrong|mistake|miss/i.test(query) ? 2 : 0,
    );
  for (const f of files.data ?? [])
    add("File", `${f.name} · ${f.study_sets?.name ?? ""}`, f.name, {
      to: "/sets/$id",
      params: { id: f.set_id },
      search: { tab: "materials" },
    });
  for (const e of essays.data ?? [])
    add(
      "Essay Feedback",
      e.title || "Essay",
      `${e.result ? JSON.stringify(e.result).replace(/[{}[\]"]/g, " ") : ""}\n${e.essay}`,
      { to: "/essay/$id", params: { id: e.id } },
    );
  for (const a of assignments.data ?? [])
    add(
      "Assignment",
      a.title || "Assignment",
      [a.instructions, a.understanding, a.brainstorm, a.outline, a.draft]
        .filter(Boolean)
        .join("\n"),
      { to: "/assignment/$id", params: { id: a.id } },
    );
  return hits.sort((a, b) => b.score - a.score).slice(0, 40);
}

export const looksLikeQuestion = (q: string) =>
  /\?\s*$/.test(q) || /^(what|why|how|who|when|which|explain|did|does|is|are)\b/i.test(q.trim());
