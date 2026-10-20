# Momentum static reliability audit (v4 input ZIP)

Date: 2026-10-20

## Scope and limits

Reviewed the provided project ZIP statically, including all 170 TypeScript/TSX source files, AI request/parsing paths, comprehensive exam batching, package scripts, Vercel configuration, and existing tests. The environment has no `node_modules`, so a full Vite production build, ESLint run, Vitest suite, browser flows, live Supabase/RLS checks, and real NVIDIA NIM calls could not be executed. This is not a claim that every feature can never fail; live integration behavior requires a configured deployment and data.

## High-impact issues addressed

1. **Comprehensive exam generation could fail because of the secondary AI reviewer.** A draft could be structurally valid, but if the separate reviewer repeatedly returned malformed JSON, the whole source-set batch was discarded. Comprehensive exams now skip that extra reviewer call: the generation prompt still includes grounding/quality rules and every question still passes local schema checks. Regular quiz generation retains AI review, but falls back to the structurally valid draft if the reviewer is unavailable after retries.
2. **AI parsing could stop at an irrelevant bracketed phrase.** The JSON parser now scans subsequent candidate roots, tolerates fences/prose, and reports malformed/truncated output more clearly.
3. **Nested retry/timeout behavior could cause long serverless requests.** AI calls now accept bounded timeout/retry options. Exam generation and question review use a 20-second per-call timeout with no internal retry, leaving retry decisions to the bounded generation/review loops rather than multiplying retries invisibly.
4. **Exam failures needed diagnostics.** Comprehensive exam paths log the affected set, requested count, elapsed time, and error details. The UI has the prior improvement for extracting messages from serialized server-function errors.

## Checks performed

- TypeScript/TSX transpilation syntax check: 174 files, zero syntax errors.
- Focused runtime checks for JSON parsing/chunking: passed (fenced JSON, prose, nested objects/braces inside strings, bracketed label before JSON, malformed JSON rejection, bounded chunks, blank input).
- ZIP integrity check: passed after packaging.

## Not verified

- `bun run build`, `bun run test`, and `bun run lint` (dependencies are not installed in this environment).
- Type-level checking across all third-party library declarations.
- Live AI-provider compatibility, token limits, rate limits, or response quality.
- Supabase database schema, row-level security, migrations, deployment environment variables, or end-to-end feature workflows.

## Recommended validation after extracting

Run `bun install`, `bun run build`, `bun run test`, and `bun run lint`. Then exercise: 30-, 40-, and 60-question comprehensive exams with 2, 5, and 10 source sets; source sets with short, long, blank, and PDF-extracted text; generation while the AI provider returns 429/5xx/timeouts; flashcard review save/cloud-sync failure; manual tier changes; reading-to-notes implementation; and authenticated/unauthenticated access to server functions. Inspect server logs for `[comprehensive-exam]` messages if an exam fails.
