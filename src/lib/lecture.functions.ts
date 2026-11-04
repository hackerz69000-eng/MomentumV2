import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";
import { assertGenerationClaimed, assertGenerationSourceRevision } from "./study-generation-guards";
import { studySourceVersion } from "./study-source-version";

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

async function loadLecture(sb: any, id: string, userId: string) {
  const { data, error } = await sb.from("lectures").select("*").eq("id", id).eq("user_id", userId).single();
  if (error || !data) throw new Error("Lecture not found");
  if (!data.transcript?.trim()) throw new Error("This lecture has no transcript yet.");
  return data as {
    id: string;
    set_id: string;
    title: string;
    transcript: string;
    notes: string | null;
    updated_at: string;
  };
}

export const prepareLectureNotesStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
    const set = await loadSet(context.supabase, lec.set_id);
    return { system: LECTURE_NOTES + ci(set), messages: [{ role: "user" as const, content: `STUDY SET: ${set.name} (${set.subject || "general"})\nLECTURE: ${lec.title}\n\nTRANSCRIPT:\n${clip(lec.transcript, 80000)}` }] };
  });

export const saveLectureNotesStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), notes: z.string().min(20).max(100000) }).parse(d))
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
    const { error } = await context.supabase.from("lectures").update({ notes: data.notes, updated_at: new Date().toISOString() }).eq("id", lec.id).eq("user_id", context.userId);
    if (error) throw new Error("Lecture notes were generated but couldn't be saved.");
    return { notes: data.notes };
  });

export const prepareLectureGuideStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(idIn)
  .handler(async ({ data, context }) => {
    const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
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
    const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
    const set = await loadSet(context.supabase, lec.set_id);
    const { error } = await context.supabase.from("lectures").update({ guide: data.guide, updated_at: new Date().toISOString() }).eq("id", lec.id).eq("user_id", context.userId);
    if (error) throw new Error("The study guide was generated but couldn't be saved.");
    await context.supabase.from("study_activity").insert({ user_id: context.userId, set_id: set.id, kind: "guide", count: 1, meta: { lecture: lec.id } });
    return { guide: data.guide };
  });

export const prepareLectureCardsStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), lockToken: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const firstLecture = await loadLecture(context.supabase, data.lectureId, context.userId);
    const { data: claimed, error: claimError } = await context.supabase.rpc("claim_study_set_generation", { p_set_id: firstLecture.set_id, p_lock_token: data.lockToken });
    assertGenerationClaimed(claimed, claimError);
    try {
      const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
      const set = await loadSet(context.supabase, lec.set_id);
      const sourceRevision = set.generation_source_revision;
      if (!sourceRevision) throw new Error("Study source version is missing. Apply the study safety migration, then retry.");
      const source = { ...set, name: `${set.name} — ${lec.title}`, material_text: `LECTURE TRANSCRIPT: ${lec.title}\n\n${lec.transcript}` };
      return {
        system: `You create flashcards from a lecture transcript. Return ONLY JSON: {"cards":[{"q":"question or term","a":"concise answer","t":"short topic name (2-4 words)"}]}. 10-20 high-value cards on concepts, definitions, facts and things the teacher emphasized. Only use what the lecture says. Answers under 40 words.${ci(set)}`,
        messages: [{ role: "user" as const, content: `LECTURE: ${lec.title}\nTRANSCRIPT:\n${clip(lec.transcript, 60000)}` }],
        generationKey: await studySourceVersion(source),
        sourceRevision,
        lectureUpdatedAt: lec.updated_at,
        lockToken: data.lockToken,
      };
    } catch (error) {
      await context.supabase.rpc("release_study_set_generation", { p_set_id: firstLecture.set_id, p_lock_token: data.lockToken, p_error: error instanceof Error ? error.message : "Lecture card generation failed.", p_mark_set_error: false });
      throw error;
    }
  });

export const saveLectureCardsStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lectureId: z.string().uuid(), lockToken: z.string().uuid(), generationKey: z.string().regex(/^[a-f0-9]{64}$/), sourceRevision: z.string().uuid(), lectureUpdatedAt: z.string().datetime({ offset: true }), cards: z.array(z.object({ q: z.string().min(1).max(1000), a: z.string().min(1).max(2000), t: z.string().max(100) })).min(1).max(25) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const lec = await loadLecture(context.supabase, data.lectureId, context.userId);
      const set = await loadSet(context.supabase, lec.set_id);
      assertGenerationSourceRevision(data.sourceRevision, set.generation_source_revision ?? "");
      if (lec.updated_at !== data.lectureUpdatedAt) throw new Error("The lecture changed while Momentum was generating. The outdated result was not saved. Retry generation.");
      const source = { ...set, name: `${set.name} — ${lec.title}`, material_text: `LECTURE TRANSCRIPT: ${lec.title}\n\n${lec.transcript}` };
      if (await studySourceVersion(source) !== data.generationKey) throw new Error("The lecture changed while Momentum was generating. The outdated result was not saved. Retry generation.");
      const cards = data.cards.filter((card, index, all) => all.findIndex((other) => other.q.trim().toLowerCase() === card.q.trim().toLowerCase()) === index);
      if (!cards.length) throw new Error("No valid flashcards were provided.");
      const { data: saved, error } = await context.supabase.rpc("commit_study_set_generation", {
        p_set_id: set.id, p_lock_token: data.lockToken, p_generation_key: data.generationKey,
        p_source_revision: data.sourceRevision, p_notes: null,
        p_cards: cards.map((card) => ({ q: card.q.trim(), a: card.a.trim(), t: (card.t || lec.title).slice(0, 100) })),
        p_append_cards: true, p_lecture_id: lec.id, p_lecture_updated_at: data.lectureUpdatedAt,
      });
      if (error || !saved) throw new Error(error?.message || "This generation lease expired. Retry to continue safely.");
      return { added: cards.length };
    } catch (error) {
      const lec = await loadLecture(context.supabase, data.lectureId, context.userId).catch(() => null);
      if (lec) await context.supabase.rpc("release_study_set_generation", { p_set_id: lec.set_id, p_lock_token: data.lockToken, p_error: error instanceof Error ? error.message : "Lecture card generation failed.", p_mark_set_error: false });
      throw error;
    }
  });

/** Adds lecture-based flashcards to the set (keeps existing cards). */
