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
- `MISTRAL_API_KEY` for AI study generation
- `LOVABLE_API_KEY` for audio/transcription features that use the Lovable AI gateway

The `VITE_` Supabase values are intentionally public client configuration; never put service-role or other private secrets in a `VITE_` variable.

## Architecture

- Supabase authentication and row-level security protect user data.
- Authenticated server functions receive the browser session as a Bearer token and verify it server-side.
- AI operations run on the server so provider keys are never exposed to the browser.
- The `_authenticated` route is gated client-side because Supabase sessions live in browser storage.
- Database migrations live under `drizzle/migrations`.
