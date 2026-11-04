# Momentum Engineering Audit — 2026-10-20

## Scope

Audited the supplied project archive (`project/`), including 171 TypeScript/TSX files, package/build configuration, environment templates, server routes, Supabase client/auth boundaries, and the existing 10 test files. This pass prioritizes the reported Vercel deployment failure, removal of the Lovable runtime/build dependency, and provider consistency with NVIDIA NIM.

## Changes made

1. **Vercel function discovery:** Removed the invalid `functions.src/server.ts` override. TanStack Start + Nitro generates the deployable function structure; the source server entry is not itself a Vercel function glob. `vercel.json` now declares the TanStack Start framework only.
2. **Build configuration independent of Lovable:** Replaced `@lovable.dev/vite-tanstack-config` with explicit TanStack Start, Nitro, React, Tailwind, and TS path plugins. Kept the existing custom SSR error wrapper as the server entry.
3. **Removed Lovable dependencies and editor-only hooks:** Removed Lovable auth package, Lovable Vite config package, Lovable preview-session bridge, Lovable editor telemetry hook, unused Lovable auth helper, and `.lovable` metadata. Supabase auth falls back to its normal browser storage behavior outside the removed preview bridge.
4. **Speech transcription:** The original migration attempted to use a hosted NVIDIA Parakeet ASR endpoint. The November 2026 model-routing update moved microphone transcription to Deepgram Nova-3 because NVIDIA's Parakeet/Nemotron Omni catalogue entries should not be assumed to be hosted chat/audio API endpoints. The route still verifies the Supabase bearer token, enforces a 4 MiB WAV segment limit, checks the WAV header, applies a timeout, and preserves the recorder's SSE event contract.
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

- Set `NVIDIA_API_KEY` as a server-side Vercel environment variable for chat and image understanding.
- `NVIDIA_MODEL` defaults to Nemotron 3.5 Lightning; `NVIDIA_REASONING_MODEL` defaults to Nemotron 3 Ultra; `NVIDIA_VISION_MODEL` defaults to Nemotron 3.5 Super VL.
- Keep all provider keys server-side. Do not prefix provider secrets with `VITE_`.
- `DEEPGRAM_API_KEY` is required for both microphone transcription (Nova-3) and Audio Study text-to-speech.
- Apply the database migrations documented in `README.md` to the intended Supabase project before relying on features that require them.

## Remaining risk / honest status

This is a static audit plus targeted fixes, not a production certification. Because dependencies and live credentials were unavailable, the full suite and integration paths remain unverified. In particular, test lecture transcription against the configured NVIDIA ASR endpoint and run the full feature smoke test after deployment. The app should not be described as guaranteed never to fail.

## Lecture-image understanding enhancement (2026-10-20)

- The November 2026 model-routing update uses `NVIDIA_VISION_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b` for image/document understanding, separate from the text-generation routes.
- Corrected image payloads to the NVIDIA-compatible `image_url` content-part format.
- PDF pages are rendered in the browser and passed as JPEGs to the vision model. Searchable PDFs receive a visual-analysis pass even when text extraction succeeds; scanned PDFs use page-image OCR with visual explanation. Visual/OCR processing is capped at 20 pages per PDF, and the material includes a note if later pages were not image-analyzed.
- PowerPoint extraction now follows slide image relationships and analyzes up to 12 embedded raster images per file, grounding each description in that slide's text. Unsupported vector image formats are skipped rather than mislabeled.
- Standalone image uploads receive OCR plus diagram/chart explanation. When multiple files are uploaded together, text/PDF/PowerPoint files are processed before standalone images so image descriptions can use earlier lecture text as context.
- The note-generation prompt explicitly preserves visual explanations, ties them to the relevant topic when supported, and tells the model not to invent unreadable labels or unsupported relationships.
- Validation limitation: the dependency install still timed out, so browser PDF rendering and live NVIDIA vision calls have not been integration-tested in this environment. Verify with a searchable PDF, a scanned PDF, a PowerPoint with a labelled diagram, and a standalone image after configuring `NVIDIA_VISION_MODEL` access in NVIDIA NIM.
