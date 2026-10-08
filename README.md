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
- `DEEPGRAM_API_KEY` for lecture transcription and Audio Study voice generation

The `VITE_` Supabase values are intentionally public client configuration; never put service-role or other private secrets in a `VITE_` variable.

## Deployment checklist

Configure these server variables in Vercel: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `NVIDIA_API_KEY`, and `DEEPGRAM_API_KEY`. Configure the matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values for the browser. Redeploy after changing production variables.

## Architecture

- Supabase authentication and row-level security protect user data.
- Authenticated server functions receive the browser session as a Bearer token and verify it server-side.
- AI operations run on the server so provider keys are never exposed to the browser.
- The `_authenticated` route is gated client-side because Supabase sessions live in browser storage.
- Database migrations live under `drizzle/migrations`.

## Supabase hardening migration

Run `drizzle/migrations/0009_study_folders_hardening.sql` against the production Supabase database before deploying this build. It adds study folders, safe AI generation locks, Storage UPDATE policy, explicit ownership foreign keys, and the scheduled-trash cleanup prerequisites.

For automatic Recently Deleted cleanup, set the server-only Vercel variables `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. The service-role key must never be exposed through a `VITE_` variable.
