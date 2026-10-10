import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText, parseJson, clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";

const setIdInput = (data: unknown) => z.object({ setId: z.string().uuid() }).parse(data);
const scopedInput = (data: unknown) => z.object({ setId: z.string().uuid(), sourceKey: z.string().max(200).optional() }).parse(data);
const askInput = (data: unknown) => z.object({ setId: z.string().uuid(), question: z.string().trim().min(2).max(2000), sourceKey: z.string().max(200).optional() }).parse(data);
const linkInput = (data: unknown) => z.object({ targetSetId: z.string().uuid(), sourceSetId: z.string().uuid(), sourceKind: z.enum(["set_material", "lecture"]), sourceLectureId: z.string().uuid().nullable().optional() }).parse(data);
const unlinkInput = (data: unknown) => z.object({ targetSetId: z.string().uuid(), linkId: z.string().uuid() }).parse(data);
const cardsInput = (data: unknown) => z.object({ setId: z.string().uuid(), cards: z.array(z.object({ q: z.string().trim().min(1).max(500), a: z.string().trim().min(1).max(2000), t: z.string().trim().max(80).optional() })).min(1).max(25) }).parse(data);

type CompanionSource = { key: string; title: string; kind: "reading" | "lecture"; text: string; linked: boolean };

async function collectSources(sb: any, set: any): Promise<CompanionSource[]> {
  const sources: CompanionSource[] = [];
  if (set.material_text?.trim()) {
    sources.push({ key: "current-reading", title: `Reading · ${set.material_filename || set.name}`, kind: "reading", text: set.material_text, linked: false });
  }
  if (set.notes?.trim()) {
    sources.push({ key: "current-notes", title: `Study notes · ${set.name}`, kind: "reading", text: set.notes, linked: false });
  }
  const { data: localLectures } = await sb.from("lectures").select("id,title,transcript,notes").eq("set_id", set.id).order("created_at", { ascending: true }).limit(20);
  for (const l of localLectures ?? []) {
    const text = [`TRANSCRIPT:\n${l.transcript ?? ""}`, `LECTURE NOTES:\n${l.notes ?? ""}`].join("\n\n").trim();
    if (text.replace(/TRANSCRIPT:|LECTURE NOTES:/g, "").trim()) sources.push({ key: `lecture:${l.id}`, title: `Lecture · ${l.title}`, kind: "lecture", text, linked: false });
  }
  const { data: links, error: linksError } = await sb.from("study_set_source_links").select("id,source_kind,source_set_id,source_lecture_id").eq("target_set_id", set.id).order("created_at", { ascending: true });
  if (linksError && linksError.code !== "42P01") throw new Error("Couldn't load linked course sources. Apply migration 0011_reading_companion_sources.sql first.");
  for (const link of links ?? []) {
    const { data: sourceSet } = await sb.from("study_sets").select("id,name,subject,material_text,material_filename,notes").eq("id", link.source_set_id).single();
    if (!sourceSet) continue;
    if (link.source_kind === "set_material") {
      const text = [sourceSet.material_text ?? "", sourceSet.notes ? `STUDY NOTES:\n${sourceSet.notes}` : ""].filter(Boolean).join("\n\n");
      if (text.trim()) sources.push({ key: `linked-reading:${link.id}`, title: `Linked reading · ${sourceSet.name}${sourceSet.material_filename ? ` (${sourceSet.material_filename})` : ""}`, kind: "reading", text, linked: true });
    } else if (link.source_lecture_id) {
      const { data: lecture } = await sb.from("lectures").select("id,title,transcript,notes").eq("id", link.source_lecture_id).eq("set_id", sourceSet.id).single();
      if (!lecture) continue;
      const text = [`TRANSCRIPT:\n${lecture.transcript ?? ""}`, `LECTURE NOTES:\n${lecture.notes ?? ""}`].join("\n\n").trim();
      if (text.replace(/TRANSCRIPT:|LECTURE NOTES:/g, "").trim()) sources.push({ key: `linked-lecture:${link.id}`, title: `Linked lecture · ${sourceSet.name} — ${lecture.title}`, kind: "lecture", text, linked: true });
    }
  }
  return sources;
}

function selectedSources(sources: CompanionSource[], sourceKey?: string) {
  const chosen = sourceKey ? sources.filter((s) => s.key === sourceKey) : sources;
  if (!chosen.length) throw new Error("That source is no longer available. Refresh the Reading Companion and try again.");
  return chosen;
}

export const readingListSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(setIdInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sb: any = context.supabase;
    const { data: sets, error: setsError } = await sb.from("study_sets").select("id,name,subject,material_text,material_filename").eq("user_id", context.userId).neq("id", set.id).order("updated_at", { ascending: false }).limit(100);
    if (setsError) throw new Error("Couldn't load your other Study Sets.");
    const { data: lectures, error: lecturesError } = await sb.from("lectures").select("id,title,set_id,transcript,notes,created_at").eq("user_id", context.userId).neq("set_id", set.id).order("created_at", { ascending: false }).limit(200);
    if (lecturesError) throw new Error("Couldn't load your other lectures.");
    const { data: links, error: linkError } = await sb.from("study_set_source_links").select("id,source_kind,source_set_id,source_lecture_id").eq("target_set_id", set.id).order("created_at", { ascending: false });
    if (linkError && linkError.code !== "42P01") throw new Error("Couldn't load source links.");
    return {
      sets: (sets ?? []).map((s: any) => ({ id: s.id, name: s.name, subject: s.subject, hasMaterial: Boolean(s.material_text?.trim()), filename: s.material_filename })),
      lectures: (lectures ?? []).map((l: any) => ({ id: l.id, title: l.title, setId: l.set_id, setName: (sets ?? []).find((s: any) => s.id === l.set_id)?.name ?? "Other Study Set", hasContent: Boolean(l.transcript?.trim() || l.notes?.trim()) })),
      links: links ?? [],
      sources: (await collectSources(sb, set)).map(({ key, title, kind, linked }) => ({ key, title, kind, linked })),
    };
  });

export const readingLinkSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(linkInput)
  .handler(async ({ data, context }) => {
    const sb: any = context.supabase;
    const target = await loadSet(sb, data.targetSetId);
    if (target.id === data.sourceSetId) throw new Error("A Study Set cannot be linked to itself.");
    const { data: sourceSet, error: sourceError } = await sb.from("study_sets").select("id,user_id,material_text").eq("id", data.sourceSetId).eq("user_id", context.userId).single();
    if (sourceError || !sourceSet) throw new Error("Source Study Set not found or not accessible.");
    let lectureId: string | null = null;
    if (data.sourceKind === "set_material") {
      if (!sourceSet.material_text?.trim()) throw new Error("That Study Set has no extracted reading material to link.");
    } else {
      if (!data.sourceLectureId) throw new Error("Choose a lecture to link.");
      const { data: lecture, error } = await sb.from("lectures").select("id,set_id,user_id").eq("id", data.sourceLectureId).eq("set_id", sourceSet.id).eq("user_id", context.userId).single();
      if (error || !lecture) throw new Error("Lecture not found or not accessible.");
      lectureId = lecture.id;
    }
    const { data: existing } = await sb.from("study_set_source_links").select("id").eq("target_set_id", target.id).eq("source_set_id", sourceSet.id).eq("source_kind", data.sourceKind).limit(1);
    if ((existing ?? []).some((r: any) => r.id)) {
      if (data.sourceKind === "set_material") throw new Error("That reading is already linked.");
    }
    if (data.sourceKind === "lecture") {
      const { data: same } = await sb.from("study_set_source_links").select("id").eq("target_set_id", target.id).eq("source_lecture_id", lectureId).limit(1);
      if (same?.length) throw new Error("That lecture is already linked.");
    }
    const { data: inserted, error } = await sb.from("study_set_source_links").insert({ user_id: context.userId, target_set_id: target.id, source_set_id: sourceSet.id, source_kind: data.sourceKind, source_lecture_id: lectureId }).select("id").single();
    if (error || !inserted) throw new Error(error?.message ?? "Couldn't link that source.");
    return { id: inserted.id };
  });

export const readingUnlinkSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(unlinkInput)
  .handler(async ({ data, context }) => {
    await loadSet(context.supabase, data.targetSetId);
    const sb: any = context.supabase;
    const { error } = await sb.from("study_set_source_links").delete().eq("id", data.linkId).eq("target_set_id", data.targetSetId).eq("user_id", context.userId);
    if (error) throw new Error("Couldn't unlink that source.");
    return { ok: true };
  });

export const readingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(scopedInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = selectedSources(await collectSources(context.supabase, set), data.sourceKey);
    const sourceText = sources.map((s, i) => `SOURCE ${i + 1}: ${s.title}\n${clip(s.text, 28000)}`).join("\n\n---\n\n");
    const summary = await aiText(`You are Momentum's Reading & Lecture Companion. Create a useful structured study brief in Markdown using only the supplied course sources. Start with a title, then sections: Overview, Key Concepts, Important Terms, How Ideas Connect, Questions to Check Understanding, and Source References. Cite source names and any explicit page/slide/section markers in the provided text. Never invent page numbers. If no page marker exists, cite the source name and a short identifying heading or say the extracted text has no page-level markers. Do not invent facts. Explicitly mark when sources do not provide enough information. Distinguish reading content from lecture content. ${ci(set)}`,
      [{ role: "user", content: `STUDY SET: ${set.name} (${set.subject || "General"})\n\nSOURCES:\n${sourceText}` }]);
    return { summary };
  });

export const readingAsk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(askInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = selectedSources(await collectSources(context.supabase, set), data.sourceKey);
    const sourceText = sources.map((s, i) => `SOURCE ${i + 1}: ${s.title}\n${clip(s.text, 26000)}`).join("\n\n---\n\n");
    const answer = await aiText(`You are a careful course tutor. Answer using only the supplied Study Set reading and lecture content. Ground claims in sources, cite source names and explicit page/slide/section labels when available, and clearly say if the sources do not contain the answer. Never invent page numbers or pretend external knowledge came from the sources. You may explain in your own words, but distinguish explanation from source facts. ${ci(set)}`,
      [{ role: "user", content: `QUESTION: ${data.question}\n\nCOURSE SOURCES:\n${sourceText}` }]);
    return { answer };
  });

export const readingGenerateCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(setIdInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = await collectSources(context.supabase, set);
    if (!sources.length) throw new Error("Add reading material or connect a lecture first.");
    const text = await aiText(`Create up to 15 high-value flashcards from the provided reading and lecture sources. Use only source-supported facts. Include source name and page/slide marker in topic when provided. Return ONLY JSON: {"cards":[{"q":"question","a":"answer","t":"topic"}]}. Avoid duplicates and vague prompts. ${ci(set)}`,
      [{ role: "user", content: `SET: ${set.name}\nSOURCES:\n${sources.map((s) => `${s.title}\n${clip(s.text, 16000)}`).join("\n\n---\n\n")}` }]);
    const cards = (parseJson<{ cards?: { q: string; a: string; t?: string }[] }>(text).cards ?? []).filter(c => c?.q?.trim() && c?.a?.trim()).slice(0, 15);
    if (!cards.length) throw new Error("No flashcards could be generated from these sources.");
    return { cards };
  });

export const readingSaveCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(cardsInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sb: any = context.supabase;
    const { data: existing, error: readError } = await sb.from("flashcards").select("question").eq("set_id", set.id);
    if (readError) throw new Error("Couldn't check existing cards for duplicates.");
    const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    const known = new Set((existing ?? []).map((c: any) => norm(c.question ?? "")));
    const unique = data.cards.filter((c) => { const key = norm(c.q); if (!key || known.has(key)) return false; known.add(key); return true; });
    if (!unique.length) return { added: 0, skipped: data.cards.length };
    const { count } = await sb.from("flashcards").select("id", { count: "exact", head: true }).eq("set_id", set.id);
    const { error } = await sb.from("flashcards").insert(unique.map((c, i) => ({ set_id: set.id, user_id: context.userId, question: c.q, answer: c.a, topic: (c.t || "Reading Companion").slice(0, 80), position: (count ?? 0) + i, is_custom: false })));
    if (error) throw new Error(error.message);
    return { added: unique.length, skipped: data.cards.length - unique.length };
  });
