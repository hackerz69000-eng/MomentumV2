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
