# Momentum Study Engine update

This update builds on the prior `momentum-readings-visual-notes-update.zip` project. It does not remove existing study tools or change the study-set creation layout.

## Added

- A Study Engine panel on the dashboard with Exam Rescue, Build Confidence, and Deep Mastery modes.
- Deadline-aware recommendations: assessments due today or within two days automatically prioritize short-horizon rescue actions.
- Session-length options from 10 to 90 minutes so students can make progress even when time or energy is limited.
- Local prioritization from due/overdue flashcards, repeated card lapses, new cards, and open Mistake Bank topics. This logic runs in application code and does not require an extra AI request.
- Direct links from each recommendation to flashcards, quizzes, practice exams, notes, mistakes, or the tutor.
- Quick links to a diagnostic quiz, mistake review, and exam simulation.
- More explicit quiz-generation instructions for distinct knowledge targets, plausible misconception-based distractors, application questions, and useful retesting of mistakes.
- Deadline-aware AI study plans that avoid impossible multi-day schedules when the assessment is tomorrow or today.
- Flashcard self-rating copy that encourages students to mark uncertain or guessed answers as **Hard / unsure**, helping the existing spaced-repetition schedule respond to confidence.

## Preserved and strengthened from the previous ZIP

- Optional readings remain in the existing study-set creation flow. Lectures continue to define note structure and order; readings should enrich matching sections without becoming a separate notes section.
- Fixed newline escaping in the upload extraction path so lecture/readings separators are real line breaks rather than literal `\\n` text.
- For large lecture-plus-reading uploads, notes generation now processes lecture chunks first, creates reading enrichment candidates mapped to existing lecture headings, then integrates only relevant new details. If AI generation fails, the fallback uses lecture material rather than accidentally building a separate readings section.
- Notes do not embed lecture-image galleries. Relevant visual analysis is described in text with slide/page references, limited to a small PDF sample and a maximum of four PowerPoint visuals.
- Fixed the duplicated wording in the PDF visual-sampling attribution.
- NVIDIA NIM remains the AI provider; no Lovable integration or new database migration was added.

## Validation

- TypeScript syntax transpilation passed for all six modified TypeScript/TSX files.
- Full `tsc --noEmit`, unit tests, and production build could not be completed in this environment because project dependencies are not installed and `vite/client` / `vitest/globals` type definitions are unavailable locally. Run these in the normal development environment before deploying:

```bash
npm install
npm run typecheck
npm test
npm run build
```
