# Momentum Engineering Audit — 2026-10-20

## Scope

Audited the supplied project archive (`project/`), including 171 TypeScript/TSX files, package/build configuration, environment templates, server routes, Supabase client/auth boundaries, and the existing 10 test files. This pass prioritizes the reported Vercel deployment failure, removal of the Lovable runtime/build dependency, and provider consistency with NVIDIA NIM.

## Changes made

1. **Vercel function discovery:** Removed the invalid `functions.src/server.ts` override. TanStack Start + Nitro generates the deployable function structure; the source server entry is not itself a Vercel function glob. `vercel.json` now declares the TanStack Start framework only.
2. **Build configuration independent of Lovable:** Replaced `@lovable.dev/vite-tanstack-config` with explicit TanStack Start, Nitro, React, Tailwind, and TS path plugins. Kept the existing custom SSR error wrapper as the server entry.
3. **Removed Lovable dependencies and editor-only hooks:** Removed Lovable auth package, Lovable Vite config package, Lovable preview-session bridge, Lovable editor telemetry hook, unused Lovable auth helper, and `.lovable` metadata. Supabase auth falls back to its normal browser storage behavior outside the removed preview bridge.
4. **NVIDIA NIM transcription:** Replaced the Lovable AI Gateway transcription route with NVIDIA's hosted Parakeet ASR endpoint. The route verifies the Supabase bearer token, enforces a 4 MiB WAV segment limit sized below Vercel request-body limits, checks the WAV container header, applies a timeout, handles upstream failures without leaking provider internals, and preserves the recorder's existing SSE event contract. `NVIDIA_ASR_ENDPOINT` can override the default hosted endpoint.
5. **Environment/docs cleanup:** Removed Lovable environment references, documented NVIDIA NIM and Deepgram's existing Audio Study TTS role, added server-only service-role/database variables to the example template, and changed the Drizzle migration connection variable to `DATABASE_URL`.
6. **Type-check command:** Added `npm run typecheck` (`tsc --noEmit`) so type validation is available separately from Vite's transpile/build.

## Checks completed

- TypeScript/TSX syntax transpilation: **171 files, 0 syntax errors**.
- `package.json` and `vercel.json`: valid JSON.
- `bun.lock`: valid JSON-with-trailing-commas structure after the Lovable package entries were removed.
- Relative import scan: no missing source imports; one CSS `?url` import was correctly outside the script's TypeScript file resolver.
- Repository scan: **0 Lovable references** remain in application source, build configuration, package manifests, environment templates, and README. The audit report itself names the removed integration for change-history clarity.
- Existing test inventory: 10 test files present.

## Checks not completed

Dependency installation repeatedly timed out in this environment. As a result, I could not honestly claim the following passed:

- `npm run typecheck`
- `npm run test`
- `npm run lint`
- `npm run build`
- live Vercel deployment, Supabase RLS/migration validation, and live NVIDIA API requests

## Deployment notes

- Set `NVIDIA_API_KEY` as a server-side Vercel environment variable. The same key must have access to the selected NVIDIA chat model and the hosted speech endpoint.
- `NVIDIA_ASR_ENDPOINT` defaults to NVIDIA's hosted Parakeet ASR endpoint. NVIDIA may require the model endpoint to be enabled/accepted for the account; if it is not accessible, configure an endpoint enabled for that account.
- Keep `NIM_MODEL` server-side. Do not prefix provider secrets with `VITE_`.
- `DEEPGRAM_API_KEY` remains required only for the existing Audio Study text-to-speech feature; it is not used for chat generation or lecture transcription in this version.
- Apply the database migrations documented in `README.md` to the intended Supabase project before relying on features that require them.

## Remaining risk / honest status

This is a static audit plus targeted fixes, not a production certification. Because dependencies and live credentials were unavailable, the full suite and integration paths remain unverified. In particular, test lecture transcription against the configured NVIDIA ASR endpoint and run the full feature smoke test after deployment. The app should not be described as guaranteed never to fail.

## Lecture-image understanding enhancement (2026-10-20)

- Added a separate `NIM_VISION_MODEL` setting, defaulting to `meta/llama-3.2-90b-vision-instruct`, so image understanding does not replace the existing `NIM_MODEL` used for text generation. NVIDIA documents this model as accepting text and images through the OpenAI-compatible chat-completions endpoint.
- Corrected image payloads to the NVIDIA-compatible `image_url` content-part format.
- PDF pages are rendered in the browser and passed as JPEGs to the vision model. Searchable PDFs receive a visual-analysis pass even when text extraction succeeds; scanned PDFs use page-image OCR with visual explanation. Visual/OCR processing is capped at 20 pages per PDF, and the material includes a note if later pages were not image-analyzed.
- PowerPoint extraction now follows slide image relationships and analyzes up to 12 embedded raster images per file, grounding each description in that slide's text. Unsupported vector image formats are skipped rather than mislabeled.
- Standalone image uploads receive OCR plus diagram/chart explanation. When multiple files are uploaded together, text/PDF/PowerPoint files are processed before standalone images so image descriptions can use earlier lecture text as context.
- The note-generation prompt explicitly preserves visual explanations, ties them to the relevant topic when supported, and tells the model not to invent unreadable labels or unsupported relationships.
- Validation limitation: the dependency install still timed out, so browser PDF rendering and live NVIDIA vision calls have not been integration-tested in this environment. Verify with a searchable PDF, a scanned PDF, a PowerPoint with a labelled diagram, and a standalone image after configuring `NIM_VISION_MODEL` access in NVIDIA NIM.


## 2026-10-20 — Course-aware notes, visual attachments, and question quality update

- Added a separate private-storage pipeline for relevant lecture visual images extracted from PowerPoint slides, searchable/scanned PDF pages, Word documents, and standalone image uploads. Images are stored as `study_files` records and shown in the Notes screen with a signed URL and the matching extracted visual explanation when a page/slide marker is available. Base64 image data is not placed into `material_text` or AI text prompts.
- Added a bounded visual capture policy: up to 12 visual assets per upload batch; up to 8 visual pages for PDFs and up to 8 embedded raster images for Word documents. PowerPoint image analysis remains capped by the existing per-file limits. Unsupported vector formats are skipped rather than mislabeled as PNG.
- Clarified the study-set metadata field as **Course / subject** and use the saved subject plus study-set/lecture name in note, flashcard, quiz, and exam prompts. Course context calibrates terminology/depth but does not override the source material.
- Updated multi-source Study Guide instructions to organize by prerequisite/topic dependency and interleave related concepts across selected lectures rather than summarizing each source in isolated blocks. The prompt requires source-set attribution and existing slide/page markers and forbids inventing markers.
- Tightened flashcard prompts and added local near-duplicate filtering to reduce repeated or low-value cards.
- Added near-duplicate filtering to quiz question batches and kept large practice exams within serverless time limits while strengthening their source-grounded prompt, structural checks, local near-duplicate filtering, and cross-lecture avoidance; quiz batches still receive the separate AI review step. Comprehensive exams are generated sequentially so later study sets can avoid questions already generated from earlier sets.
- Verification performed for this update: TypeScript/TSX syntax transpilation passed for all eight changed source/test files; three near-duplicate unit-test cases were also executed directly against the compiled helper and passed. A Vitest run was not possible. Full type-check, lint, unit tests, production build, live NVIDIA NIM vision calls, Supabase storage/RLS, and Vercel deployment remain unverified because dependency installation timed out in this environment.
