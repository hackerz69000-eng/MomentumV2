import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clip } from "./ai.server";
import { ci, loadSet, openMistakes } from "./set-helpers.server";
import { setStats, type Attempt, type Flashcard } from "./stats";
import type { Tables } from "@/integrations/supabase/types";

const modeSchema = z.enum(["quick", "full", "deep", "weak"]);
export type AudioStudyMode = z.infer<typeof modeSchema>;
export type AudioSection = { title: string; topic: string; narration: string };

const MODE: Record<AudioStudyMode, string> = {
  quick:
    "A focused 5–10 minute review of the most important, testable ideas. Aim for 700–1100 words.",
  full: "A thorough 15–30 minute lesson covering the important material. Aim for 1800–3000 words.",
  deep: "A detailed lesson for difficult material, with careful explanations, examples, distinctions, and connections. Aim for 2500–3800 words.",
  weak: "A focused lesson that spends extra time on supported weak topics and repeated mistakes, while explaining enough surrounding material to make them understandable. Aim for 1400–2400 words.",
};

const sessionId = (d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d);

export const prepareAudioStudyStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ setId: z.string().min(1).max(200), mode: modeSchema, requestKey: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: duplicate } = await sb.from("audio_study_sessions").select("*").eq("request_key", data.requestKey).eq("user_id", context.userId).maybeSingle();
    if (duplicate?.status === "ready") return { existingSession: duplicate as SessionRow };
    const set = await loadSet(sb, data.setId);
    const [{ data: cards }, { data: attempts }, { data: lectures }, mistakes] = await Promise.all([
      sb.from("flashcards").select("*").eq("set_id", set.id),
      sb.from("quiz_attempts").select("*").eq("set_id", set.id),
      sb.from("lectures").select("title, transcript").eq("set_id", set.id).eq("in_material", true),
      openMistakes(sb, set.id, 20),
    ]);
    const stats = setStats((cards ?? []) as Flashcard[], (attempts ?? []) as Attempt[], mistakes);
    if (data.mode === "weak" && !stats.topics.length && !mistakes.length) throw new Error("Complete a quiz, Active Recall, or some flashcards before starting a Weak Topics lesson.");
    const created = duplicate ?? (await sb.from("audio_study_sessions").insert({ user_id: context.userId, set_id: set.id, mode: data.mode, status: "generating", title: `${set.name} audio lesson`, request_key: data.requestKey }).select("*").single()).data;
    if (!created) throw new Error("Couldn't start the audio lesson. Please try again.");
    const performance = [
      `Weak topics: ${stats.weak.map((t) => `${t.topic} (${t.accuracy}%, ${t.samples} samples)`).join(", ") || "none supported yet"}`,
      `Improving topics: ${stats.topics.filter((t) => t.status === "Improving").map((t) => t.topic).join(", ") || "none"}`,
      `Strong topics: ${stats.topics.filter((t) => t.status === "Strong").map((t) => t.topic).join(", ") || "none"}`,
      `Open mistakes: ${mistakes.map((m) => `[${m.topic}] missed ${m.wrong_count}x — ${m.question.slice(0, 180)}`).join(" | ") || "none"}`,
    ].join("\n");
    const lectureText = (lectures ?? []).filter((l) => l.transcript?.trim()).map((l) => `## ${l.title}\n${l.transcript}`).join("\n\n");
    return {
      sessionId: created.id,
      system: `You create a one-tutor spoken Audio Study lesson from a student's own materials. ${MODE[data.mode]}\nReturn ONLY JSON: {"title":"short lesson title","sections":[{"title":"short section title","topic":"2-5 word topic","narration":"spoken narration"}]}.\nUse 4–10 logically ordered sections: brief introduction, concepts with explanation and examples, useful relationships or distinctions, then a concise recap. Write for speech: natural, conversational prose; no Markdown, tables, stage directions, citations read aloud, fake dialogue, two-host banter, filler, or word-for-word note reading. Use the student's terminology. Prioritize important and testable information rather than treating every detail equally. Each narration must be under 3600 characters so it can be voiced independently. Do not mention performance data unless this is Weak Topics mode. In Weak Topics mode, prioritize repeated evidence over one isolated miss and don't waste most of the lesson reteaching mastered basics.${ci(set)}\n\nPERFORMANCE EVIDENCE:\n${performance}`,
      messages: [{ role: "user" as const, content: `SET: ${set.name} (${set.subject || "general"})\n\nNOTES:\n${clip(set.notes ?? "", 12000)}\n\nSTUDY GUIDE:\n${clip(set.study_guide ?? "", 12000)}\n\nINCLUDED LECTURES:\n${clip(lectureText, 12000)}\n\nPRIMARY MATERIAL:\n${clip(set.material_text, 42000)}` }],
    };
  });

export const saveAudioStudyStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), title: z.string().min(1).max(160), sections: z.array(z.object({ title: z.string().min(1).max(120), topic: z.string().max(80), narration: z.string().min(1).max(3900) })).min(2).max(12) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session, error: readError } = await context.supabase.from("audio_study_sessions").select("id").eq("id", data.sessionId).eq("user_id", context.userId).single();
    if (readError || !session) throw new Error("The audio lesson session couldn't be found.");
    const sections = data.sections.map((section) => ({ title: section.title, topic: section.topic || section.title, narration: section.narration }));
    const script = sections.map((section) => `## ${section.title}\n\n${section.narration}`).join("\n\n");
    const { data: saved, error } = await context.supabase.from("audio_study_sessions").update({ title: data.title, script, sections, status: "ready", audio_error: null, updated_at: new Date().toISOString() }).eq("id", session.id).eq("user_id", context.userId).select("*").single();
    if (error || !saved) throw new Error("The lesson was written but couldn't be saved. Please try again.");
    return { session: saved };
  });

export const failAudioStudyStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), error: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("audio_study_sessions").update({ status: "error", audio_error: data.error, updated_at: new Date().toISOString() }).eq("id", data.sessionId).eq("user_id", context.userId);
    if (error) throw new Error("Couldn't mark the failed audio session for retry.");
    return { ok: true };
  });

type SessionRow = Tables<"audio_study_sessions">;

export const generateAudioSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), index: z.number().int().min(0).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: session, error } = await sb
      .from("audio_study_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .eq("user_id", context.userId)
      .single();
    if (error || !session?.script) throw new Error("The saved lesson script couldn't be found.");
    const sections = (session.sections as AudioSection[] | null) ?? [];
    const section = sections[data.index];
    if (!section) throw new Error("That part of the lesson couldn't be found.");
    const folder = `${context.userId}/${session.set_id}/audio-study/${session.id}`;
    const file = `section-${String(data.index + 1).padStart(2, "0")}.mp3`;
    const path = `${folder}/${file}`;
    const finish = async (paths: string[]) => {
      const complete = sections.every((_, i) =>
        paths.some((p) => p.endsWith(`section-${String(i + 1).padStart(2, "0")}.mp3`)),
      );
      await sb
        .from("audio_study_sessions")
        .update({
          audio_paths: paths,
          audio_error: null,
          status: "ready",
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .eq("user_id", context.userId);
      return { paths, complete };
    };
    const merge = (p: string) => Array.from(new Set([...(session.audio_paths ?? []), p])).sort();
    try {
      // Reuse a section that was already voiced (e.g. by an earlier interrupted attempt).
      const { data: existing } = await sb.storage
        .from("study-files")
        .list(folder, { search: file });
      if (existing?.some((o) => o.name === file)) return await finish(merge(path));
      const apiKey = process.env["DEEPGRAM_API_KEY"]?.trim();
      if (!apiKey)
        throw new Error(
          "Audio generation is not configured. Add DEEPGRAM_API_KEY to the Vercel Production environment.",
        );

      // Use Deepgram's Aura-2 REST TTS directly. This keeps the TTS request
      // independent of the text-generation provider.
      // NVIDIA NIM generates the lesson script above.
      const response = await fetch(
        "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: section.narration }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Deepgram audio generation failed [${response.status}]: ${body.slice(0, 500)}`,
        );
      }

      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (contentType !== "audio/mpeg") {
        const body = await response.text();
        throw new Error(
          `Deepgram returned ${contentType ?? "an unknown response"} instead of audio: ${body.slice(0, 500)}`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 1000) throw new Error("Audio generation returned an empty file.");
      const { error: uploadError } = await sb.storage
        .from("study-files")
        .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
      if (uploadError)
        throw new Error(`The lesson audio couldn't be saved: ${uploadError.message}`);
      return await finish(merge(path));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Audio generation failed";
      console.error("[audio-study] section voice failed", data.index, message);
      await sb
        .from("audio_study_sessions")
        .update({
          audio_error: message,
          status: "audio_error",
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id)
        .eq("user_id", context.userId);
      throw new Error(`Audio generation failed: ${message}`);
    }
  });

const interactionInput = z.object({
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(2000),
  sectionIndex: z.number().int().min(0).max(20),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(8),
});

export const prepareAudioStudyAsk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => interactionInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: session } = await context.supabase.from("audio_study_sessions").select("*").eq("id", data.sessionId).eq("user_id", context.userId).single();
    if (!session) throw new Error("This audio session couldn't be found.");
    const set = await loadSet(context.supabase, session.set_id);
    const sections = (session.sections as AudioSection[] | null) ?? [];
    const current = sections[Math.min(data.sectionIndex, Math.max(0, sections.length - 1))];
    const previous = sections[data.sectionIndex - 1];
    return {
      system: `You are the same Momentum tutor teaching this saved Audio Study lesson. Answer the student's interruption clearly and concisely by default. Their words like "this", "that", and "previous" refer to the current lesson context below. Keep the answer grounded in the source material and resume-ready; do not act like a separate tutor. Use Markdown.${ci(set)}\n\nCURRENT SECTION: ${current?.title ?? "Lesson"}\n${current?.narration ?? ""}\n\nPREVIOUS SECTION: ${previous?.title ?? "none"}\n${previous?.narration ?? ""}\n\nSOURCE MATERIAL:\n${clip(set.material_text, 30000)}`,
      messages: [...data.history, { role: "user" as const, content: data.question }],
    };
  });

export const saveAudioStudyAsk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), question: z.string().min(1).max(2000), reply: z.string().min(1).max(12000), sectionIndex: z.number().int().min(0).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session } = await context.supabase.from("audio_study_sessions").select("id,set_id").eq("id", data.sessionId).eq("user_id", context.userId).single();
    if (!session) throw new Error("This audio session couldn't be found.");
    const { error } = await context.supabase.from("audio_study_events").insert([
      { user_id: context.userId, session_id: session.id, kind: "question", content: data.question, context: { sectionIndex: data.sectionIndex } },
      { user_id: context.userId, session_id: session.id, kind: "answer", content: data.reply, context: { sectionIndex: data.sectionIndex } },
    ]);
    if (error) throw new Error("The answer was generated but couldn't be saved.");
    return { saved: true };
  });

export const prepareAudioStudyQuizStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), sectionIndex: z.number().int().min(0).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session } = await context.supabase.from("audio_study_sessions").select("*").eq("id", data.sessionId).eq("user_id", context.userId).single();
    if (!session) throw new Error("This audio session couldn't be found.");
    const set = await loadSet(context.supabase, session.set_id);
    const sections = (session.sections as AudioSection[] | null) ?? [];
    const section = sections[Math.min(data.sectionIndex, Math.max(0, sections.length - 1))];
    if (!section) throw new Error("Play part of the lesson before asking for a quiz.");
    return {
      system: `Write ONE active-recall question about the lesson section below. It must be answerable from the source material with one clear expected answer. Return ONLY JSON: {"question":"","topic":"","model":""}. No multiple choice, no yes/no, no trick question.${ci(set)}\nSOURCE MATERIAL:\n${clip(set.material_text, 30000)}`,
      messages: [{ role: "user" as const, content: `CURRENT LESSON SECTION:\n${section.title}\n${section.narration}` }],
      sessionId: session.id,
      sectionIndex: data.sectionIndex,
      defaultTopic: section.topic,
    };
  });

export const saveAudioStudyQuizStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), sectionIndex: z.number().int().min(0).max(20), question: z.string().min(1).max(1000), topic: z.string().max(80), model: z.string().min(1).max(3000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase.from("audio_study_sessions").select("id,set_id").eq("id", data.sessionId).eq("user_id", context.userId).single();
    if (error || !session) throw new Error("This audio session couldn't be found.");
    const { error: saveError } = await context.supabase.from("audio_study_events").insert({ user_id: context.userId, session_id: session.id, kind: "quiz_question", content: data.question, context: { sectionIndex: data.sectionIndex, topic: data.topic, model: data.model } });
    if (saveError) throw new Error("The quiz question was created but couldn't be saved.");
    return { question: data.question, topic: data.topic, model: data.model };
  });
