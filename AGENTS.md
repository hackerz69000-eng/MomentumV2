<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Architecture

- Brand identity is rendered through the shared `BrandLogo` component and its matching favicon, so public and signed-in screens stay visually consistent.
- AI calls live in `src/lib/study.functions.ts` server fns (auth middleware, RLS client) using `aiText` in `src/lib/ai.server.ts`; JSON is prompted and parsed, not schema-enforced, for robustness.
- PDF text is extracted client-side with `unpdf` and stored as `study_sets.material_text`; no file storage needed.
- `_authenticated` layout is a client-side gate (`ssr: false`) because sessions live in browser storage.
- All study results (quiz, adaptive, exam, comprehensive, recall) are rows in `quiz_attempts` keyed by kind; comprehensive exams insert one row per set so per-set stats/readiness stay unified in `src/lib/stats.ts`.
- Streaks/achievements derive from the `study_activity` log (written via `logActivity`), computed by pure helpers in `src/lib/activity.ts` shared by client and server.
- File text is extracted client-side in `src/lib/extract.ts` (unpdf, mammoth, jszip, AI OCR fallback); originals go to the private `study-files` bucket under `<user_id>/<set_id>/` and are tracked in `study_files`.
- Per-set `custom_instructions` are appended to every AI system prompt via `ci(set)` in `study.functions.ts`; generated questions pass a second AI validation step and skip recently asked questions.
- Study Everything and Coach share the `coachData` context builder; study history is the `study_activity` log grouped client-side into sessions.
- Source-grounding rules (`GROUNDING` in `src/lib/ai.server.ts`) are appended to every `aiText` system prompt; pass `{ grounded: false }` only for pure transcription (OCR). Generated questions and flashcards must pass an AI validation pass or the request fails — unchecked items are never shown.
- Deletions of sets, flashcards, lectures, files and replaced notes/cards go through `src/lib/trash.ts`, which snapshots rows (with children) into the `trash` table and restores them with the same ids; storage objects are only removed on permanent delete.
- Universal search (`src/lib/global-search.ts`) is client-side keyword matching over RLS-scoped tables; grounded answers come from `searchAnswer` using only the matched snippets.
- Long-form editors (lecture transcript, assignments, essays) autosave via `useAutosave` with a `SaveStatus` indicator.
- Audio Study persists scripts, section audio paths, position, and interactions in dedicated session/event rows, while quiz outcomes reuse `quiz_attempts`, `mistakes`, and `study_activity`.
- Audio Study voices one section per server call, driven by the client, and saves each section immediately — a whole lesson exceeds a single request's time limit, and retries only fill in missing sections.
- Global UI styling uses semantic tokens and shared shell patterns so the focused dashboard visual system remains consistent across every tool.
