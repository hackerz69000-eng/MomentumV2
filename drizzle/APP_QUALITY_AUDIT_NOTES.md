# Momentum app-wide quality audit

This is a living audit, not a claim that every workflow has passed runtime QA. The repository contains a broad study suite; source inspection and static checks are useful, but Supabase, NVIDIA NIM, browser, and mobile behavior still require an environment with dependencies and test credentials.

## Fixes retained from previous passes

- Shared `MarkdownContent` rendering for generated explanations, chats, study guides, reading briefs, lecture notes, feedback, and search answers; raw HTML remains disabled and links open safely.
- Assignment Helper source restrictions fail closed when page/section boundaries cannot be proven, and saves are checked before reporting success.
- Private upload metadata writes are checked and failed metadata writes attempt storage cleanup.
- Reading Companion AI context has aggregate size limits and explicit truncation markers.
- Study-set/card replacement and note regeneration back up existing data and check writes.
- Autosave reports failures rather than claiming the newest content is saved; long-form editors display save status.
- Recent deletion restoration and permanent deletion surface errors rather than silently discarding recovery records.
- Local fallback data is checked against the active Supabase account; the legacy local-auth password helper was removed.
- Streak dates use the student's local calendar day and opening the app alone does not grant a session.
- Study Guide date handling and assignment time-estimate parsing were improved.
- Progression includes 100 levels, milestone rewards, and differentiated celebrations.

## Additional confirmed fixes in this pass

- **Local fallback ownership leak:** local records without `user_id` were included in every signed-in account's fallback list and could be migrated into whichever account was currently active. Signed-in queries now only return records explicitly owned by that account. Unowned legacy records remain in the anonymous legacy context rather than being exposed cross-account.
- **Local fallback overwrite guard:** saving a local set now rejects an ID already owned by another account, and card replacement no longer removes another account's cards sharing that set ID.
- **XP input hardening:** malformed, negative, or non-finite XP values now normalize safely rather than producing `NaN`/infinite progression states.
- Added/updated regression tests for local ownership isolation and invalid XP handling.

## Findings that still need runtime or integration verification

### Release blockers / high priority

1. Install dependencies and run `npm test`, `npm run lint`, and `npm run build`; the current execution environment has no installed Vitest dependencies, so these commands cannot currently validate the project.
2. Test authentication and account isolation against a staging Supabase project, including RLS, local fallback migration, trash restore/permanent delete, uploads, and source linking.
3. Add authenticated per-user AI quotas/rate limits and request-level timeouts before broad public launch; source review did not establish that a global quota exists.
4. Verify private storage policies and environment variables in deployment without exposing service-role credentials.
5. Exercise upload/extraction with large, corrupt, scanned, table-heavy, equation-heavy, DOCX, and PPTX fixtures; extraction behavior depends on actual file content and configured services.

### Product/UX review still required

- Browser-driven desktop, tablet, and mobile walkthroughs for all study tabs and long-form workflows.
- Keyboard-only navigation, focus order, reduced-motion behavior, contrast, screen-reader labels, and modal focus restoration.
- End-to-end save/reload/resume tests for quizzes, exams, Active Recall, audio sessions, notes, assignments, essays, and lecture transcripts.
- Educational quality review of generated questions, grading, explanations, source-grounded tutor responses, and citations using representative course materials.
- Performance measurements for initial bundle, large study sets, long source documents, repeated AI requests, and history pages.

## Scope note

The previous ZIP focused on progression/rewards. This audit identifies and fixes specific correctness/privacy issues but is **not yet a completed, end-to-end revamp of every study feature**. Avoid calling the app release-ready until the remaining checks above have been run and their failures resolved.
