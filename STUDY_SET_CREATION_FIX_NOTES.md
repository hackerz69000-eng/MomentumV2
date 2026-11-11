# Study Set Creation Fix — 2026-10-27

## Change

- Removed the optional-readings upload control from the new study-set creation page.
- Removed optional-reading file state, extraction loop, and combined-material markers from the creation flow.
- Study sets are now created from the primary uploaded lecture/material files only, or from text pasted by the user.
- Kept the separate Readings feature inside an existing study set and kept legacy optional-reading parsing in the notes generator so existing saved study sets are not broken.

## Checks completed

- TypeScript/TSX syntax transpilation: 168 files, 0 syntax errors.
- `package.json` and `vercel.json` parse as valid JSON.
- Confirmed no optional-reading UI/state/extraction references remain in `src/routes/_authenticated/sets.new.tsx`.
- ZIP integrity check passed.

## Not verified in this environment

- Full TypeScript typecheck, automated tests, lint, and production build: dependencies are not installed in this environment.
- Live Supabase writes and live AI generation: require the project's configured credentials and runtime.

Run locally from `project/`: `bun install`, `bun run typecheck`, `bun run test`, `bun run lint`, `bun run build`.


# Study generation and notes workspace update — 2026-11-10

- Added bounded retries for failed/incomplete AI structured responses and each streamed notes section. The workflow retries an individual failed section before aborting; the existing saved notes/cards are not replaced until the validated final save.
- Added minimum-completeness and maximum-save-size checks for generated notes.
- Added `card_type` (`qa` or `cloze`) and a Supabase migration for cloze-deletion flashcards. Cloze prompts use `{{c1::hidden phrase}}`; the answer is revealed on card flip. Existing cards default to `qa`.
- Added a two-column Notes workspace when the study set has an uploaded PDF: a scrollable embedded PDF viewer beside the notes. Multiple PDFs can be selected. On narrow screens, the viewer stacks below the notes.
- Added full-note editing and explicit save/cancel controls.
- Existing atomic flashcard replacement RPC still preserves previous cards in trash and marks the set ready only after the complete replacement succeeds.

## Required deployment step

Apply `supabase/migrations/20261110000000_flashcard_cloze_deletions.sql` to the Supabase project before deploying the application. The migration adds the `flashcards.card_type` column and replaces the atomic flashcard replacement RPC to persist cloze card types.

## Verification

- TypeScript/TSX transpilation syntax check: all 7 changed TypeScript files passed.
- Full typecheck, unit tests, lint, and production build were not run because dependencies could not be installed in this environment.
- Live NVIDIA generation, Supabase migration execution, storage signed-URL access, and browser PDF rendering still require validation in the configured deployment.
