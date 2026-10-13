# Roadmap

## Audio Study integration

- [x] Add saved Audio Study sessions, messages, and private audio storage
- [x] Generate grounded lessons for Quick, Full, Deep Dive, and Weak Topics modes
- [x] Generate retryable lesson audio without losing the script
- [x] Build player controls, contextual questions, explanation actions, and saved position
- [x] Reuse Active Recall grading, Mistake Bank, readiness, and study history for Quiz Me
- [x] Add entry points from Overview, Notes, Study Guide, and Study Everything
- [x] Let Momentum Coach and Study Everything recommend Audio Study
- [ ] Verify generation failures, saved/resumed sessions, repeated clicks, questions, quizzes, and existing study tools
- [x] Refine the interface for a cleaner, friendlier experience while preserving Momentum's visual identity

## Quality & reliability audit (uploaded brief, sections 1–16)

Audit waves (find concrete bugs, then fix):

- [x] Wave A: data integrity — study.functions.ts, stats.ts, mistakes.ts, queries.ts (duplicates, counters, readiness/weak-topic math)
- [x] Wave B: study UI — QuizRunner, ActiveRecall, Flashcards, MistakeBank (double-submit, error states, stale UI, duplicate mistakes)
- [x] Wave C: Lecture Mode + Materials/extract (interruption, data loss, retry)
- [x] Wave D: AI calls — all *.functions.ts (error recovery, output validation/repair, friendly errors)
- [x] Wave E: routes — dashboard, sets.$id, history, exam, search, coach, trash (consistency, loading states, refresh)
- [x] Fix all confirmed bugs
- [x] Visual consistency pass (subtle; no redesign)
- [x] Full regression test with Playwright (end-to-end flow + refresh behavior)

## Done previously

- [x] Logo: SVG runner + yellow bolt, favicon, verified
- [x] Landing page redesign (preview only — user must publish)
- [x] Premium brief phases 1–2 (command center, mistake patterns, exam mark-for-review, flashcard priority, Explain modes, search grouping)
- [x] Tutor/Coach "destroy is not a function" fix


## App-wide quality pass (October 2026)

- [x] Shared Markdown renderer for AI responses and saved generated content; normalize flattened tables into accessible lists
- [x] Preserve fenced code blocks during Markdown normalization
- [x] Enforce assignment source limits fail-closed when page/chapter/section boundaries cannot be verified
- [x] Scope local Study Set/card fallback data and legacy migration to the active account
- [x] Correct false initial study streak and use local calendar dates
- [x] Check high-risk content replacement and save operations; preserve old notes/cards before regeneration
- [x] Surface restore/storage persistence errors in Recently Deleted
- [x] Remove unused local-only password storage helper
- [ ] Run npm install, full Vitest suite, production build, lint, and browser end-to-end regression tests in an environment with dependencies available

See `APP_QUALITY_AUDIT_NOTES.md` for scope and verification limitations.
