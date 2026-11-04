# One-pass AI streaming migration completion report

## Result

All 39 direct feature-level server `aiText()` call sites from the original migration inventory have been removed or replaced with browser-streamed generation. Feature handlers no longer call `aiText()`; the shared server transport remains in `ai.server.ts` for isolated transport tests and maintenance only.

## Original 39-call-site accounting

| Source module | Original direct call sites | Completion action |
|---|---:|---|
| `ask.functions.ts` | 1 | Removed the obsolete one-shot Ask Your Materials endpoint. The active UI uses authenticated prepare, browser stream, and reply-save functions. |
| `explain.functions.ts` | 2 | Removed one-shot Explain Why and Search endpoints. The active UI uses authenticated prompt preparation and browser streaming. |
| `study.functions.ts` | 21 | Removed obsolete one-shot recall, coach, grading, passage explanation, concept-map, tutor, mistake, and similar-question endpoints; moved similar-question practice to a browser stream; removed server-side notes/cards/quiz generation fallbacks; converted quiz/exam generation and review to browser-streamed batches; required streamed outputs for guide and plan finalizers. |
| `audio-study.functions.ts` | 3 | Removed one-shot lesson, Q&A, and quiz generation endpoints. Active audio lesson, Q&A, and quiz flows use prepare/stream/save. Speech synthesis remains a separate server-side TTS operation. |
| `writing.functions.ts` | 5 | Removed server-side generation fallback branches. Assignment steps and essay grading now require browser-streamed text before persistence. |
| `lecture.functions.ts` | 3 | Removed one-shot lecture notes, cards, and guide endpoints. Active workflows use prepare/stream/save. |
| `reading.functions.ts` | 4 | Removed one-shot summary, notes-enrichment, Q&A, and card generation endpoints. Active workflows use prepare/stream/apply/save. |
| **Total** | **39** | **All accounted for** |

## Formerly partial workflows completed

- Regular quizzes/practice exams: browser streams every batch of up to five questions across the source's 22k-character chunks, then streams the AI review; the authenticated server finalizer checks the final schema and requested count.
- Comprehensive exams: browser streams every batch of up to five questions across every source chunk in every selected Study Set; the server verifies per-set and total counts.
- Initial Study Set processing: browser streams primary lecture notes, optional-reading enrichment, final integration, and flashcards before authenticated persistence.
- Notes regeneration: browser streams primary lecture notes, optional-reading enrichment, and final integration before archiving and saving the new notes.
- Mistake Bank similar-question practice: prompt preparation is server-side; question generation and feature validation run in the browser.

## Security and persistence

- NVIDIA credentials remain server-only; browser requests use the authenticated `/api/ai-stream` proxy.
- User-owned source data is loaded server-side after Supabase authentication.
- Finalizers retain ownership checks, validation, archival, idempotency, and database writes.
- Flashcard replacement still archives old cards before deletion; additive workflows retain duplicate filtering.
- Finalizers reject missing browser-generated payloads instead of silently falling back to server generation.

## Verification performed

- All 171 TypeScript/TSX source files passed TypeScript compiler-API syntax transpilation with zero syntax diagnostics.
- Repository scan found no feature-level `aiText()` invocations; only the shared helper definition and its isolated tests remain.
- Repository scan found no references to the removed one-shot generation endpoints.
- ZIP archive integrity is checked when the final deliverable is packaged.

## Environment limitation

Project dependencies are not installed in this working environment. `tsc --noEmit` stops because `vite/client` and `vitest/globals` type packages are unavailable. ESLint, Vitest, and the production build were therefore not run here. The user requested to handle building locally; this archive is source-only and no build was performed.
