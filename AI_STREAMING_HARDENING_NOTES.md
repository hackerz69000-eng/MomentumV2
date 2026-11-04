# AI streaming hardening notes

## Included in this revision
- Hardened the browser SSE reader to support LF/CRLF framing, multiple `data:` lines, final unterminated events, provider-side SSE errors, empty responses, and cancellation cleanup.
- Added validation for the `task` selector and total prompt size on the authenticated NVIDIA streaming route.
- Kept the NVIDIA API key server-side and retained Supabase bearer-token verification.
- Added `Vary: Authorization` to the streaming response headers.

## Important integration status
The generic `/api/ai-stream` route and `streamAiText` helper are infrastructure. They are not automatically used by the existing `createServerFn` workflows. The current feature functions perform server-side study-set ownership checks, prompt construction, citations, and database persistence. Replacing them with browser-supplied prompts would weaken those guarantees.

The feature UIs therefore still need dedicated server-owned streaming handlers before they can be marked as fully integrated. In particular, Ask Your Materials, Momentum Coach, AI Tutor, essay grading, study guides, and reading/audio workflows each need their own server-side preparation and persistence path. Structured generators (flashcards, quizzes, exams) additionally need schema-aware validation before showing partial output.

## Validation limitations
Dependencies were not installed in this workspace (the install attempt timed out), so `tsc`, lint, tests, and production build could not be run. No live NVIDIA or Supabase credentials were available, so provider/auth integration was not exercised end-to-end.

## Deployment checklist
- Configure `NVIDIA_API_KEY`, `NVIDIA_MODEL`, and `NVIDIA_REASONING_MODEL` in Vercel.
- Ensure the selected model IDs are enabled for the NVIDIA API key/account.
- Deploy to a preview environment first and test signed-out, signed-in, cancelled, rate-limited, provider-error, and long-response cases.
- Do not expose `NVIDIA_API_KEY` in any `VITE_` variable.
