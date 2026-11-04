# Build import-protection fixes

This update addresses the TanStack Start import-protection boundaries found during the full source audit.

## Browser streaming module

- Replaced direct imports of `@/lib/ai-stream.client` throughout routes and UI components with the environment-safe `@/lib/ai-stream` facade.
- The facade exposes `streamAiText`, `streamAiJson`, and `streamPreparedNotes` through `createClientOnlyFn` and loads the browser implementation only inside those client-only callbacks.
- Type references to the browser implementation are erased at build time. The test that directly exercises `parseStreamedJson` remains a test-only import.

## Server request access

- Removed the top-level `@tanstack/react-start/server` import from `src/integrations/supabase/auth-middleware.ts`.
- `getRequest` is now dynamically imported from inside the `.server(...)` middleware callback, keeping the server-only dependency within the server boundary.

## Verification limits

- Audited source imports for direct `.client.*` and `@tanstack/react-start/server` imports.
- TypeScript syntax transpilation and source-level checks are run separately from the production build.
- A production Vite build and full typecheck could not be run in this environment because dependencies could not be installed. Run `npm run build` in the deployment environment to confirm the complete production build.
