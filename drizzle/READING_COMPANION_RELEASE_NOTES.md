## Upload size limit

- Increased per-file reading/material upload validation from 20 MiB to 100 MiB across study sets, assignment materials, essay uploads, reading companion materials, and local similarity reference files.
- Added a Supabase migration to raise the existing private `study-files` bucket limit to 100 MiB. Apply the migration/deploy it to the connected Supabase project for hosted storage to accept larger originals; provider/project-level limits can still apply.

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

## Study guide and reading upload improvements

- Reading and study-set upload validation now recognizes supported files by extension as well as browser MIME type, which helps when school portals provide PDFs with missing or incorrect MIME metadata. Markdown and common image extensions are explicitly accepted.
- Skipped upload notices now identify the exact file and whether it has an unsupported type or exceeds the 100 MiB limit.
- Study Guide generation now lets students optionally set a test date and select multiple study sets. The generated guide combines selected lecture-based materials into one structured guide with topic mapping, plain-language explanations, definitions, comparisons, examples, practice questions with a separate answer key, quick review, and a test-date-aware study plan.
- Additional study sets are validated server-side against the signed-in user's account before their content is included. The generated guide is saved to the current study set.


## Reading Companion usability and extraction-quality improvements

- PDF extraction now detects likely heading-only/sparse output and attempts OCR instead of accepting it as usable body text.
- If OCR is unavailable or the PDF exceeds the current OCR request limit, the upload fails with an actionable message instead of saving misleading, low-value text.
- Summary, Q&A, and flashcard generation reject sources that appear to contain only headings or too little readable body text; this prevents generating unsupported or generic study material from empty context.
- Study brief and Q&A output use clearer heading hierarchy, spacing, line-height, and answer-panel styling.
- AI prompts request concise, specific, scannable study material and direct answers rather than long unstructured paragraphs.

Validation note: source-level changes were reviewed and the ZIP integrity will be checked. A full application build and live OCR/provider test were not run in this environment.

## Selectable-PDF body-text extraction fix

- When the normal PDF text helper returns sparse output (such as page headings only), Momentum now reads each PDF page's text items directly and uses that result when it contains more body text.
- OCR output is only allowed to replace the existing extraction when it looks like readable body text, so a heading-only result is not preferred just because it is returned by OCR.
- Verification: ZIP integrity checked after packaging. A full application build and live test with the user's specific PDF have not been run; please verify by uploading the same PDF and checking the extracted-text preview/material character count.
