# Momentum Reading & Lecture Companion — Release Notes

## Included

- Study Set-integrated, lecture-first Reading & Lecture Companion.
- Separate optional reading uploads (PDF, DOCX, PPTX, TXT, Markdown, and supported images) that do not overwrite or merge into the original lecture/course material.
- Lecture-focused study guide prompts that use readings to clarify lecture concepts and identify additional or conflicting information.
- Source picker for a single reading/lecture or all connected sources.
- Cross-Study-Set links for extracted set material and existing lectures.
- Source-grounded study briefs and Q&A with source/page/slide marker instructions.
- PDF extraction preserves per-page headings when the parser provides page-separated text.
- Flashcard preview from connected sources, selection before save, and duplicate checks against existing cards and within the selected batch.
- Unlinking removes only the relationship; it does not delete the source, set, cards, quizzes, folders, or learning progress.
- Database row-level security checks the owner of the target set, source set, and linked lecture.

## One-time database setup

Run both `drizzle/migrations/0011_reading_companion_sources.sql` and `drizzle/migrations/0012_reading_documents.sql` in the Supabase SQL Editor for the deployed Supabase project. Migration 0011 adds source links; migration 0012 adds a separate table for optional reading text. They do not rewrite existing study data. Keep a database backup before applying any production migration.

## Verification status

- TypeScript syntax/transpilation check passed for the changed TS/TSX files.
- Full `tsc` and production build could not be completed in this environment because project dependencies are not installed (`vite/client` and `vitest/globals` type definitions are unavailable).
- After extracting, run `npm install`, `npm run build`, and `npm test` locally before deploying.
