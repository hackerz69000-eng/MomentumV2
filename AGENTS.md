# Project guidance

- Keep AI text generation on NVIDIA NIM via `src/lib/ai.server.ts`.
- Keep all provider credentials server-side; never use `VITE_` prefixes for secrets.
- Preserve Supabase row-level security and verify authenticated ownership for user data.
- For Vercel deployment, use the TanStack Start + Nitro setup in `vite.config.ts` and `vercel.json`.
- Run `bun run build`, `bun run test`, and `bun run lint` before release when dependencies are available.
