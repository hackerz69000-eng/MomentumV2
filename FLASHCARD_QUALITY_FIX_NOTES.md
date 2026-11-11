# Flashcard quality follow-up

## What changed

- Cloze generation now requires a complete, readable sentence with exactly one `{{c1::answer}}` deletion. Bare placeholders and underscore-only prompts are rejected before saving.
- Cloze cards display the sentence context with only the hidden phrase replaced by a blank. Malformed legacy cards show a repair message rather than silently presenting a blank-only exercise.
- Flashcard quantity now scales with source length: 5 cards for under 150 words, then 7, 10, 14, 18, 22, 28, 34, or 40 as the source grows. Generation prompts explicitly request the calculated count.
- New study-set creation and regeneration both remove exact and near-duplicate prompts before saving. Duplicate comparisons consider prompt wording and answer overlap.
- The save endpoint and Supabase RPC now support up to 60 cards, with a database-side exact-duplicate safeguard.
- The migration removes previously saved exact normalized duplicates while preserving the card with the strongest review history.

## Apply

Run `supabase db push` so `20261110030000_flashcard_quality_and_capacity.sql` is applied, then commit and deploy the application changes through Vercel.

## Verification status

- Flashcard-quality utility compiled with the installed TypeScript compiler.
- Focused checks passed for cloze-context validation, duplicate filtering, and source-length card-count selection.
- All modified TypeScript/TSX files passed TypeScript transpilation syntax checks.
- A full application typecheck/build and a live Supabase/Vercel test were not run in this environment.
