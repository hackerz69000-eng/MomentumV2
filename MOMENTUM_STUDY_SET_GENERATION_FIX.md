# Momentum study-set generation fix

This update is based on `momentum-study-engine-update.zip` and preserves the existing study-set creation UI, optional readings, Study Engine features, Supabase integration, and NVIDIA NIM integration.

## Changes

- Removed AI descriptions of lecture visuals from searchable PDFs and PowerPoint files. PowerPoint extraction now reads slide text and speaker notes only.
- Changed scanned-page/image processing to OCR-only: it transcribes readable text and legible labels, and does not ask the vision model to explain diagrams or pictures.
- Kept OCR fallback for scanned PDFs and uploaded images, because it is needed to extract text when normal text extraction is unavailable.
- Scanned PDFs over 20 pages now stop with a clear message asking for a searchable PDF or smaller parts rather than silently creating a study set from only the first 20 pages.
- Study-set creation now stops if any required lecture file fails extraction; it no longer continues with a partial lecture set. Optional reading failures remain non-fatal and are reported.
- Removed the silent heuristic-notes fallback when NVIDIA NIM note generation fails. The actual error is now saved to the set so the student can retry, instead of potentially receiving incomplete notes as if generation succeeded.
- If generation fails after the set record is created, the app opens that set's error/retry screen rather than leaving the student on the creation page with no obvious way to recover.
- Optional reading enrichment is now best-effort: if a reading-specific NVIDIA NIM call or final reading integration fails, Momentum keeps the lecture-based notes and continues generating flashcards. For short combined inputs, if the combined lecture-plus-reading note call fails, it retries note generation using lecture material only. The reading never becomes a requirement for completing the core set.

## Validation

- TypeScript syntax transpilation passed for the modified study-set generation source file.
- Full typecheck, tests, and production build were not run because project dependencies are not installed in this environment.

## Accuracy note

No AI pipeline can guarantee 100% factual accuracy. This change improves reliability by avoiding unverified visual interpretations, refusing to silently omit failed lecture files, and surfacing generation failures. Scanned PDFs that exceed the OCR fallback limit must be split or converted to searchable text before generation.
