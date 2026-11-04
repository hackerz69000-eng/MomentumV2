# Momentum one-pass AI integration inventory

## Original review baseline

The original review identified 39 server-side AI call sites after the shared SSE transport and browser streaming helpers were introduced. Those call sites were then reviewed by workflow rather than mechanically replaced: several are multi-stage server pipelines whose source chunking, validation, idempotency, or persistence must remain server-owned.

## Browser-streamed user-facing workflows

| Workflow | Browser streaming | Persistence / validation |
|---|---|---|
| AI Tutor | Existing | Authenticated server finalizer |
| Momentum Coach | Existing | Server-loaded study context |
| Ask Your Materials | Existing | Authenticated history persistence |
| Reading Companion Q&A | Existing | Authenticated history persistence |
| Audio Study Q&A | Existing | Authenticated history persistence |
| Explain Why | Existing | Server-loaded source context |
| Universal Search | Existing | Server-loaded source context |
| Notes passage explanations | Migrated | Server-prepared source prompt |
| Mistake explanation and pattern analysis | Migrated | Server-prepared mistake and set context |
| Flashcard regeneration | Migrated | Server archives old cards, then replaces them |
| Reading Companion summary | Migrated | Server gathers and labels source material |
| Reading-to-notes additions | Migrated | Server prepares reading chunks; user reviews before applying |
| Reading flashcards | Migrated | Structured JSON validation and server save |
| Active Recall questions | Migrated | Structured JSON validation |
| Active Recall hint | Migrated | Server-prepared source prompt |
| Active Recall grading | Migrated | Structured JSON validation; existing attempt/mistake persistence retained |
| Quiz short-answer grading | Migrated | Structured JSON validation; existing attempt persistence retained |
| Mistake Bank short-answer checks | Migrated | Structured JSON validation; existing mistake state retained |
| Study Guide | Migrated | Server finalizer saves guide and activity |
| Calendar study plan | Migrated | Server validates and returns plan |
| Study Everything session plan | Migrated | Server validates and returns steps |
| Concept connections | Migrated | Server prepares study material; client validates graph references |
| Lecture notes | Migrated | Server finalizer saves notes |
| Lecture study guide | Migrated | Server finalizer saves guide and activity |
| Lecture flashcards | Migrated | Structured JSON validation and additive save |
| Audio Study lesson script | Migrated | Server creates session, validates and saves script |
| Audio Study section quiz | Migrated | Structured JSON validation and event persistence |
| Audio Study quiz grading | Migrated | Structured JSON validation; existing attempt persistence retained |
| Assignment Helper understand / brainstorm / outline / feedback | Migrated | Server loads assignment and persists each step |
| Essay grading | Migrated | Server loads essay/material, validates result, and persists grade |
| Regular quiz / practice exam | Migrated initial batch | Browser streams first batch; server performs review, chunked top-ups, and final validation |
| Comprehensive exam | Migrated initial batch per source set | Browser streams first batch per set; server completes remaining batches and validates count |
| Initial Study Set processing | Migrated for single- and multi-chunk sources without optional readings | Optional-reading enrichment uses server-managed chunk pipeline; archive-before-replace persistence retained |
| Notes regeneration | Migrated for single- and multi-chunk sources without optional readings | Optional-reading enrichment uses server-managed chunk pipeline |

## Server-managed pipelines retained intentionally

These are not silent non-streaming fallbacks. They use the shared NVIDIA SSE transport (`stream: true`) but do not expose each internal model delta directly to the browser because they coordinate multiple dependent calls and persistence steps:

- Initial Study Set processing (`processSet`) with optional-reading enrichment: multi-stage notes and structured flashcard generation, with existing set-status and persistence behavior.
- Optional-reading Notes regeneration: lecture-first chunk generation, reading comparison, and final integration.
- Quiz/exam validation and top-ups after the browser-streamed initial batch.

The legacy exported server handlers remain available for compatibility, but the migrated UI components use the prepare/stream/finalize functions documented above.

## Transport and correctness work

- `aiText()` uses NVIDIA SSE (`stream: true`) and preserves whitespace across delta frames.
- `/api/ai-stream` verifies Supabase authentication before proxying provider SSE. NVIDIA credentials are never sent to the browser.
- `streamAiText()` supports cancellation and forwards incremental text.
- `streamAiJson<T>()` parses completed streamed JSON and runs feature-specific validation before data is accepted.
- Persistent writes remain authenticated server operations; user-owned source data is loaded server-side.
- Flashcard replacement archives prior cards before deleting them. Additive lecture/reading card workflows preserve existing cards and remove duplicates.

## Verification

- All 171 TypeScript/TSX files passed syntax transpilation with the installed TypeScript compiler API.
- Mocked SSE checks confirmed whitespace-preserving provider aggregation, rejection of incomplete provider streams, browser text delta delivery, and structured JSON parsing/validation.
- Dependency installation timed out in this environment. Full `tsc`, ESLint, Vitest, and production build checks could not be run.
- Live NVIDIA, Supabase auth, database writes, cancellation, rate limits, and deployment runtime behavior still require end-to-end testing with the project's real environment variables.
