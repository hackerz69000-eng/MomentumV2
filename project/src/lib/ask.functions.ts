import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";

export const NOT_FOUND = "I couldn't find that in your study materials.";
export type SourceRef = { id: string; label: string; excerpt: string };
type Chunk = { label: string; text: string };

/** Split every source in the set into labelled chunks the model can cite. */
function chunkSources(
  set: { material_text: string; notes?: string | null; study_guide?: string | null },
  lectures: { title: string; transcript: string; notes: string | null }[],
): Chunk[] {
  const out: Chunk[] = [];
  const push = (label: string, text: string, size = 2500) => {
    const clean = text.trim();
    if (!clean) return;
    const paras = clean.split(/\n{2,}/);
    let buf = "";
    let part = 1;
    for (const p of paras) {
      if ((buf + "\n\n" + p).length > size && buf) {
        out.push({
          label: `${label}${part > 1 || clean.length > size ? ` (part ${part})` : ""}`,
          text: buf,
        });
        part++;
        buf = p;
      } else buf = buf ? buf + "\n\n" + p : p;
    }
    if (buf) out.push({ label: `${label}${part > 1 ? ` (part ${part})` : ""}`, text: buf });
  };
  // Material: files are separated by "=== name ===" headers.
  const files = set.material_text.split(/^=== (.+?) ===$/m);
  if (files.length > 1) {
    if (files[0]!.trim()) push("Study material", files[0]!);
    for (let i = 1; i < files.length; i += 2) push(`File: ${files[i]}`, files[i + 1] ?? "");
  } else push("Study material", set.material_text);
  const sections = (md: string | null | undefined, label: string) => {
    for (const s of (md ?? "").split(/\n(?=## )/)) {
      const h = s.match(/^## (.+)/)?.[1];
      push(h ? `${label} — ${h.trim()}` : label, s);
    }
  };
  for (const l of lectures) {
    push(`Lecture transcript: ${l.title}`, l.transcript);
    sections(l.notes, `Lecture notes: ${l.title}`);
  }
  sections(set.notes, "Generated notes");
  sections(set.study_guide, "Study guide");
  return out;
}

const words = (t: string) => t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
const STOP = new Set(
  "the and for are but not you all any can had her was one our out has have what when where which who why how with this that from they will would there their about into than then them these those does did your my me explain tell give".split(
    " ",
  ),
);

function pick(chunks: Chunk[], query: string, budget = 45000): Chunk[] {
  const total = chunks.reduce((s, c) => s + c.text.length, 0);
  if (total <= budget) return chunks;
  const q = [...new Set(words(query).filter((w) => !STOP.has(w)))];
  const scored = chunks.map((c, i) => {
    const lw = c.text.toLowerCase();
    const label = c.label.toLowerCase();
    let score = 0;
    for (const w of q) {
      const n = lw.split(w).length - 1;
      score += Math.min(n, 6) + (label.includes(w) ? 3 : 0);
    }
    if (/notes|guide/.test(label)) score += 0.5;
    return { c, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen: typeof scored = [];
  let used = 0;
  for (const s of scored) {
    if (used + s.c.text.length > budget) continue;
    chosen.push(s);
    used += s.c.text.length;
  }
  return chosen.sort((a, b) => a.i - b.i).map((s) => s.c);
}

export const askMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        content: z.string().min(1).max(4000),
        general: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const set = await loadSet(sb, data.setId);
    const { data: userMsg } = await sb
      .from("material_messages")
      .insert({
        set_id: set.id,
        user_id: context.userId,
        role: "user",
        content: data.general
          ? `${data.content}\n\n_(general background requested)_`
          : data.content,
      })
      .select("id")
      .single();
    try {
      const [{ data: lectures }, { data: hist }] = await Promise.all([
        sb
          .from("lectures")
          .select("title, transcript, notes")
          .eq("set_id", set.id)
          .neq("transcript", ""),
        sb
          .from("material_messages")
          .select("role, content")
          .eq("set_id", set.id)
          .order("created_at", { ascending: false })
          .limit(11),
      ]);
      const history = ((hist ?? []) as { role: string; content: string }[]).reverse().slice(0, -1);
      const lastUser = history
        .filter((m) => m.role === "user")
        .slice(-2)
        .map((m) => m.content)
        .join(" ");
      const chunks = pick(
        chunkSources(set, (lectures ?? []) as never),
        `${data.content} ${lastUser}`,
      );
      const block = chunks.map((c, i) => `[S${i + 1}] ${c.label}\n${c.text}`).join("\n\n---\n\n");

      const system = data.general
        ? `The student asked for GENERAL BACKGROUND knowledge (not from their materials). Start the answer with the line "**General background — not from your study materials.**" Then answer clearly and accurately in Markdown. If anything in their sources below relates, mention it with its [S#] tag. Don't overstate certainty.${ci(set)}\n\nSOURCES:\n${block}`
        : `You are "Ask Your Materials" for the study set "${set.name}". Answer ONLY from the numbered SOURCES (the student's uploaded files, pasted material, lecture transcripts, generated notes and study guides).
Rules:
- Cite sources inline with their tags like [S2] right after the sentences they support. Every factual sentence needs a tag.
- When the student asks "what did my teacher say", prefer lecture transcripts/notes. When asked "where in my notes", list the matching sources and quote a short phrase.
- If the sources don't contain the answer, reply with exactly: "${NOT_FOUND}" — then one short sentence offering general background knowledge instead. Never guess or fill gaps from outside knowledge.
- If only part is covered, answer that part with citations and say clearly which part isn't in the materials.
- Examples must be based on the material; if you create a new illustrative example, label it "(Example based on your notes)".
- Use clear Markdown, concise. Keep context from the conversation for follow-ups.${ci(set)}

SOURCES:
${block || "(no material)"}`;
      const reply = await aiText(system, [
        ...history.map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user", content: data.content },
      ]);
      const cited = [
        ...new Set([...reply.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]))),
      ].filter((n) => n >= 1 && n <= chunks.length);
      const sources: SourceRef[] = cited.map((n) => ({
        id: `S${n}`,
        label: chunks[n - 1]!.label,
        excerpt: chunks[n - 1]!.text.slice(0, 600),
      }));
      const notFound = !data.general && reply.includes(NOT_FOUND);
      await sb
        .from("material_messages")
        .insert({
          set_id: set.id,
          user_id: context.userId,
          role: "assistant",
          content: reply,
          sources: { refs: sources, notFound, general: !!data.general },
        });
      return { ok: true };
    } catch (e) {
      if (userMsg?.id) await sb.from("material_messages").delete().eq("id", userMsg.id);
      throw e;
    }
  });
