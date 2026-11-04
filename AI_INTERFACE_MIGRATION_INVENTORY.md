# Momentum one-pass AI integration inventory

## Original review baseline

The original review identified 39 remaining direct server-side AI call sites. The migration now routes all feature-level model generation through the authenticated browser SSE endpoint. Server functions retain source loading, prompt preparation, deterministic validation, ownership checks, and database persistence; obsolete non-streaming compatibility generation endpoints were removed.

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
| Mistake Bank similar-question practice | Migrated | Server prepares source-grounded prompt; browser streams and validates all three questions |
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
| Regular quiz / practice exam | Fully browser-streamed in batches of up to five | Browser requests successive prompts for every source chunk, streams every batch and the AI review, and submits the complete structured result; server performs schema/uniqueness/count checks and returns the finalized questions |
| Comprehensive exam | Fully browser-streamed in batches of up to five per source set | Browser streams every batch for every source chunk in every selected set; server enforces per-set and overall requested counts |
| Initial Study Set processing | Fully browser-streamed, including optional readings | Browser streams lecture chunks, reading-enrichment chunks, final integration, and flashcards; server retains archive-before-replace persistence |
| Notes regeneration | Fully browser-streamed, including optional readings | Browser streams lecture chunks, reading-enrichment chunks, and final integration; server retains note archival and persistence |

## Server-managed responsibilities retained intentionally

- Source loading and user-owned material retrieval.
- Prompt construction and source scoping.
- Deterministic response-schema, uniqueness, and count validation.
- Authenticated persistence, archival, idempotency, and activity updates.

These are not model-generation fallbacks. All feature-level model generation streams through the authenticated browser SSE endpoint. Obsolete direct-generation compatibility handlers were removed so UI workflows cannot silently fall back to server-side generation.

## Transport and correctness work

- `aiText()` uses NVIDIA SSE (`stream: true`) and preserves whitespace across delta frames.
- `/api/ai-stream` verifies Supabase authentication before proxying provider SSE. NVIDIA credentials are never sent to the browser.
- `streamAiText()` supports cancellation and forwards incremental text.
- `streamAiJson<T>()` parses completed streamed JSON and runs feature-specific validation before data is accepted.
- The 39 original direct feature-level `aiText()` call sites are no longer invoked by feature handlers; `aiText()` remains only as a tested shared server transport utility, not as a feature-generation fallback.
- Persistent writes remain authenticated server operations; user-owned source data is loaded server-side.
- Flashcard replacement archives prior cards before deleting them. Additive lecture/reading card workflows preserve existing cards and remove duplicates.

## Verification

- All 171 TypeScript/TSX files passed syntax transpilation with the installed TypeScript compiler API.
- Mocked SSE checks confirmed whitespace-preserving provider aggregation, rejection of incomplete provider streams, browser text delta delivery, and structured JSON parsing/validation.
- Dependency installation timed out in this environment. Full `tsc`, ESLint, Vitest, and production build checks could not be run.
- Live NVIDIA, Supabase auth, database writes, cancellation, rate limits, and deployment runtime behavior still require end-to-end testing with the project's real environment variables.
