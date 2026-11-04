# Momentum AI streaming architecture

## Provider transport

- Feature-level NVIDIA text generation is streamed to the browser through the authenticated `/api/ai-stream` proxy. The shared server-side `aiText()` transport remains covered by isolated transport tests but is not called by feature handlers.
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
- Regular quiz generation and comprehensive exam generation stream every batch in the browser across the source material's chunks. The browser requests successive batches of up to five questions, streams the regular quiz review, and authenticated finalizers enforce exact requested counts and schema constraints.
- Initial Study Set processing streams notes, sequential lecture chunks, optional-reading enrichment chunks, final lecture-first integration, and structured flashcards in the browser.
- Notes regeneration streams lecture chunks, optional-reading enrichment chunks, and final lecture-first integration in the browser before authenticated archival and save.

## Server-managed responsibilities

The server remains responsible for authenticated source retrieval, prompt construction, ownership checks, deterministic payload validation, archival, idempotency, and database writes. Model-generation stages for feature workflows are streamed to the browser through `/api/ai-stream`. Obsolete direct-generation compatibility endpoints were removed, and feature modules no longer invoke `aiText()` as a fallback.

## Structured output and persistence

- Browser JSON output is handled with `streamAiJson<T>()` and feature-specific validation.
- Server finalizers re-check ownership and validate payload shape before database writes.
- Flashcard replacement archives old rows before deletion; reading and lecture flashcard additions preserve existing cards and filter duplicates.
- Essay grading, assignment assistance, study plans, audio lesson scripts, lecture notes/guides, and reading additions retain their server-side persistence paths.

## Cancellation and errors

- Browser text streams accept `AbortSignal`; cancellation closes the reader and is not reported as a provider failure.
- Failed or malformed structured output is rejected before finalization.
- Provider failures are returned to the browser stream and surfaced by the feature UI; finalizers do not silently regenerate content server-side.

## Verification

- All 171 TypeScript/TSX source files were syntax-transpiled successfully with the installed TypeScript compiler API; no feature module contains a direct `aiText()` invocation.
- Full dependency installation timed out in this environment. Consequently, project typecheck, ESLint, Vitest, and production build could not be run here.
- No live NVIDIA or Supabase credentials were available for end-to-end provider/auth/database tests.
