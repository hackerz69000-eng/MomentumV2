# Momentum

Momentum is an AI study platform that turns your study material into notes, flashcards, quizzes, guided study sessions, an AI tutor, and writing support.

## Development

Requirements: Node.js 22+ and npm.

```sh
git clone <this-repository-url>
cd <repository-name>
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in the required Supabase and AI environment variables for the features you use. Do not commit `.env` or other local environment files.

### Useful commands

```sh
npm run dev       # start the local development server
npm run build     # production build
npm run lint      # ESLint + Prettier checks
npm test          # test suite
```


## Reading & Lecture Companion

The Reading Companion is integrated into each existing Study Set. It can create study briefs, answer questions from selected or combined course sources, preview flashcards, and connect readings or lectures from another Study Set without copying the source set or replacing existing cards, quizzes, folders, or progress.

### Apply the Reading Companion migration

Before deploying this version, run `drizzle/migrations/0011_reading_companion_sources.sql` once in the Supabase SQL Editor for the project. This creates only the source-link table and its row-level security policies; it does not rewrite existing Study Sets or flashcards. The UI will show a migration notice if the table is missing. Existing source links are metadata only: unlinking a source does not delete the source reading, lecture, generated cards, or study history.

PDF extraction now preserves page headings where the PDF parser returns individual pages. Page citations are only shown when a page marker exists in the extracted text; the AI is instructed not to invent page numbers.

## Vercel deployment

This repository is configured for Vercel/TanStack Start. The Vercel project should use the repository root with the default framework/build detection.

Set these environment variables in Vercel for the environments you deploy to:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID` (if used by the client)
- `NVIDIA_API_KEY` for NVIDIA NIM AI study generation
- `NIM_MODEL` (optional; defaults to `openai/gpt-oss-20b`)
- `LOVABLE_API_KEY` for audio/transcription features that use the Lovable AI gateway

The `VITE_` Supabase values are intentionally public client configuration; never put service-role or other private secrets in a `VITE_` variable.

## Architecture

- Supabase authentication and row-level security protect user data.
- Authenticated server functions receive the browser session as a Bearer token and verify it server-side.
- AI operations run on the server so provider keys are never exposed to the browser.
- The `_authenticated` route is gated client-side because Supabase sessions live in browser storage.
- Database migrations live under `drizzle/migrations`.
