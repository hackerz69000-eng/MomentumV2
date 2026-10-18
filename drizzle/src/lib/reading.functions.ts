import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText, parseJson, clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";

const setIdInput = (data: unknown) => z.object({ setId: z.string().uuid() }).parse(data);
const addReadingInput = (data: unknown) => z.object({ setId: z.string().uuid(), filename: z.string().trim().min(1).max(300), contentText: z.string().trim().min(20).max(500000) }).parse(data);
const scopedInput = (data: unknown) => z.object({ setId: z.string().uuid(), sourceKey: z.string().max(200).optional() }).parse(data);
const askInput = (data: unknown) => z.object({ setId: z.string().uuid(), question: z.string().trim().min(2).max(2000), sourceKey: z.string().max(200).optional() }).parse(data);
const linkInput = (data: unknown) => z.object({ targetSetId: z.string().uuid(), sourceSetId: z.string().uuid(), sourceKind: z.enum(["set_material", "lecture"]), sourceLectureId: z.string().uuid().nullable().optional() }).parse(data);
const unlinkInput = (data: unknown) => z.object({ targetSetId: z.string().uuid(), linkId: z.string().uuid() }).parse(data);
const cardsInput = (data: unknown) => z.object({ setId: z.string().uuid(), cards: z.array(z.object({ q: z.string().trim().min(1).max(500), a: z.string().trim().min(1).max(2000), t: z.string().trim().max(80).optional() })).min(1).max(25) }).parse(data);

type CompanionSource = { key: string; title: string; kind: "reading" | "lecture"; text: string; linked: boolean };

async function collectSources(sb: any, set: any): Promise<CompanionSource[]> {
  const sources: CompanionSource[] = [];
  if (set.material_text?.trim()) {
    sources.push({ key: "current-lecture-material", title: `Primary course material · ${set.material_filename || set.name}`, kind: "lecture", text: set.material_text, linked: false });
  }
  if (set.notes?.trim()) {
    sources.push({ key: "current-notes", title: `Study notes · ${set.name}`, kind: "reading", text: set.notes, linked: false });
  }
  const { data: readingDocs, error: readingDocsError } = await sb.from("study_set_readings").select("id,filename,content_text,created_at").eq("set_id", set.id).order("created_at", { ascending: true }).limit(30);
  if (readingDocsError && readingDocsError.code !== "42P01") throw new Error("Couldn't load reading documents.");
  for (const doc of readingDocs ?? []) {
    if (doc.content_text?.trim()) sources.push({ key: `reading-doc:${doc.id}`, title: `Reading · ${doc.filename}`, kind: "reading", text: doc.content_text, linked: false });
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
  const useful = chosen.filter((source) => {
    const words = source.text.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    const bodyLines = source.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const headingLike = bodyLines.filter((line) => (line.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length <= 5).length;
    return words.length >= 35 && !(bodyLines.length >= 8 && headingLike / bodyLines.length > 0.82 && words.length < bodyLines.length * 5);
  });
  if (!useful.length) {
    throw new Error("Momentum can see this source, but it contains too little readable body text to make a reliable study brief. Re-upload a text-searchable/OCR version of the file, or add a TXT/DOCX version. Page headings alone aren't enough to generate useful study material.");
  }
  return useful;
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

export const readingAddDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(addReadingInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    if (data.contentText.trim().length < 20) throw new Error("Not enough readable text was found in this file.");
    const { data: row, error } = await (context.supabase as any).from("study_set_readings").insert({
      set_id: set.id, user_id: context.userId, filename: data.filename, content_text: data.contentText.trim(),
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Couldn't save the reading.");
    return { id: row.id };
  });

export const readingDeleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((d: unknown) => z.object({ setId: z.string().uuid(), readingId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const { error } = await (context.supabase as any).from("study_set_readings").delete().eq("id", data.readingId).eq("set_id", set.id).eq("user_id", context.userId);
    if (error) throw new Error("Couldn't remove that reading.");
    return { ok: true };
  });

export const readingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(scopedInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = selectedSources(await collectSources(context.supabase, set), data.sourceKey);
    const sourceText = sources.map((s, i) => `SOURCE ${i + 1}: ${s.title}\n${clip(s.text, 28000)}`).join("\n\n---\n\n");
    const summary = await aiText(`You are Momentum's lecture-first Reading Companion. The Study Set's lecture/course material is the primary learning target; readings are supporting context that should make the lecture easier to understand, not replace it. Create a genuinely useful, actionable study workspace in clean Markdown using only the supplied course sources. This must feel like a guided learning tool, not a prose essay or wall of notes. Keep paragraphs to 2-4 sentences, use meaningful headings, bold key terms, and make each section useful for a specific student task. Prefer concise, information-dense explanations over repeating the same idea. Start with a concise title and a 2-3 sentence overview of the big idea. Then use these sections in this order: (1) Start here: 3-5 high-yield takeaways, each phrased as a complete, memorable claim; (2) Lecture concepts explained: group related ideas under short subheadings; explain what each means, how it connects to other concepts, and why it matters; use a causal chain or timeline only when supported by the sources; (3) Lecture vs. reading: when both source types exist, use a compact Markdown table with columns Topic, Lecture emphasis, Reading contribution, and Relationship (clarifies/adds/differs/not covered). Keep each cell concise; compare like with like; if one source type is missing, say so rather than implying a comparison was made; (4) Important terms: term — plain-language definition — why it matters; distinguish terms that are easy to confuse; (5) What the reading adds / what remains lecture-only: separate these clearly and only include supported items; (6) Common confusions: 2-4 likely mix-ups grounded in these sources, and how to tell the concepts apart; if no genuine confusions are supported, say so; (7) Check your understanding: 5-7 varied questions, with answers in a separate Answer key section so the student can try first. Include a mix of retrieval, explain-in-your-own-words, application to a source-supported example, and compare/connect questions when sources support it. Avoid trivia-only or trick questions; make distractors plausible but clearly incorrect from the sources; (8) A 10-minute study path with concrete steps using this brief (e.g. closed-book recall, check, retry missed ideas), not generic motivational advice; (9) Source references. Cite source names and explicit page/slide/section markers present in the supplied text. Never invent page numbers, quotations, details, or source support. If no page marker exists, cite the source name and a short identifying heading or say the extracted text has no page-level markers. Do not invent facts. Explicitly flag gaps and genuine discrepancies without assuming either source is automatically correct. Distinguish lecture claims from reading claims and label any necessary inference as an inference. ${ci(set)}`,
      [{ role: "user", content: `STUDY SET: ${set.name} (${set.subject || "General"})\n\nSOURCES:\n${sourceText}` }]);
    return { summary };
  });


const implementInput = (data: unknown) => z.object({ setId: z.string().uuid(), additions: z.string().trim().min(10).max(500000) }).parse(data);

function mergeNotesWithoutReplacing(existing: string, additions: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  let merged = existing.trim();
  const add = additions.trim();
  if (!merged) return add;
  const chunks = add.split(/(?=^#{1,3}\s+)/m).map((x) => x.trim()).filter(Boolean);
  const unmatched: string[] = [];
  for (const chunk of chunks) {
    const match = chunk.match(/^(#{1,3})\s+([^\n]+)\n?([\s\S]*)$/);
    const heading = match?.[2]?.trim() ?? "Additional concept";
    const body = (match?.[3] ?? chunk).trim();
    const bodyNorm = normalize(body);
    if (!bodyNorm || bodyNorm.length < 12) continue;
    const existingNorm = normalize(merged);
    if (existingNorm.includes(bodyNorm) || existingNorm.includes(bodyNorm.slice(0, Math.min(100, bodyNorm.length)))) continue;
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingPattern = new RegExp(`^(#{1,3})\\s+${escaped}\\s*$`, "im");
    const found = headingPattern.exec(merged);
    if (found) {
      const start = found.index + found[0].length;
      const nextHeading = /\n#{1,3}\s+/g;
      nextHeading.lastIndex = start;
      const next = nextHeading.exec(merged);
      const end = next ? next.index : merged.length;
      const section = merged.slice(start, end);
      if (!normalize(section).includes(bodyNorm.slice(0, Math.min(100, bodyNorm.length)))) {
        merged = `${merged.slice(0, end).trimEnd()}\n\n${body}\n\n${merged.slice(end).trimStart()}`;
      }
    } else {
      unmatched.push(`## ${heading}\n\n${body}`);
    }
  }
  if (unmatched.length) merged += `\n\n## Additional insights from readings\n\n${unmatched.join("\n\n")}`;
  return merged;
}

/** Split on paragraph boundaries without discarding any source characters. */
function splitReadingIntoChunks(text: string, maxChars = 9000): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf("\n\n", end);
      const lineBreak = normalized.lastIndexOf("\n", end);
      const boundary = paragraphBreak > start + Math.floor(maxChars * 0.55) ? paragraphBreak + 2
        : lineBreak > start + Math.floor(maxChars * 0.55) ? lineBreak + 1 : end;
      end = boundary;
    }
    if (end <= start) end = Math.min(start + maxChars, normalized.length);
    chunks.push(normalized.slice(start, end));
    start = end;
  }
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

function combineProposedAdditions(parts: string[]): string {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const part of parts) {
    const cleaned = part.trim();
    if (!cleaned || /^NO_NEW_INFORMATION\s*$/i.test(cleaned)) continue;
    // Deduplicate only identical normalized paragraphs; keep distinct details.
    const paragraphs = cleaned.split(/\n\s*\n/);
    const unique: string[] = [];
    for (const paragraph of paragraphs) {
      const key = paragraph.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(paragraph.trim());
    }
    if (unique.length) output.push(unique.join("\n\n"));
  }
  return output.join("\n\n").trim();
}

export const readingImplementIntoNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ setId: z.string().uuid(), chunkIndex: z.number().int().nonnegative().default(0) }).parse(data))
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = (await collectSources(context.supabase, set)).filter((source) => source.kind === "reading" && source.key !== "current-notes");
    if (!sources.length) throw new Error("Upload or connect a reading PDF first.");

    // Build a stable index of every chunk, then analyze exactly one chunk per HTTP
    // request. This avoids one long serverless request timing out on large libraries.
    const chunks = sources.flatMap((source) => splitReadingIntoChunks(source.text).map((text, partIndex, all) => ({
      title: source.title, text, partIndex, partCount: all.length,
    })));
    if (!chunks.length) throw new Error("The selected readings contain no readable text to process.");
    if (data.chunkIndex >= chunks.length) throw new Error("Reading processing index expired. Please start the scan again.");
    const chunk = chunks[data.chunkIndex];
    const additions = await aiText(
      `You are an academic note editor. Compare this ONE PART of a reading with the student's existing notes. Return ONLY Markdown containing useful information from this part that is genuinely absent from the notes. Organize under headings matching existing note headings as closely as possible; if none fits, create a concise topic heading. Preserve definitions, explanations, conditions, examples, exceptions, formulas, and relationships. Do not repeat covered information, add source references/citations, rewrite existing notes, or invent facts. If this part contains no meaningful new information, return exactly NO_NEW_INFORMATION. This is part ${chunk.partIndex + 1} of ${chunk.partCount} of ${chunk.title}; do not claim to have processed other parts. ${ci(set)}`,
      [{ role: "user", content: `EXISTING NOTES (must remain intact):\n${clip(set.notes?.trim() || "(No notes yet)", 22000)}\n\nREADING: ${chunk.title}\nPART ${chunk.partIndex + 1}/${chunk.partCount} (all text in this part is supplied below):\n${chunk.text}` }],
    );
    const cleaned = additions.trim();
    return {
      chunkIndex: data.chunkIndex,
      totalChunks: chunks.length,
      sourceCount: sources.length,
      additions: !cleaned || /^NO_NEW_INFORMATION\s*$/i.test(cleaned) ? "" : cleaned,
    };
  });

export const readingApplyNotesAdditions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(implementInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const current = set.notes ?? "";
    const merged = mergeNotesWithoutReplacing(current, data.additions);
    if (merged === current.trim()) return { added: false, message: "No new information needed to be added; your notes are unchanged." };
    const { error } = await (context.supabase as any).from("study_sets").update({ notes: merged, updated_at: new Date().toISOString() }).eq("id", set.id).eq("user_id", context.userId);
    if (error) throw new Error("Couldn't save the merged notes. Your existing notes were not changed.");
    return { added: true, message: "New reading information added. Existing notes were preserved." };
  });

export const readingAsk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(askInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = selectedSources(await collectSources(context.supabase, set), data.sourceKey);
    const sourceText = sources.map((s, i) => `SOURCE ${i + 1}: ${s.title}\n${clip(s.text, 26000)}`).join("\n\n---\n\n");
    const answer = await aiText(`You are a careful course tutor. Treat the Study Set's uploaded lecture/course material as the primary source and use optional readings to clarify it. Answer using only the supplied Study Set reading and lecture content. Format the response for scanning: lead with a direct answer, then explain in short paragraphs or bullets, and finish with a brief source note when possible. Ground claims in sources, cite source names and explicit page/slide/section labels when available, and clearly say if the sources do not contain the answer. Never invent page numbers or pretend external knowledge came from the sources. You may explain in your own words, but distinguish explanation from source facts. ${ci(set)}`,
      [{ role: "user", content: `QUESTION: ${data.question}\n\nCOURSE SOURCES:\n${sourceText}` }]);
    return { answer };
  });

export const readingGenerateCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(setIdInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const sources = selectedSources(await collectSources(context.supabase, set));
    if (!sources.length) throw new Error("Add reading material or connect a lecture first.");
    const text = await aiText(`Create up to 15 high-value flashcards for this lecture-first Study Set. Prioritize the primary lecture/course material, using optional readings to clarify confusing concepts and add useful context. Use only source-supported facts. Include source name and page/slide marker in topic when provided. Return ONLY JSON: {"cards":[{"q":"question","a":"answer","t":"topic"}]}. Avoid duplicates and vague prompts. ${ci(set)}`,
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
