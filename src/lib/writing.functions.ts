import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText, parseJson, clip } from "./ai.server";
import { loadSet, ci } from "./set-helpers.server";

async function setContext(sb: any, setId: string | null, max = 25000) {
  if (!setId) return { text: "", instr: "" };
  try {
    const set = await loadSet(sb, setId);
    return {
      text: `\n\nRELEVANT STUDY MATERIAL from the student's set "${set.name}" (use when helpful; cite it as "your study material"):\n${clip(set.material_text, max)}`,
      instr: ci(set),
    };
  } catch {
    return { text: "", instr: "" };
  }
}

// ---------- Assignment Helper ----------
const TEACH = `You are Momentum's Assignment Helper for humanities and social-science work. You TEACH and GUIDE: you help the student understand, think, plan and improve THEIR OWN work. Never write the assignment or full paragraphs for them; short illustrative phrases are fine when clearly marked as examples. Don't invent requirements; if something is unclear, say so. Use clear Markdown.`;

export type AssignmentStep = "understand" | "brainstorm" | "outline" | "feedback";

export const assignmentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        step: z.enum(["understand", "brainstorm", "outline", "feedback"]),
        question: z.string().max(3000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: a, error } = await sb.from("assignments").select("*").eq("id", data.id).single();
    if (error || !a) throw new Error("Assignment not found");
    if (!a.instructions.trim()) throw new Error("Add the assignment instructions first.");
    const mat = await setContext(sb, a.set_id);
    const brief = `ASSIGNMENT INSTRUCTIONS:\n${clip(a.instructions, 12000)}\n\nRUBRIC / TEACHER REQUIREMENTS:\n${clip(a.rubric || "(none provided)", 8000)}\n\nSOURCE MATERIAL PROVIDED:\n${clip(a.sources || "(none)", 20000)}\n\nSTUDENT'S OWN IDEAS / NOTES:\n${clip(a.ideas || "(none yet)", 6000)}${mat.text}`;
    const now = new Date().toISOString();

    if (data.step === "understand") {
      const out = await aiText(
        `${TEACH}
Break down the assignment with these "## " sections: What It's Asking (in plain, simple language), Required Format, Required Length, Sources Required, Required Concepts, Important Instructions, Rubric Requirements, Questions Your Work Must Answer, Unclear or Missing Info. Write "Not specified" when the instructions don't say — never guess. End with a 3-bullet "## Before You Start" checklist.${mat.instr}`,
        [{ role: "user", content: brief }],
      );
      await sb.from("assignments").update({ understanding: out, updated_at: now }).eq("id", a.id);
      return { text: out };
    }
    if (data.step === "brainstorm") {
      const out = await aiText(
        `${TEACH}
Help the student brainstorm WITHOUT forcing one answer. "## " sections: Possible Arguments (3-5 distinct positions, each with a one-line rationale), Thesis Ideas (one rough working thesis per position — label them "starting points to rewrite in your own words"), Main Points to Develop, Evidence to Investigate (point to specific parts of the provided sources/material when possible), Counterarguments, Examples to Consider, Questions to Ask Yourself. Build on the student's own ideas first if they gave any.${mat.instr}`,
        [
          {
            role: "user",
            content: `${brief}\n\nUNDERSTANDING SO FAR:\n${clip(a.understanding ?? "", 5000)}`,
          },
        ],
      );
      await sb.from("assignments").update({ brainstorm: out, updated_at: now }).eq("id", a.id);
      return { text: out };
    }
    if (data.step === "outline") {
      if (!a.chosen.trim())
        throw new Error("Write the argument or thesis you want to go with first.");
      const out = await aiText(
        `${TEACH}
Create an organized outline built on the student's CHOSEN argument (keep their wording of the thesis; you may suggest a sharper version separately, labelled "Possible refinement"). For essays use "## " sections: Introduction (hook idea, context, thesis), Body Paragraph 1..N (topic sentence idea, evidence to use, analysis questions to answer — what does it show and why does it matter), Counterargument & Rebuttal (when appropriate), Conclusion. Outline bullets only — no written paragraphs. Fit the required format/length. End with "## Checklist Against the Requirements".${mat.instr}`,
        [
          {
            role: "user",
            content: `${brief}\n\nSTUDENT'S CHOSEN ARGUMENT / THESIS:\n${a.chosen}\n\nBRAINSTORM:\n${clip(a.brainstorm ?? "", 5000)}`,
          },
        ],
      );
      await sb.from("assignments").update({ outline: out, updated_at: now }).eq("id", a.id);
      return { text: out };
    }
    // feedback on the student's draft
    const q = (data.question ?? "").trim() || "How can I make this stronger?";
    if (!a.draft.trim()) throw new Error("Paste or write some of your draft first.");
    const chat = (Array.isArray(a.chat) ? a.chat : []) as {
      role: "user" | "assistant";
      content: string;
    }[];
    const out = await aiText(
      `${TEACH}
You're giving draft support. Answer the student's question about THEIR draft. Quote short phrases from the draft so they can find the spot, explain what works, what's missing and why a change would help, and suggest how THEY could revise (questions, directions, a brief illustrative example phrase at most). Never rewrite whole paragraphs. Check against the requirements/rubric when relevant. Preserve the student's voice. Flag factual claims or citations that should be verified.${mat.instr}

${brief}

THESIS / CHOSEN ARGUMENT: ${a.chosen || "(not set)"}
OUTLINE:\n${clip(a.outline ?? "(none)", 5000)}

CURRENT DRAFT:\n${clip(a.draft, 25000)}`,
      [...chat.slice(-8), { role: "user", content: q }],
    );
    const next = [...chat, { role: "user", content: q }, { role: "assistant", content: out }].slice(
      -30,
    );
    await sb.from("assignments").update({ chat: next, updated_at: now }).eq("id", a.id);
    return { text: out };
  });

// ---------- Essay Grader ----------
export type EssayResult = {
  requirements: { items: string[]; unclear: string[] };
  sections: { name: string; works: string[]; improve: string[] }[];
  paragraphs: {
    label: string;
    works: string;
    doesnt: string;
    missing: string;
    change: string;
    why: string;
  }[];
  check: { met: string[]; partial: string[]; missing: string[] };
  rubricUsed: boolean;
  scores: { category: string; score: number; max: number; reasoning: string }[];
  finalScore: number;
  finalMax: number;
  like: string[];
  improve: string[];
  opportunities: string[];
  changes: { current: string; improve: string; why: string; kind: "objective" | "style" }[];
  verify: string[];
  summary: {
    overall: string;
    strongest: string;
    weakest: string;
    mostImportant: string;
    satisfies: string;
  };
  threeChanges: string[];
};

const GRADER = `You are Momentum's Essay Grader — an honest, detailed, constructive academic grader. Return ONLY JSON with this exact shape:
{"requirements":{"items":["requirement identified"],"unclear":["anything unclear about the assignment"]},
"sections":[{"name":"Thesis / Central Argument","works":["specific point"],"improve":["specific, actionable point"]}],
"paragraphs":[{"label":"Paragraph 2 (starts \\"...first words...\\")","works":"","doesnt":"","missing":"","change":"","why":""}],
"check":{"met":[],"partial":[],"missing":[]},
"rubricUsed":false,
"scores":[{"category":"","score":0,"max":100,"reasoning":"why this score"}],
"finalScore":0,"finalMax":100,
"like":["strength with specific reason"],
"improve":["weakness explained specifically"],
"opportunities":["3-5 highest-impact changes"],
"changes":[{"current":"quote or describe the current approach","improve":"what to improve","why":"why it helps","kind":"objective|style"}],
"verify":["citations or factual claims the student should double-check"],
"summary":{"overall":"","strongest":"","weakest":"","mostImportant":"","satisfies":"whether it appears to satisfy the assignment"},
"threeChanges":["", "", ""]}

PROCESS:
1. Understand the assignment first (instructions, question, rubric, teacher notes, required sources, word/page, citation and formatting requirements). List them in requirements.items. If none were provided, say the essay is graded on general academic writing criteria. Put anything ambiguous in requirements.unclear instead of guessing. Never invent requirements.
2. "sections" must cover, in order: "Thesis / Central Argument" (clear? answers the question? specific? arguable? consistent? proven?), "Argument & Ideas" (strength, depth, logic, originality where appropriate, development, support), "Evidence" (quality, relevance, amount, support for claims, quotation integration, explained vs dropped in), "Analysis" (where significance is explained well, where it summarizes instead of analyzing, where deeper interpretation is needed, missed opportunities), "Organization" (intro, paragraph structure, topic sentences, progression, transitions, order, conclusion, flow; flag confusing/repetitive/rushed/out-of-place parts), "Writing Quality" (clarity, sentence structure, word choice, concision, academic tone, repetition, awkward wording, grammar, spelling, punctuation — clear simple writing is GOOD; never penalize for not being complicated), "Introduction" (topic, context, leads to thesis, no filler), "Conclusion" (concludes, connects to thesis, synthesizes, final insight, not just repeating the intro). 2-5 specific bullets each, quoting short phrases from the essay.
3. "paragraphs": analyze the problematic or most important paragraphs individually (2-6).
4. "check": every identifiable requirement as met/partial/missing (include the rubric criteria explicitly if a rubric was given).
5. Scores: if a RUBRIC is provided, set rubricUsed true and use ITS categories and point scale (max per category), with finalScore/finalMax based primarily on the rubric. Otherwise use 0-100 for: Thesis / Central Argument, Argument & Critical Thinking, Evidence, Analysis, Organization, Paragraph Development, Introduction & Conclusion, Writing Quality, Grammar & Mechanics, Assignment Requirements — and a reasonable weighted overall finalScore out of 100. Explain each score.
6. Feedback: honest but constructive. No artificially high or low scores. Be specific — never vague lines like "analysis needs work"; say where and how. Mark each change as "objective" (a real problem) or "style" (preference). Don't rewrite the essay; short illustrative phrases only. Preserve the student's voice. Flag questionable citations/facts in "verify" rather than assuming they're right or wrong.
7. This is an AI estimate based on the provided requirements — never claim to know the teacher's grade.`;

export const gradeEssay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: e, error } = await sb.from("essay_grades").select("*").eq("id", data.id).single();
    if (error || !e) throw new Error("Essay not found");
    if (e.essay.trim().length < 200)
      throw new Error("The essay is too short to grade thoroughly (under 200 characters).");
    const mat = await setContext(sb, e.set_id, 20000);
    const text = await aiText(GRADER + mat.instr, [
      {
        role: "user",
        content: `ASSIGNMENT INSTRUCTIONS / ESSAY QUESTION:\n${clip(e.instructions || "(not provided)", 10000)}\n\nRUBRIC:\n${clip(e.rubric || "(not provided)", 10000)}\n\nTEACHER INSTRUCTIONS:\n${clip(e.teacher_notes || "(not provided)", 5000)}\n\nREQUIRED SOURCES / MATERIALS:\n${clip(e.sources || "(not provided)", 15000)}${mat.text}\n\nSTUDENT ESSAY (${e.essay.trim().split(/\s+/).length} words):\n${clip(e.essay, 60000)}`,
      },
    ]);
    const r = parseJson<Partial<EssayResult>>(text);
    const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
    const result: EssayResult = {
      requirements: { items: arr(r.requirements?.items), unclear: arr(r.requirements?.unclear) },
      sections: (r.sections ?? [])
        .map((s) => ({
          name: String(s?.name ?? ""),
          works: arr(s?.works),
          improve: arr(s?.improve),
        }))
        .filter((s) => s.name),
      paragraphs: (r.paragraphs ?? []).map((p) => ({
        label: String(p?.label ?? ""),
        works: String(p?.works ?? ""),
        doesnt: String(p?.doesnt ?? ""),
        missing: String(p?.missing ?? ""),
        change: String(p?.change ?? ""),
        why: String(p?.why ?? ""),
      })),
      check: {
        met: arr(r.check?.met),
        partial: arr(r.check?.partial),
        missing: arr(r.check?.missing),
      },
      rubricUsed: !!r.rubricUsed,
      scores: (r.scores ?? [])
        .map((s) => ({
          category: String(s?.category ?? ""),
          score: Number(s?.score) || 0,
          max: Number(s?.max) || 100,
          reasoning: String(s?.reasoning ?? ""),
        }))
        .filter((s) => s.category),
      finalScore: Number(r.finalScore) || 0,
      finalMax: Number(r.finalMax) || 100,
      like: arr(r.like),
      improve: arr(r.improve),
      opportunities: arr(r.opportunities),
      changes: (r.changes ?? []).map((c) => ({
        current: String(c?.current ?? ""),
        improve: String(c?.improve ?? ""),
        why: String(c?.why ?? ""),
        kind: c?.kind === "style" ? ("style" as const) : ("objective" as const),
      })),
      verify: arr(r.verify),
      summary: {
        overall: String(r.summary?.overall ?? ""),
        strongest: String(r.summary?.strongest ?? ""),
        weakest: String(r.summary?.weakest ?? ""),
        mostImportant: String(r.summary?.mostImportant ?? ""),
        satisfies: String(r.summary?.satisfies ?? ""),
      },
      threeChanges: arr(r.threeChanges).slice(0, 3),
    };
    if (!result.scores.length)
      throw new Error("The grader returned an incomplete result. Please try again.");
    const pct = result.finalMax
      ? Math.round((result.finalScore / result.finalMax) * 1000) / 10
      : null;
    await sb
      .from("essay_grades")
      .update({ result: result as never, final_score: pct })
      .eq("id", e.id);
    return { result };
  });
