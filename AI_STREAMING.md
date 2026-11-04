# Momentum AI streaming architecture

## Provider transport

- NVIDIA text generation is performed server-side with `stream: true` and consumed as SSE by `aiText()` or forwarded to the browser through `/api/ai-stream`.
- The NVIDIA API key remains server-only. Browser streams require a valid Supabase access token; the route verifies it before forwarding the request.
- Browser callers use `streamAiText()` for prose and `streamAiJson<T>()` for structured output. Structured output is parsed and feature-validated before the result is saved or used.
- SSE readers preserve token whitespace, support LF/CRLF event framing and final buffered events, propagate provider errors, reject incomplete streams, and clean up readers on cancellation.

## Browser-streamed workflows

The following user-facing workflows now prepare their prompts on the server, stream NVIDIA output in the browser, then use authenticated server finalizers where persistence is required:

- AI Tutor, Momentum Coach, Ask Your Materials, Reading Companion Q&A, Audio Study Q&A, Explain Why, and Universal Search.
- Notes section explanations and mistake explanations/pattern analysis.
- Flashcard regeneration and Reading Companion flashcard generation.
- Active Recall question generation, hints, and grading.
- Short-answer grading in quizzes and the Mistake Bank.
- Study Guide generation, study-plan generation, Study Everything session planning, and concept-connection maps.
- Lecture notes, lecture study guides, and lecture flashcards.
- Reading Companion summaries and reading-to-notes additions.
- Audio Study lesson script generation, section quiz generation, and quiz grading.
- Assignment Helper understand/brainstorm/outline/feedback steps and essay grading.
- Regular quiz generation and comprehensive exam generation stream an initial validated batch per set in the browser; server-side validation, chunked top-ups, and large-batch orchestration remain on the server.
- Initial Study Set processing streams notes (including sequential long-source chunks) and structured flashcards in the browser when no optional-reading enrichment is present. Optional-reading enrichment uses the server-managed chunk pipeline.
- Notes regeneration streams in the browser for single- and multi-chunk sources when there is no optional-reading enrichment. Optional-reading enrichment uses the server-managed chunk pipeline to preserve lecture-first integration order.

## Server-managed multi-stage workflows

Some workflows deliberately remain server-orchestrated because they coordinate multiple model calls, large source chunks, validation/retry loops, idempotency, and atomic database updates:

- Initial Study Set processing (`processSet`) with optional-reading enrichment generates notes and cards server-side before replacing existing content.
- Optional-reading Notes regeneration and initial-set enrichment.
- Remaining quiz/exam batch top-ups and server-side quiz review/validation.

These paths still use the shared NVIDIA SSE transport; they do not use the old non-streaming NVIDIA chat-completions response path. Their UI may show task progress rather than individual provider tokens.

## Structured output and persistence

- Browser JSON output is handled with `streamAiJson<T>()` and feature-specific validation.
- Server finalizers re-check ownership and validate payload shape before database writes.
- Flashcard replacement archives old rows before deletion; reading and lecture flashcard additions preserve existing cards and filter duplicates.
- Essay grading, assignment assistance, study plans, audio lesson scripts, lecture notes/guides, and reading additions retain their server-side persistence paths.

## Cancellation and errors

- Browser text streams accept `AbortSignal`; cancellation closes the reader and is not reported as a provider failure.
- Failed or malformed structured output is rejected before finalization.
- Server-managed generation keeps the existing model fallback/retry and error recovery behavior.

## Verification

- All 171 TypeScript/TSX source files were syntax-transpiled successfully with the installed TypeScript compiler API.
- Full dependency installation timed out in this environment. Consequently, project typecheck, ESLint, Vitest, and production build could not be run here.
- No live NVIDIA or Supabase credentials were available for end-to-end provider/auth/database tests.
