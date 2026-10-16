# Momentum app-wide quality audit

This pass focused on concrete correctness, readability, and data-integrity problems visible in the supplied repository. It is not a claim that every feature has been runtime-tested.

## Changes in this pass

- Added a shared `MarkdownContent` renderer and routed AI-generated explanations, chats, study guides, reading briefs, lecture notes, feedback, and search answers through it. Flattened/escaped Markdown tables are converted to labeled lists; links open safely in a new tab; raw HTML remains disabled.
- Protected fenced code blocks from table normalization so examples containing pipes remain intact.
- Made Assignment Helper source permissions fail closed. Page ranges require reliable page markers and unambiguous document pagination; `first N pages` only includes extracted pages 1–N; chapter and named-section limits are isolated when their boundaries are detectable; unknown limits no longer send the whole source with only a warning.
- Applied a supplied usage limit to any uploaded assignment attachment that has one, rather than silently skipping limits on supporting material.
- Checked Assignment Helper saves and the pre-generation flush so the UI no longer reports success when a response or latest edits failed to persist.
- Scoped legacy local Study Set/card fallback reads to the active Supabase account, and prevented migration of a local set owned by another account.
- Fixed the streak starting state so opening the app no longer grants a fake first session. Streak dates now use the student's local calendar date rather than UTC, which can otherwise shift the day in Canada and other time zones.
- Checked file metadata persistence after uploading originals; failed metadata writes now attempt to remove the untracked storage object.
- Made study-set processing and flashcard regeneration back up existing cards before replacement and check the database writes. Made notes regeneration preserve old notes before overwriting them.
- Made essay grading save the latest edits successfully before invoking the grader.
- Hardened Recently Deleted restoration/permanent deletion so child-row, storage, and backup errors are surfaced instead of silently clearing the recovery item.
- Removed an unused local-only authentication helper that stored a weak, reversible password hash in `localStorage`; the app's active sign-in flow uses Supabase Auth.
- Corrected the Study Guide date input's minimum date to use local time and improved word-count parsing for assignment-aware time estimates.

## Verification

- ZIP archive integrity checked after packaging.
- TypeScript/TSX transpile syntax checks run across the source tree.
- Markdown formatter and source-scope functions were exercised directly with Node against the flattened table and restricted-page examples.
- Added Vitest coverage for flattened table formatting, fenced code preservation, assignment source limits, and local fallback account ownership.
- `npm install` could not complete in this environment and no dependencies are available locally. Therefore `npm test`, `npm run build`, full TypeScript type checking, linting, and browser end-to-end tests remain unverified and must be run in the user's project environment before deployment.


## Turnitin submission-prep feature (Oct 2026)

- Added authenticated `/turnitin` page and desktop/mobile navigation entry.
- Supports local selection of PDF, DOC/DOCX, RTF, ODT, and TXT files up to 40 MB, or pasted essay text with live word/character count and TXT export.
- Collects paper title, course, assignment, instructor, due date, and optional validated official portal URL.
- Requires final-version and citations/requirements confirmations; shows readiness checklist and clearly labels prepared status.
- Does not pretend to submit to Turnitin: official submission, similarity report, and receipt require the institution's licensed integration. Files/text remain client-side in this feature and are not uploaded by this page.
- Full build/tests were not run because dependency installation timed out in this workspace.
