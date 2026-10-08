import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiText, parseJson, clip } from "./ai.server";
import { setStats, type Attempt, type AttemptResult, type Flashcard } from "./stats";
import { activityStats } from "./activity";
import { loadSet, ci, openMistakes, type MistakeRow } from "./set-helpers.server";
import { generateNotesFromMaterial } from "./study-generator";

const lectureIdField = z.string().uuid().optional();
const mistakeLines = (ms: MistakeRow[]) =>
  ms.map(
    (m) =>
      `[${m.topic}] ${m.question.slice(0, 200)} (missed ${m.wrong_count}x; correct answer: ${m.correct_answer.slice(0, 160)})`,
  );

const NOTES_SYSTEM = `You are an expert academic note-taking editor. Convert the student's source material into polished, genuinely useful study notes in Markdown.

ORGANIZATION:
- Start with exactly one "# " title that accurately describes the material.
- Preserve the source's order and major topics/chapters/sections. Create a clear "## " heading for each meaningful topic and "### " headings for important subtopics.
- Use short paragraphs for explanations and bullets for lists, facts, properties, steps, causes/effects, comparisons, and examples.
- Put important terminology in the form "**Term** — definition".
- For processes, use numbered steps when the source describes a sequence.
- For comparisons, use a small Markdown table only when it makes the distinction clearer.
- Highlight genuinely high-yield details with "**Key point:**" or a short bullet; do not decorate ordinary facts.
- Finish with "## Key Takeaways" containing 6-10 of the most important ideas from the material.

QUALITY:
- Cover the material thoroughly rather than producing a vague summary.
- Combine repeated or fragmented source passages into one coherent explanation when they clearly belong to the same topic.
- Keep important qualifiers, conditions, formulas, examples, exceptions, and relationships.
- Do NOT invent examples, facts, headings, conclusions, or "testable" claims that are not supported by the source.
- Do NOT add generic study advice or statements such as "this is examinable" unless the source explicitly says so.
- Do not include a preamble or commentary about being an AI.
- Use only information supported by the provided material.`;

const CARDS_SYSTEM = `You create high-value review flashcards from the GENERATED STUDY NOTES below. Return ONLY JSON:
{"cards":[{"q":"question or prompt","a":"concise answer","t":"short topic name (2-4 words)"}]}

Create up to 20 cards, but never pad the deck with weak or generic cards. Every card must test something explicitly stated in the notes.
Prioritize:
1. core definitions and terminology
2. important mechanisms, processes, steps, formulas, and cause/effect relationships
3. distinctions and comparisons that are easy to confuse
4. high-yield facts, exceptions, and relationships
5. concepts that require actual recall rather than recognition

Avoid trivial wording, vague prompts, duplicate questions, questions whose answer is obvious from the question, and generic study advice. Answers should be concise but complete (normally under 60 words). Each card's topic must match the section/topic it came from.`;

async function recentQuestions(supabase: any, setId: string): Promise<string[]> {
  const { data } = await supabase
    .from("quiz_attempts")
    .select("results")
    .eq("set_id", setId)
    .order("created_at", { ascending: false })
    .limit(15);
  const qs: string[] = [];
  for (const a of data ?? [])
    for (const r of (a.results as AttemptResult[] | null) ?? []) if (r.q) qs.push(r.q);
  return [...new Set(qs)].slice(0, 40);
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function makeNotes(set: {
  name: string;
  subject: string;
  material_text: string;
  custom_instructions?: string;
}) {
  try {
    return await aiText(NOTES_SYSTEM + ci(set), [
      {
        role: "user",
        content: `Study set: ${set.name} (${set.subject || "general"})\n\nMATERIAL:\n${clip(set.material_text)}`,
      },
    ]);
  } catch (err) {
    console.warn("AI notes generation fallback active:", err);
    return generateNotesFromMaterial(set.material_text, set.name, set.subject);
  }
}

async function makeCards(set: {
  name?: string;
  subject?: string;
  material_text: string;
  notes: string;
  custom_instructions?: string;
}) {
  const text = await aiText(CARDS_SYSTEM + ci(set), [
    {
      role: "user",
      content: `STUDY SET: ${set.name || "Study Set"} (${set.subject || "general"})

GENERATED STUDY NOTES:
${clip(set.notes, 50000)}

SOURCE MATERIAL FOR VERIFICATION:
${clip(set.material_text, 50000)}`,
    },
  ]);
  const parsed = parseJson<{ cards?: { q: string; a: string; t?: string }[] }>(text);
  const cards = (parsed.cards ?? [])
    .filter((c) => c?.q?.trim() && c?.a?.trim())
    .map((c) => ({ q: c.q.trim(), a: c.a.trim(), t: (c.t ?? "").trim() }))
    .slice(0, 20);

  if (!cards.length) {
    throw new Error("No useful flashcards could be generated from the study notes.");
  }
  return cards;
}

const idInput = (d: unknown) => z.object({ setId: z.string().min(1) }).parse(d);

export const processSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const set = await loadSet(supabase, data.setId);
    await supabase
      .from("study_sets")
      .update({ status: "processing", error: null })
      .eq("id", set.id);
    try {
      // Notes come first: flashcards are deliberately generated from the
      // finished notes so the deck is coherent with what the student will review.
      const notes = await makeNotes(set);
      const cards = await makeCards({ ...set, notes });
      await supabase.from("flashcards").delete().eq("set_id", set.id);
      const { error: insErr } = await supabase
        .from("flashcards")
        .insert(
          cards.map((c, i) => ({
            set_id: set.id,
            user_id: context.userId,
            question: c.q,
            answer: c.a,
            topic: (c.t ?? "").slice(0, 60),
            position: i,
          })),
        );
      if (insErr) throw new Error(insErr.message);
      await supabase
        .from("study_sets")
        .update({ notes, status: "ready", error: null, updated_at: new Date().toISOString() })
        .eq("id", set.id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Processing failed";
      await supabase.from("study_sets").update({ status: "error", error: msg }).eq("id", set.id);
      throw new Error(msg);
    }
  });

export const regenerateNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const notes = await makeNotes(set);
    // Keep the previous notes recoverable in Recently Deleted.
    if (set.notes?.trim())
      await context.supabase
        .from("trash")
        .insert({
          user_id: context.userId,
          kind: "notes",
          label: `Previous notes — ${set.name}`,
          set_id: set.id,
          data: { notes: set.notes },
        });
    await context.supabase
      .from("study_sets")
      .update({ notes, updated_at: new Date().toISOString() })
      .eq("id", set.id);
    return { notes };
  });

export const regenerateCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const set = await loadSet(sb, data.setId);
    const cards = await makeCards({ ...set, notes: set.notes ?? "" });
    const { data: old } = await sb.from("flashcards").select("*").eq("set_id", set.id);
    if (old?.length)
      await sb
        .from("trash")
        .insert({
          user_id: context.userId,
          kind: "flashcards",
          label: `${old.length} replaced flashcards — ${set.name}`,
          set_id: set.id,
          data: { rows: old },
        });
    await sb.from("flashcards").delete().eq("set_id", set.id);
    const { error } = await sb
      .from("flashcards")
      .insert(
        cards.map((c, i) => ({
          set_id: set.id,
          user_id: context.userId,
          question: c.q,
          answer: c.a,
          topic: (c.t ?? "").slice(0, 60),
          position: i,
        })),
      );
    if (error)
      throw new Error(
        "New flashcards couldn't be saved. Your previous cards are in Recently Deleted.",
      );
    return { ok: true };
  });

export type QuizQuestion = {
  type: "mc" | "tf" | "short";
  question: string;
  options: string[];
  answer: number;
  answerText: string;
  explanation: string;
  topic: string;
  setId?: string;
};

const DIFF = z.enum(["easy", "medium", "hard", "mixed"]);
const QTYPE = z.enum(["mc", "tf", "short"]);

type QOpts = {
  retest?: string[] | undefined;
  avoid?: string[] | undefined;
  count: number;
  difficulty: z.infer<typeof DIFF>;
  types: z.infer<typeof QTYPE>[];
  exam?: boolean | undefined;
  plan?: { topic: string; count: number }[] | undefined;
  questionGuidance?: string | undefined;
};

const QUALITY_RULES = `QUALITY RULES (mandatory):
- Every question and correct answer must be directly supported by the MATERIAL. Never ask about facts not in it, and never contradict it.
- The correct answer must be determinable from the MATERIAL alone. If the material doesn't contain enough information for a question, don't ask it.
- No duplicate or near-duplicate questions; each question tests a different fact or idea.
- Multiple choice: exactly ONE defensibly correct option; every other option must be definitely wrong according to the material (never partially true or arguably correct). Plausible, same type/length as the answer. No joke, absurd, "all of the above" or "none of the above" options.
- True/false: unambiguous statements that are clearly true or clearly false per the material; no trick wording unless difficulty is hard.
- Short answer: ask for a specific idea with a concise model answer drawn from the material.
- Explanation (2-4 sentences): why the correct answer is right per the material (name the section/document when possible), why the tempting wrong options are wrong, and the concept being tested. It must never contradict the marked answer.
- Match the requested difficulty: easy = recall of key facts/definitions, medium = understanding/application, hard = analysis, comparison and multi-step reasoning.`;

async function validateQuestions(
  material: string,
  qs: QuizQuestion[],
  extra: string,
): Promise<QuizQuestion[]> {
  try {
    const text = await aiText(
      `You are a strict exam reviewer. For each question, check it against the MATERIAL: is it supported, can the answer actually be determined from the material, is the marked answer correct, is there exactly one correct option (no other option arguably correct), are distractors plausible but wrong, is the explanation accurate and consistent with the answer, is it unambiguous, is it a duplicate of another? Fix problems in place; if a question can't be supported, REPLACE it with a better question on the same topic that is supported, or DROP it if the material has nothing suitable. Keep the same JSON shape and type. Return ONLY JSON: {"questions":[...]}.
${QUALITY_RULES}${extra}`,
      [
        {
          role: "user",
          content: `QUESTIONS:\n${JSON.stringify({ questions: qs })}\n\nMATERIAL:\n${clip(material, 45000)}`,
        },
      ],
    );
    const fixed = parseQuestions(text);
    if (!fixed.length)
      throw new Error(
        "I couldn't find enough information in your study materials to create these questions. Try adding more material or fewer questions.",
      );
    return fixed;
  } catch (e) {
    // Never show unchecked questions: surface a clear, retryable message instead.
    if (e instanceof Error && e.message.startsWith("I couldn't find")) throw e;
    throw new Error(
      "The questions couldn't be checked against your study materials. Please try again.",
    );
  }
}

function parseQuestions(text: string): QuizQuestion[] {
  const parsed = parseJson<{ questions?: Partial<QuizQuestion>[] }>(text);
  const out: QuizQuestion[] = [];
  const seen = new Set<string>();
  for (const q of parsed.questions ?? []) {
    if (!q?.question || !String(q.question).trim()) continue;
    const type = q.type === "tf" || q.type === "short" ? q.type : "mc";
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : [];
    if (options.some((o) => !o)) continue;
    const answer = Number(q.answer);
    if (
      type !== "short" &&
      (options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length)
    )
      continue;
    if (type === "mc" && new Set(options.map(norm)).size !== options.length) continue;
    const key = norm(String(q.question));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type,
      question: String(q.question),
      options: type === "short" ? [] : options,
      answer: type === "short" ? -1 : answer,
      answerText: String(q.answerText ?? (type !== "short" ? options[answer] : "")),
      explanation: String(q.explanation ?? ""),
      topic: String(q.topic ?? "General").slice(0, 60),
    });
  }
  return out;
}

async function makeQuestions(
  set: { material_text: string; custom_instructions?: string },
  data: QOpts,
  maxChars = 60000,
): Promise<QuizQuestion[]> {
  const typeDesc = data.types
    .map((t) =>
      t === "mc"
        ? '"mc" (multiple choice, 4 options)'
        : t === "tf"
          ? '"tf" (true/false, options ["True","False"])'
          : '"short" (short answer, 1-2 sentence expected answer)',
    )
    .join(", ");
  const planText = data.plan?.length
    ? `\nADAPTIVE TOPIC PLAN — write this many questions per topic (use these exact topic names): ${data.plan.map((p) => `${p.topic}: ${p.count}`).join("; ")}. If a topic isn't in the material, use the closest topic.`
    : "";
  const text = await aiText(
    `You write ${data.exam ? "realistic practice exams" : "quizzes"} from study material. Return ONLY JSON:
{"questions":[{"type":"mc","question":"...","options":["..","..","..",".."],"answer":0,"answerText":"the correct answer as text","explanation":"2-4 sentences: why it's right, why the other options are wrong, concept tested","topic":"short topic name (2-4 words)"}]}
Rules: exactly ${data.count} questions. Allowed types: ${typeDesc}; mix them roughly evenly. Difficulty: ${data.difficulty}${data.difficulty === "mixed" ? " (blend easy, medium and hard)" : ""}.
For "mc"/"tf", "answer" is the 0-based index of the correct option. For "short", use "options": [] and "answer": -1, and put the model answer in "answerText".
Reuse consistent topic names across questions. Test understanding, not trivia. Only use the material.
${data.questionGuidance?.trim() ? `\nTEST EXPECTATIONS FROM THE STUDENT — use these preferences to shape the questions. Treat them as strong preferences, but never violate the material-grounding or quality rules. Do not invent facts just to satisfy the request. If the requested style cannot be supported by the material, use the closest supported version.\n${data.questionGuidance.trim().slice(0, 2000)}` : ""}
${QUALITY_RULES}${data.avoid?.length ? `\nDo NOT repeat these recently asked questions (ask about different facts or angles):\n- ${data.avoid.slice(0, 40).join("\n- ")}` : ""}${planText}${data.retest?.length ? `\nMISTAKE BANK — the student got these concepts wrong before. Include about ${Math.min(data.retest.length, Math.ceil(data.count / 3))} questions that re-test the same concepts with NEW wording or a new angle (don't copy the question):\n- ${data.retest.join("\n- ")}` : ""}${ci(set)}`,
    [{ role: "user", content: `MATERIAL:\n${clip(set.material_text, maxChars)}` }],
  );
  const avoidSet = new Set((data.avoid ?? []).map(norm));
  const draft = parseQuestions(text).filter((q) => !avoidSet.has(norm(q.question)));
  if (!draft.length)
    throw new Error(
      "I couldn't find enough information in your study materials to create this question set.",
    );
  const guidanceForReview = data.questionGuidance?.trim()
    ? `\nTEST EXPECTATIONS FROM THE STUDENT — preserve these requested question-style preferences when reviewing/fixing questions, as long as they remain supported by the material:\n${data.questionGuidance.trim().slice(0, 2000)}`
    : "";
  const questions = await validateQuestions(
    set.material_text,
    draft,
    `${guidanceForReview}${ci(set)}`,
  );
  return questions.slice(0, data.count);
}

export const generateQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        count: z.number().int().min(3).max(50),
        difficulty: DIFF,
        types: z.array(QTYPE).min(1),
        exam: z.boolean().optional(),
        questionGuidance: z.string().max(2000).optional(),
        plan: z
          .array(z.object({ topic: z.string().max(80), count: z.number().int().min(1).max(50) }))
          .max(30)
          .optional(),
        lectureId: lectureIdField,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId, data.lectureId);
    const avoid = await recentQuestions(context.supabase, set.id);
    const retest =
      data.plan?.length && !data.lectureId
        ? mistakeLines(await openMistakes(context.supabase, set.id, 8))
        : [];
    const questions = await makeQuestions(set, { ...data, avoid, retest });
    if (!questions.length) throw new Error("Could not generate questions. Please try again.");
    return { questions };
  });

export const generateComprehensive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setIds: z.array(z.string().min(1).max(200)).min(2).max(10),
        count: z.number().int().min(5).max(60),
        difficulty: DIFF,
        types: z.array(QTYPE).min(1),
        questionGuidance: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sets = await Promise.all(data.setIds.map((id) => loadSet(context.supabase, id)));
    const base = Math.floor(data.count / sets.length);
    let extra = data.count - base * sets.length;
    const perChars = Math.max(12000, Math.floor(60000 / sets.length));
    const results = await Promise.all(
      sets.map((set) => {
        const n = base + (extra-- > 0 ? 1 : 0);
        if (n < 1) return Promise.resolve([] as QuizQuestion[]);
        return recentQuestions(context.supabase, set.id)
          .then((avoid) =>
            makeQuestions(
              set,
              {
                count: n,
                difficulty: data.difficulty,
                types: data.types,
                exam: true,
                avoid,
                questionGuidance: data.questionGuidance,
              },
              perChars,
            ),
          )
          .then((qs) => qs.map((q) => ({ ...q, setId: set.id })))
          .catch(() => [] as QuizQuestion[]);
      }),
    );
    const questions = results.flat();
    if (!questions.length) throw new Error("Could not generate questions. Please try again.");
    return { questions };
  });

export type RecallQuestion = { question: string; topic: string };

export const generateRecall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        count: z.number().int().min(1).max(20),
        focus: z.array(z.string().max(80)).max(10),
        difficulty: DIFF.optional(),
        lectureId: lectureIdField,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId, data.lectureId);
    const avoid = await recentQuestions(context.supabase, set.id);
    const retest = data.lectureId
      ? []
      : mistakeLines(await openMistakes(context.supabase, set.id, 6));
    const text = await aiText(
      `You write active-recall questions: open questions a student must answer from memory in 1-4 sentences (explain, define, compare, why/how). No multiple choice, no yes/no. Return ONLY JSON: {"questions":[{"question":"...","topic":"short topic name (2-4 words)"}]}. Exactly ${data.count} questions, all different from each other. Every question must be answerable from the material alone, with one clear expected answer; don't ask about anything not in the material.${data.difficulty ? ` Difficulty: ${data.difficulty}.` : ""}${avoid.length ? ` Do not repeat these recent questions: ${avoid.slice(0, 30).join(" | ")}.` : ""}${ci(set)}${data.focus.length ? ` Prioritize these weak topics (about half the questions), using these exact topic names: ${data.focus.join(", ")}.` : ""}${retest.length ? ` Mistake Bank — the student repeatedly missed these concepts; re-test 1-3 of them with fresh wording: ${retest.join(" | ")}.` : ""}`,
      [{ role: "user", content: `MATERIAL:\n${clip(set.material_text)}` }],
    );
    const parsed = parseJson<{ questions?: Partial<RecallQuestion>[] }>(text);
    const seenR = new Set<string>();
    const questions = (parsed.questions ?? [])
      .filter(
        (q) =>
          q?.question &&
          !seenR.has(norm(String(q.question))) &&
          seenR.add(norm(String(q.question))),
      )
      .map((q) => ({
        question: String(q.question),
        topic: String(q.topic ?? "General").slice(0, 60),
      }));
    if (!questions.length) throw new Error("Could not generate questions. Please try again.");
    return { questions: questions.slice(0, data.count) };
  });

export const recallHint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        question: z.string().max(1000),
        lectureId: lectureIdField,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId, data.lectureId);
    const hint = await aiText(
      `Give ONE short hint (max 20 words) that nudges the student toward the answer WITHOUT revealing it. No preamble.${ci(set)}\nMATERIAL:\n${clip(set.material_text, 30000)}`,
      [{ role: "user", content: data.question }],
    );
    return { hint: hint.trim() };
  });

export type RecallGrade = "correct" | "mostly" | "partial" | "incorrect";

export const gradeRecall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        question: z.string().max(1000),
        answer: z.string().max(4000),
        lectureId: lectureIdField,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId, data.lectureId);
    const text = await aiText(
      `You grade a student's from-memory answer against the source material. Return ONLY JSON: {"grade":"correct|mostly|partial|incorrect","feedback":"1-3 sentences: what they got right and what they missed","model":"a concise model answer from the material"}.
Grade on MEANING, not exact wording: accept synonyms, paraphrases and reasonable variations. "correct" = all key ideas; "mostly" = key idea right with a minor gap; "partial" = some relevant correct content but important parts missing or slightly wrong (give partial credit); "incorrect" = wrong, irrelevant or empty. The model answer must come from the material.${ci(set)}
MATERIAL:\n${clip(set.material_text, 40000)}`,
      [
        {
          role: "user",
          content: `QUESTION: ${data.question}\nSTUDENT ANSWER: ${data.answer || "(empty)"}`,
        },
      ],
    );
    const p = parseJson<{ grade?: string; feedback?: string; model?: string }>(text);
    const found = (["correct", "mostly", "partial", "incorrect"] as const).find(
      (g) =>
        g ===
        String(p.grade ?? "")
          .toLowerCase()
          .trim(),
    );
    if (!found)
      throw new Error(
        "The AI couldn't grade that answer reliably. Your answer is still here — try again.",
      );
    const grade: RecallGrade = found;
    return { grade, feedback: String(p.feedback ?? ""), model: String(p.model ?? "") };
  });

export const generateGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const set = await loadSet(sb, data.setId);
    const [{ data: cards }, { data: attempts }, { data: full }, mistakes] = await Promise.all([
      sb.from("flashcards").select("*").eq("set_id", set.id),
      sb.from("quiz_attempts").select("*").eq("set_id", set.id),
      sb.from("study_sets").select("notes").eq("id", set.id).single(),
      openMistakes(sb, set.id, 20),
    ]);
    const stats = setStats((cards ?? []) as Flashcard[], (attempts ?? []) as Attempt[], mistakes);
    const missed = ((attempts ?? []) as Attempt[])
      .flatMap((a) =>
        ((a.results as AttemptResult[] | null) ?? [])
          .filter((r) => !r.correct && r.q)
          .map((r) => `${r.topic}: ${r.q}`),
      )
      .slice(-25);
    const lapsed = ((cards ?? []) as Flashcard[])
      .filter((c) => c.lapses > 0)
      .map((c) => `${c.topic}: ${c.question}`)
      .slice(0, 15);
    const perf = [
      `Weak topics: ${stats.weak.map((t) => `${t.topic} (${t.accuracy}%)`).join(", ") || "none detected yet"}`,
      `All topics: ${stats.topics.map((t) => `${t.topic} ${t.accuracy}% ${t.status}`).join("; ") || "no data yet"}`,
      `Quiz average: ${stats.quizAvg ?? "n/a"}%, latest exam: ${stats.examLatest ?? "n/a"}%, flashcard mastery: ${stats.masteryPct}%, active recall: ${stats.recallPct ?? "n/a"}%`,
      `Questions the student missed: ${missed.join(" | ") || "none recorded"}`,
      `Flashcards the student forgot: ${lapsed.join(" | ") || "none"}`,
      `Mistake Bank (unresolved, most repeated first): ${mistakeLines(mistakes).join(" | ") || "empty"}`,
    ].join("\n");
    const guide = await aiText(
      `You write a personalized, structured study guide in Markdown from the student's material and performance. Use exactly these "## " sections in order:
## Main Topics
## Key Concepts
## Definitions
## Key Facts
## Examples
## Common Mistakes
## Weak Areas
## Quick Review
Start with "# Study Guide: <set name>". Base everything on the material. If you add explanation not found in the material, label it "(Additional explanation)". "Common Mistakes" should draw on the Mistake Bank, missed questions and forgotten cards when available. "Weak Areas" must be personalized from the performance data (if none, say so and suggest how to find them). "Quick Review" is a short last-minute bullet list. No preamble.${ci(set)}`,
      [
        {
          role: "user",
          content: `SET: ${set.name}\n\nPERFORMANCE:\n${perf}\n\nGENERATED NOTES:\n${clip(full?.notes ?? "", 15000)}\n\nMATERIAL:\n${clip(set.material_text, 45000)}`,
        },
      ],
    );
    const at = new Date().toISOString();
    await sb.from("study_sets").update({ study_guide: guide, study_guide_at: at }).eq("id", set.id);
    await sb
      .from("study_activity")
      .insert({ user_id: context.userId, set_id: set.id, kind: "guide", count: 1 });
    return { guide, at };
  });

export const askCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        question: z.string().min(1).max(2000),
        history: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
          .max(10),
        setId: z.string().min(1).max(200).nullable(),
        today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        tzOffset: z.number().int().min(-900).max(900),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { act, summaries, history } = await coachData(
      context.supabase,
      data.setId,
      data.today,
      data.tzOffset,
    );
    const system = `You are Momentum Coach, a personal study planner (not a subject tutor — don't teach content; the separate AI Tutor does that). Today is ${data.today}.
Use the student's data below to give specific, prioritized recommendations. Prioritize upcoming exams and weak topics over studying everything equally. Recommend concrete actions with minutes, using the app's tools by name: "Review due Flashcards", "Active Recall (N questions)", "Adaptive Quiz", "Practice Exam", "Comprehensive Exam", "Study Guide — Weak Areas section", "Mistake Bank (review N mistakes)", "Audio Study", "Notes", "AI Tutor", "Ask Your Materials", "Lecture Mode". Recommend Audio Study when a student needs a guided explanation or has limited hands-on study time; recommend its Weak Topics mode only when weak-topic evidence exists. Concepts the student has missed repeatedly (Mistake Bank) get top priority. Name the study set and topic for each action. Keep it short: a brief sentence of reasoning, then a numbered plan. Test readiness is only an estimate — say so if you mention it. Use Markdown.

STREAK: current ${act.current} days, longest ${act.longest}, studied today: ${act.studiedToday ? "yes" : "no"}, days studied ${act.daysStudied}, sessions ${act.sessions}, flashcards reviewed ${act.flashcards}, quizzes ${act.quizzes}, exams ${act.exams}, active recall ${act.recall}.

RECENT HISTORY (newest first): ${history}

STUDY SETS:
${summaries.join("\n\n") || "No study sets yet — suggest creating one."}`;
    const reply = await aiText(system, [...data.history, { role: "user", content: data.question }]);
    return { reply };
  });

export const gradeShortAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        items: z
          .array(z.object({ question: z.string(), expected: z.string(), given: z.string() }))
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!data.items.length) return { grades: [] as { correct: boolean; feedback: string }[] };
    const text = await aiText(
      `You grade student short answers fairly, on meaning rather than exact wording. Accept answers that capture the key idea even if worded differently, with synonyms or minor spelling errors; mark correct when the answer is mostly right. Return ONLY JSON: {"grades":[{"correct":true,"feedback":"one short sentence"}]} in the same order.`,
      [{ role: "user", content: JSON.stringify(data.items) }],
    );
    const parsed = parseJson<{ grades?: { correct?: boolean; feedback?: string }[] }>(text);
    const grades = data.items.map((_, i) => ({
      correct: Boolean(parsed.grades?.[i]?.correct),
      feedback: String(parsed.grades?.[i]?.feedback ?? ""),
    }));
    return { grades };
  });

const EXPLAIN_MODES = {
  simple: "Explain this simply, as if to a curious 12-year-old. Short and clear.",
  university: "Explain this at a university level with precise terminology and depth.",
  example: "Give one or two concrete, memorable examples that illustrate this.",
  detail: "Explain this in more detail, covering the why and how step by step.",
  summary: "Summarize this in 3-5 concise bullet points.",
  analogy:
    "Explain this with one clear everyday analogy, then state exactly where the analogy breaks down.",
  compare:
    "Compare this with the most closely related concepts in the material (a short table or bullets: similarities, key differences, how to tell them apart).",
  mistakes:
    "List the 3-4 most common misconceptions or exam mistakes about this, each with the correct understanding.",
  practice:
    "Write ONE practice question on this with a single defensible answer. Show the question, then a line '---', then **Answer:** and a one-sentence explanation.",
} as const;

export const explainPassage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        passage: z.string().min(1).max(8000),
        mode: z.enum([
          "simple",
          "university",
          "example",
          "detail",
          "summary",
          "analogy",
          "compare",
          "mistakes",
          "practice",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const text = await aiText(
      `You help a student understand their study notes. ${EXPLAIN_MODES[data.mode]} Use the student's original material as context when relevant. Use Markdown. No preamble.${ci(set)}

ORIGINAL MATERIAL (context):
${clip(set.material_text, 30000)}`,
      [{ role: "user", content: `PASSAGE FROM MY NOTES:\n${data.passage}` }],
    );
    return { text };
  });

export type PlanDay = { date: string; title: string; tasks: string[] };

export const generatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minutesPerDay: z.number().int().min(10).max(600),
        weakTopics: z.array(z.string()).max(20),
        recent: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const days = Math.round((Date.parse(data.examDate) - Date.parse(data.today)) / 86400000);
    if (days < 0) throw new Error("The exam date is in the past.");
    const n = Math.min(days + 1, 30);
    const { data: acts } = await context.supabase
      .from("study_activity")
      .select("kind, count, created_at, set_id, score, total")
      .eq("set_id", set.id)
      .order("created_at", { ascending: false })
      .limit(200);
    const recent = acts?.length
      ? recentHistory(acts, [{ id: set.id, name: set.name }])
      : (data.recent ?? "");
    const planMistakes = mistakeLines(await openMistakes(context.supabase, set.id, 10));
    const text = await aiText(
      `You create simple, realistic study schedules. Return ONLY JSON: {"days":[{"date":"YYYY-MM-DD","title":"short focus","tasks":["task (~minutes)"]}]}
Make exactly ${n} consecutive days starting ${data.today}${days > 29 ? " (cover the first 30 days)" : `, ending on the exam day ${data.examDate}`}. Each day fits in ${data.minutesPerDay} minutes; 1-4 tasks per day with rough minutes.
Use the app's tools in tasks: "Notes", "Study Guide", "Mistake Bank", "Flashcards", "Active Recall", "Adaptive Quiz", "Quiz", "Practice Exam", "AI Tutor". Cover the material's topics in order, revisit weak topics more often${data.weakTopics.length ? ` (${data.weakTopics.join(", ")})` : ""}, ${planMistakes.length ? `schedule short "Mistake Bank" reviews for concepts the student keeps missing (${planMistakes.slice(0, 6).join(" | ")}), ` : ""}put a practice exam a few days before the exam and a light final review the day before / of the exam.${recent ? `\nRecent study history (adapt to it, don't repeat what was just done heavily): ${recent}` : ""}${ci(set)}`,
      [
        {
          role: "user",
          content: `Study set: ${set.name}\nMATERIAL:\n${clip(set.material_text, 30000)}`,
        },
      ],
    );
    const parsed = parseJson<{ days?: PlanDay[] }>(text);
    const plan = (parsed.days ?? [])
      .filter((d) => d?.date && d?.title)
      .map((d) => ({
        date: String(d.date),
        title: String(d.title),
        tasks: (d.tasks ?? []).map(String).slice(0, 6),
      }));
    if (!plan.length) throw new Error("Could not create a plan. Please try again.");
    await context.supabase
      .from("study_sets")
      .update({ plan, exam_date: data.examDate, minutes_per_day: data.minutesPerDay })
      .eq("id", set.id);
    return { plan };
  });

export const ocrFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        data: z.string().max(14_000_000),
        mediaType: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
        filename: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const file =
      data.mediaType === "application/pdf"
        ? {
            type: "file" as const,
            data: data.data,
            mediaType: data.mediaType,
            filename: data.filename,
          }
        : { type: "image" as const, image: data.data, mediaType: data.mediaType };
    const text = await aiText(
      "You are an OCR engine. Transcribe ALL readable text from the provided scanned document or photo of pages, in reading order. Preserve headings, lists and paragraphs. Describe diagrams or tables briefly in [brackets]. Output only the transcription, no commentary.",
      [
        {
          role: "user",
          content: [{ type: "text", text: `Transcribe this file: ${data.filename}` }, file],
        },
      ],
      { grounded: false },
    );
    return { text };
  });

const tutorSystem = (set: {
  name: string;
  subject: string;
  material_text: string;
}) => `You are a friendly, patient AI tutor for the study set "${set.name}" (${set.subject || "general"}).
Use the material below as your primary source. Explain clearly with simple language, examples, and step-by-step reasoning. Use Markdown.
If the answer isn't in the material, say so briefly and give general guidance.

MATERIAL:
${clip(set.material_text, 40000)}`;

export const askTutor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ setId: z.string().min(1).max(200), content: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const set = await loadSet(supabase, data.setId);
    const { data: userMsg, error: insErr } = await supabase
      .from("tutor_messages")
      .insert({ set_id: set.id, user_id: context.userId, role: "user", content: data.content })
      .select("id")
      .single();
    if (insErr) throw new Error("Couldn't save your message");
    const cleanup = () => supabase.from("tutor_messages").delete().eq("id", userMsg!.id);
    const { data: history } = await supabase
      .from("tutor_messages")
      .select("role, content")
      .eq("set_id", set.id)
      .order("created_at", { ascending: false })
      .limit(20);
    const messages = (history ?? [])
      .reverse()
      .map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));
    let reply: string;
    try {
      reply = await aiText(tutorSystem(set), messages);
    } catch (e) {
      await cleanup();
      throw e;
    }
    const { data: saved } = await supabase
      .from("tutor_messages")
      .insert({ set_id: set.id, user_id: context.userId, role: "assistant", content: reply })
      .select("id, role, content, created_at")
      .single();
    return { reply, message: saved };
  });

function recentHistory(
  rows: {
    kind: string;
    count: number;
    created_at: string;
    set_id: string | null;
    score: number | null;
    total: number | null;
  }[],
  sets: { id: string; name: string }[],
) {
  const names = new Map(sets.map((s) => [s.id, s.name]));
  const items: string[] = [];
  let last: string | null = null;
  for (const r of rows.slice(0, 200)) {
    if (r.kind === "flashcard") {
      const key = `${r.created_at.slice(0, 10)} flashcards ${r.set_id}`;
      if (key === last) continue;
      last = key;
    }
    items.push(
      `${r.created_at.slice(0, 10)} ${r.kind}${r.set_id ? ` (${names.get(r.set_id) ?? "set"})` : ""}${r.total ? ` ${r.score}/${r.total}` : ""}`,
    );
    if (items.length >= 15) break;
  }
  return items.join("; ") || "none";
}

async function coachData(sb: any, setId: string | null, today: string, tzOffset: number) {
  const data = { setId, today, tzOffset };

  const [
    { data: sets },
    { data: cards },
    { data: attempts },
    { data: activity },
    { data: allMistakes },
  ] = await Promise.all([
    sb
      .from("study_sets")
      .select(
        "id, name, subject, exam_date, minutes_per_day, plan, status, study_guide_at, custom_instructions",
      )
      .eq("status", "ready"),
    sb.from("flashcards").select("*"),
    sb.from("quiz_attempts").select("*"),
    sb
      .from("study_activity")
      .select("kind, count, created_at, set_id, score, total")
      .order("created_at", { ascending: false })
      .limit(2000),
    sb
      .from("mistakes")
      .select(
        "id, set_id, question, correct_answer, topic, wrong_count, right_streak, status, student_answer",
      )
      .order("wrong_count", { ascending: false })
      .limit(500),
  ]);
  const mOf = (id: string) => ((allMistakes ?? []) as MistakeRow[]).filter((m) => m.set_id === id);
  const act = activityStats(activity ?? [], data.tzOffset);
  const summaries = (sets ?? []).map((s: any) => {
    const st = setStats(
      ((cards ?? []) as Flashcard[]).filter((c) => c.set_id === s.id),
      ((attempts ?? []) as Attempt[]).filter((a) => a.set_id === s.id),
      mOf(s.id),
    );
    const openM = mOf(s.id).filter((m) => m.status !== "mastered");
    const todayPlan = ((s.plan as PlanDay[] | null) ?? []).find((p) => p.date === data.today);
    const last = (activity ?? []).find((a: any) => a.set_id === s.id)?.created_at;
    return [
      `### ${s.name}${s.id === data.setId ? " (currently open)" : ""}`,
      `Exam date: ${s.exam_date ?? "not set"}${s.exam_date ? ` (${Math.round((Date.parse(s.exam_date) - Date.parse(data.today)) / 86400000)} days away)` : ""}; minutes/day: ${s.minutes_per_day ?? "not set"}`,
      `Test readiness estimate: ${st.readiness ?? "n/a"}%; flashcards ${st.mastered}/${st.total} mastered, ${st.due} due today; quiz avg ${st.quizAvg ?? "n/a"}%; latest exam ${st.examLatest ?? "n/a"}%; active recall ${st.recallPct ?? "n/a"}%`,
      `Weak topics: ${st.weak.map((t) => `${t.topic} ${t.accuracy}%`).join(", ") || "none"}; improving: ${
        st.topics
          .filter((t) => t.status === "Improving")
          .map((t) => t.topic)
          .join(", ") || "none"
      }; strong: ${
        st.topics
          .filter((t) => t.status === "Strong")
          .map((t) => t.topic)
          .join(", ") || "none"
      }`,
      `Mistake Bank: ${openM.length} open (${openM.filter((m) => m.status === "review").length} need review, ${openM.filter((m) => m.status === "improving").length} improving); repeated misses: ${
        openM
          .filter((m) => m.wrong_count >= 2)
          .slice(0, 5)
          .map((m) => `[${m.topic}] ${m.question.slice(0, 90)} ×${m.wrong_count}`)
          .join("; ") || "none"
      }`,
      ...(s.custom_instructions?.trim()
        ? [`Student's instructions for this set: ${s.custom_instructions.trim().slice(0, 300)}`]
        : []),
      `Study guide: ${s.study_guide_at ? "generated" : "not generated"}; today's plan: ${todayPlan ? `${todayPlan.title} — ${todayPlan.tasks.join("; ")}` : "none"}; last studied: ${last ? last.slice(0, 10) : "never"}`,
    ].join("\n");
  });
  const current = setId ? (sets ?? []).find((s: { id: string }) => s.id === setId) : null;
  const currentStats = current
    ? setStats(
        ((cards ?? []) as Flashcard[]).filter((c) => c.set_id === setId),
        ((attempts ?? []) as Attempt[]).filter((a) => a.set_id === setId),
        mOf(setId!),
      )
    : null;
  return {
    act,
    summaries,
    history: recentHistory(activity ?? [], sets ?? []),
    current,
    currentStats,
  };
}

export type SessionStep = {
  kind: "flashcards" | "recall" | "adaptive" | "exam" | "guide" | "mistakes" | "audio";
  title: string;
  why: string;
  minutes: number;
  count: number;
  topics: string[];
  difficulty: "easy" | "medium" | "hard" | "mixed";
};

export const planSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        setId: z.string().min(1).max(200),
        minutes: z.number().int().min(10).max(120),
        today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        tzOffset: z.number().int().min(-900).max(900),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const {
      act,
      summaries,
      history,
      currentStats: st,
    } = await coachData(context.supabase, data.setId, data.today, data.tzOffset);
    const text = await aiText(
      `You are Momentum Coach building ONE focused study session for the set "${set.name}" lasting about ${data.minutes} minutes. Today is ${data.today}.
Decide what's most useful from the data. Guidelines: if flashcards are due, start with "flashcards"; weak topics → "recall" on those topics; a topic missed repeatedly → "guide" (read its Weak Areas / explanation) followed by "recall" on it; exam within ~7 days → include an "exam" step (short practice exam); use "audio" when a guided explanation would help, especially for difficult or connected concepts; doing well (readiness ≥ 75) → harder difficulty and exam-style practice; 15 minutes → 1-2 short focused steps; 30 → 2-3 steps; 60+ → 3-5 mixed steps. "adaptive" = adaptive quiz. "mistakes" = retry questions from the Mistake Bank — include it early whenever the set has mistakes that need review, especially repeated ones. Step minutes should add up to roughly ${data.minutes}.
Counts: mistakes = how many to retry (3-10, ≤ open mistakes), flashcards = max cards to review (≤ due count when due), recall = questions (3-10), adaptive = questions (5-15), exam = questions (10-20), guide = 0.
Return ONLY JSON: {"headline":"one sentence","reason":"1-2 sentences naming the exam timing and weakest topics, e.g. 'You have a Biology test in 3 days. Your weakest areas are X and Y, so most of today is on those.'","steps":[{"kind":"mistakes|flashcards|recall|adaptive|exam|guide|audio","title":"short","why":"short","minutes":10,"count":10,"topics":["exact weak topic names"],"difficulty":"easy|medium|hard|mixed"}]}${ci(set)}

STREAK: current ${act.current}, studied today: ${act.studiedToday ? "yes" : "no"}
RECENT HISTORY: ${history}
DATA:
${summaries.join("\n\n")}`,
      [{ role: "user", content: `Plan my ${data.minutes}-minute session.` }],
    );
    const p = parseJson<{ headline?: string; reason?: string; steps?: Partial<SessionStep>[] }>(
      text,
    );
    const kinds = [
      "flashcards",
      "recall",
      "adaptive",
      "exam",
      "guide",
      "mistakes",
      "audio",
    ] as const;
    const diffs = ["easy", "medium", "hard", "mixed"] as const;
    let steps: SessionStep[] = (p.steps ?? [])
      .filter((x) => kinds.includes(x?.kind as never))
      .map((x) => ({
        kind: x.kind as SessionStep["kind"],
        title: String(x.title ?? x.kind),
        why: String(x.why ?? ""),
        minutes: Math.max(1, Math.min(90, Number(x.minutes) || 5)),
        count: Math.max(0, Math.min(30, Math.round(Number(x.count) || 0))),
        topics: Array.isArray(x.topics) ? x.topics.map(String).slice(0, 6) : [],
        difficulty: diffs.find((d) => d === x.difficulty) ?? "mixed",
      }))
      .filter((x) => !(x.kind === "flashcards" && (st?.due ?? 0) === 0))
      .filter((x) => !(x.kind === "mistakes" && (st?.openMistakes ?? 0) === 0))
      .slice(0, 6);
    if (!steps.length) {
      const weak = st?.weak.map((t) => t.topic).slice(0, 3) ?? [];
      steps = [
        ...((st?.openMistakes ?? 0) > 0
          ? [
              {
                kind: "mistakes" as const,
                title: "Fix past mistakes",
                why: "Concepts you got wrong before",
                minutes: 5,
                count: Math.min(5, st!.openMistakes),
                topics: [],
                difficulty: "mixed" as const,
              },
            ]
          : []),
        ...((st?.due ?? 0) > 0
          ? [
              {
                kind: "flashcards" as const,
                title: "Due flashcards",
                why: "Cards are due today",
                minutes: 5,
                count: Math.min(20, st!.due),
                topics: [],
                difficulty: "mixed" as const,
              },
            ]
          : []),
        {
          kind: "recall",
          title: "Active Recall",
          why: "Strengthen memory",
          minutes: 10,
          count: 5,
          topics: weak,
          difficulty: "mixed",
        },
        {
          kind: "adaptive",
          title: "Adaptive Quiz",
          why: "Check progress",
          minutes: 10,
          count: 10,
          topics: weak,
          difficulty: "mixed",
        },
      ];
    }
    return {
      headline: String(p.headline ?? "Here's what Momentum thinks you should work on."),
      reason: String(p.reason ?? ""),
      steps,
    };
  });

// ---------- Mistake Bank ----------
async function loadMistake(sb: any, id: string) {
  const { data, error } = await sb.from("mistakes").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Mistake not found");
  return data as {
    id: string;
    set_id: string;
    question: string;
    student_answer: string;
    correct_answer: string;
    explanation: string;
    topic: string;
    question_data: { options?: string[] } | null;
  };
}

export const explainMistake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mistakeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await loadMistake(context.supabase, data.mistakeId);
    const set = await loadSet(context.supabase, m.set_id);
    const text = await aiText(
      `You help a student understand a question they got wrong. Using the material as the source, explain in Markdown: **Why the correct answer is right** (say where in the material), **Why your answer was off** (be kind and specific; if their answer was empty, skip this), **Why the other choices are wrong** (only if it was multiple choice), **What this tests** (the concept), **Remember for next time** (a short memory hook). Keep it under 250 words. Don't invent facts not in the material; label any extra background "(Additional context)".${ci(set)}\nMATERIAL:\n${clip(set.material_text, 30000)}`,
      [
        {
          role: "user",
          content: `TOPIC: ${m.topic}\nQUESTION: ${m.question}${m.question_data?.options?.length ? `\nOPTIONS: ${m.question_data.options.join(" | ")}` : ""}\nMY ANSWER: ${m.student_answer}\nCORRECT ANSWER: ${m.correct_answer}\nEXPLANATION GIVEN: ${m.explanation}`,
        },
      ],
    );
    return { text };
  });

export const similarQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ mistakeId: z.string().uuid(), count: z.number().int().min(1).max(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const m = await loadMistake(context.supabase, data.mistakeId);
    const set = await loadSet(context.supabase, m.set_id);
    const questions = await makeQuestions(
      set,
      {
        count: data.count,
        difficulty: "mixed",
        types: ["mc", "short"],
        avoid: [m.question],
        retest: [`${m.question} (correct answer: ${m.correct_answer})`],
        plan: [{ topic: m.topic, count: data.count }],
      },
      40000,
    );
    if (!questions.length) throw new Error("Couldn't write similar questions. Please try again.");
    return {
      questions: questions.map((q) => ({ ...q, question: q.question })),
      focus: `Practice the same concept as: "${m.question}" (correct answer: ${m.correct_answer})`,
    };
  });

/** Finds patterns across a set's open mistakes (misconceptions, question types, topics). */
export const mistakePatterns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ setId: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const set = await loadSet(context.supabase, data.setId);
    const { data: rows } = await context.supabase
      .from("mistakes")
      .select("question, student_answer, correct_answer, topic, wrong_count, source_kind")
      .eq("set_id", data.setId)
      .neq("status", "mastered")
      .order("wrong_count", { ascending: false })
      .limit(40);
    if (!rows?.length) return { text: "No open mistakes to analyze yet." };
    const list = rows
      .map(
        (r, i) =>
          `${i + 1}. [${r.topic}] (${r.wrong_count}x, ${r.source_kind}) Q: ${r.question.slice(0, 300)} | MY ANSWER: ${(r.student_answer || "(blank)").slice(0, 200)} | CORRECT: ${r.correct_answer.slice(0, 200)}`,
      )
      .join("\n");
    const text = await aiText(
      `You analyze a student's wrong answers to find PATTERNS, not to re-explain each question. Markdown, under 250 words, with bold headings:
**Patterns I see** — 2-4 bullets; each names the pattern (e.g. confusing two specific terms, misreading "NOT" questions, weak on a topic) and cites question numbers.
**What's really going on** — the underlying misconception in 1-2 sentences, using the material's terminology.
**Fix it** — 3 concrete actions in Momentum (e.g. Active Recall on X, flashcards on Y, re-read section Z).
Only claim patterns the evidence supports; with few mistakes, say the evidence is limited.${ci(set)}
MATERIAL:\n${clip(set.material_text, 20000)}`,
      [{ role: "user", content: `MY OPEN MISTAKES:\n${list}` }],
    );
    return { text };
  });
