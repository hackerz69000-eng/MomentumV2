import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText, parseJson, clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";

const LECTURE_NOTES = `You turn a lecture transcript into organized, easy-to-study lecture notes in Markdown. Never write one big summary paragraph.
Start with "# <short lecture title>". Then use exactly these "## " sections in this order (omit a section only if the lecture truly has nothing for it, and say "Nothing noted." instead of inventing):
## Main Topics — each main topic as a "### " heading with its subtopics as bullets
## Important Concepts — concept explained in 1-3 sentences each
## Definitions — "**Term** — meaning"
## Important Facts
## Examples From the Lecture — examples the teacher actually gave
## Key Explanations — the teacher's reasoning / how and why explanations
## What the Teacher Emphasized — things repeated, stressed, or flagged ("this is important", "remember", "on the test")
## Potentially Testable
## Questions & Unclear Points — parts of the transcript that were unclear, garbled, contradictory or left unanswered
RULES: Use only what is in the transcript. If you add anything not said in the lecture, mark it clearly as "(Additional context)". Transcripts can contain transcription errors — if a word seems wrong, keep it and note the doubt in "Questions & Unclear Points". No preamble.`;

const idIn = (d: unknown) => z.object({ lectureId: z.string().uuid() }).parse(d);

async function loadLecture(sb: any, id: string) {
  const { data, error } = await sb.from("lectures").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Lecture not found");
  if (!data.transcript?.trim()) throw new Error("This lecture has no transcript yet.");
  return data as {
    id: string;
    set_id: string;
    title: string;
    transcript: string;
    notes: string | null;
  };
}

export const prepareLectureNotesStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    return { system: LECTURE_NOTES + ci(set), messages: [{ role: "user" as const, content: `STUDY SET: ${set.name} (${set.subject || "general"})\nLECTURE: ${lec.title}\n\nTRANSCRIPT:\n${clip(lec.transcript, 80000)}` }] };
  });

export const saveLectureNotesStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), notes: z.string().min(20).max(100000) }).parse(d))
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const { error } = await context.supabase.from("lectures").update({ notes: data.notes, updated_at: new Date().toISOString() }).eq("id", lec.id);
    if (error) throw new Error("Lecture notes were generated but couldn't be saved.");
    return { notes: data.notes };
  });

export const prepareLectureGuideStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    return {
      system: `You write a structured study guide in Markdown from ONE lecture transcript. Start with "# Study Guide: ${lec.title.replace(/"/g, "")}". Use "## " sections: Main Topics, Key Concepts, Definitions, Key Facts, Examples, What the Teacher Emphasized, Likely Test Questions, Quick Review. Only use the lecture; label anything else "(Additional context)". No preamble.${ci(set)}`,
      messages: [{ role: "user" as const, content: `TRANSCRIPT:\n${clip(lec.transcript, 70000)}\n\nLECTURE NOTES (if any):\n${clip(lec.notes ?? "", 10000)}` }],
    };
  });

export const saveLectureGuideStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), guide: z.string().min(20).max(100000) }).parse(d))
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    const { error } = await context.supabase.from("lectures").update({ guide: data.guide, updated_at: new Date().toISOString() }).eq("id", lec.id);
    if (error) throw new Error("The study guide was generated but couldn't be saved.");
    await context.supabase.from("study_activity").insert({ user_id: context.userId, set_id: set.id, kind: "guide", count: 1, meta: { lecture: lec.id } });
    return { guide: data.guide };
  });

export const lectureNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    const notes = await aiText(LECTURE_NOTES + ci(set), [
      {
        role: "user",
        content: `STUDY SET: ${set.name} (${set.subject || "general"})\nLECTURE: ${lec.title}\n\nTRANSCRIPT:\n${clip(lec.transcript, 80000)}`,
      },
    ]);
    await context.supabase
      .from("lectures")
      .update({ notes, updated_at: new Date().toISOString() })
      .eq("id", lec.id);
    return { notes };
  });

export const prepareLectureCardsStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    return {
      system: `You create flashcards from a lecture transcript. Return ONLY JSON: {"cards":[{"q":"question or term","a":"concise answer","t":"short topic name (2-4 words)"}]}. 10-20 high-value cards on concepts, definitions, facts and things the teacher emphasized. Only use what the lecture says. Answers under 40 words.${ci(set)}`,
      messages: [{ role: "user" as const, content: `LECTURE: ${lec.title}\nTRANSCRIPT:\n${clip(lec.transcript, 60000)}` }],
    };
  });

export const saveLectureCardsStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), cards: z.array(z.object({ q: z.string().min(1).max(1000), a: z.string().min(1).max(2000), t: z.string().max(100) })).min(1).max(25) }).parse(d))
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    const cards = data.cards.filter((card, index, all) => all.findIndex((other) => other.q.trim().toLowerCase() === card.q.trim().toLowerCase()) === index);
    if (!cards.length) throw new Error("No valid flashcards were provided.");
    const { count, error: countError } = await context.supabase.from("flashcards").select("id", { count: "exact", head: true }).eq("set_id", set.id);
    if (countError) throw new Error("Couldn't check the existing flashcard count.");
    const { error } = await context.supabase.from("flashcards").insert(cards.map((card, i) => ({ set_id: set.id, user_id: context.userId, question: card.q.trim(), answer: card.a.trim(), topic: (card.t || lec.title).slice(0, 60), position: (count ?? 0) + i, is_custom: false })));
    if (error) throw new Error(error.message);
    return { added: cards.length };
  });

/** Adds lecture-based flashcards to the set (keeps existing cards). */
export const lectureCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const lec = await loadLecture(sb, data.lectureId);
    const set = await loadSet(sb, lec.set_id);
    const text = await aiText(
      `You create flashcards from a lecture transcript. Return ONLY JSON: {"cards":[{"q":"question or term","a":"concise answer","t":"short topic name (2-4 words)"}]}. 10-20 high-value cards on concepts, definitions, facts and things the teacher emphasized. Only use what the lecture says. Answers under 40 words.${ci(set)}`,
      [
        {
          role: "user",
          content: `LECTURE: ${lec.title}\nTRANSCRIPT:\n${clip(lec.transcript, 60000)}`,
        },
      ],
    );
    const parsed = parseJson<{ cards?: unknown }>(text);
    const rawCards = parsed && typeof parsed === "object" && Array.isArray(parsed.cards) ? parsed.cards : [];
    const seenQuestions = new Set<string>();
    const cards = rawCards
      .filter((c): c is { q: string; a: string; t?: string } =>
        !!c && typeof c === "object" && typeof (c as any).q === "string" && typeof (c as any).a === "string" &&
        (c as any).q.trim().length > 0 && (c as any).a.trim().length > 0)
      .filter((c) => {
        const key = c.q.trim().toLowerCase();
        if (seenQuestions.has(key)) return false;
        seenQuestions.add(key);
        return true;
      })
      .map((c) => ({ q: c.q.trim(), a: c.a.trim(), t: typeof c.t === "string" ? c.t.trim() : "" }))
      .slice(0, 25);
    if (!cards.length) throw new Error("No flashcards could be generated.");
    const { count } = await sb
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .eq("set_id", set.id);
    const { error } = await sb
      .from("flashcards")
      .insert(
        cards.map((c, i) => ({
          set_id: set.id,
          user_id: context.userId,
          question: c.q,
          answer: c.a,
          topic: (c.t ?? lec.title).slice(0, 60),
          position: (count ?? 0) + i,
          is_custom: false,
        })),
      );
    if (error) throw new Error(error.message);
    return { added: cards.length };
  });

export const lectureGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId);
    const set = await loadSet(context.supabase, lec.set_id);
    const guide = await aiText(
      `You write a structured study guide in Markdown from ONE lecture transcript. Start with "# Study Guide: ${lec.title.replace(/"/g, "")}". Use "## " sections: Main Topics, Key Concepts, Definitions, Key Facts, Examples, What the Teacher Emphasized, Likely Test Questions, Quick Review. Only use the lecture; label anything else "(Additional context)". No preamble.${ci(set)}`,
      [
        {
          role: "user",
          content: `TRANSCRIPT:\n${clip(lec.transcript, 70000)}\n\nLECTURE NOTES (if any):\n${clip(lec.notes ?? "", 10000)}`,
        },
      ],
    );
    await context.supabase
      .from("lectures")
      .update({ guide, updated_at: new Date().toISOString() })
      .eq("id", lec.id);
    await context.supabase
      .from("study_activity")
      .insert({
        user_id: context.userId,
        set_id: set.id,
        kind: "guide",
        count: 1,
        meta: { lecture: lec.id },
      });
    return { guide };
  });
