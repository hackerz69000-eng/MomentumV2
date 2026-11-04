import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";


/** Authenticated prompt preparation for browser-side streaming; keeps set loading and grounding server-side. */
export const prepareExplainWhyStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    setId: z.string().min(1).max(200), lectureId: z.string().uuid().optional(),
    question: z.string().min(1).max(2000), options: z.array(z.string().max(500)).max(8).default([]),
    correct: z.string().max(2000), given: z.string().max(4000).default(""), topic: z.string().max(100).default(""),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId, data.lectureId ?? null);
    const opts = data.options.length ? `\nOPTIONS:\n${data.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}` : "";
    return {
      system: `You explain a quiz answer to a student using their study material as the source. Markdown, under 250 words, with these bold headings (skip any that don't apply):\n**Why the correct answer is right** — cite where in the material (section/document) when possible.\n**Why your answer was off** — kind and specific; skip if they were right or left it blank.\n${data.options.length ? "**Why the other choices are wrong** — one short line per wrong option.\n" : ""}**What this tests** — the concept in one sentence.\n**Remember for next time** — a short memory hook.\nIf the material doesn't actually support the marked answer, say so honestly instead of inventing a justification.${ci(set)}\nMATERIAL:\n${clip(set.material_text, 35000)}`,
      messages: [{ role: "user" as const, content: `TOPIC: ${data.topic}\nQUESTION: ${data.question}${opts}\nCORRECT ANSWER: ${data.correct}\nMY ANSWER: ${data.given || "(blank)"}` }],
      task: "reasoning" as const,
    };
  });

/** Prepare grounded search-answer prompt; snippets remain supplied by the authenticated client. */
export const prepareSearchAnswerStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(2).max(500), snippets: z.array(z.object({ label: z.string().max(200), text: z.string().max(4000) })).max(20) }).parse(d))
  .handler(async ({ data }) => {
    if (!data.snippets.length) throw new Error("I couldn't find this in your study materials.");
    const src = data.snippets.map((s, i) => `[S${i + 1}] ${s.label}\n${s.text}`).join("\n\n");
    return { system: `Answer the student's search using ONLY the numbered sources from their Momentum content. Cite sources inline like [S1]. Be concise (under 180 words, Markdown). If the sources don't answer it, reply exactly "I couldn't find this in your study materials." and nothing else.`, messages: [{ role: "user" as const, content: `SEARCH: ${data.query}\n\nSOURCES:\n${clip(src, 40000)}` }], task: "fast" as const };
  });

/** "Explain why" for any answered question (quiz, exam, recall, mistake). */
