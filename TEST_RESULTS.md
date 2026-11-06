# Quiz generation — verification results

Run date: 2026-11-06. Environment: Node + Vitest (jsdom), TypeScript 5, Vite production build.

## Commands and real output

### `npx vitest run`
```
 Test Files  21 passed (21)
      Tests  162 passed (162)
   TEST_EXIT:0
```

### `npx tsc --noEmit`
```
TSC_EXIT:0
```
(no diagnostics)

### `npm run build`
```
✓ built in 2.87s
✓ built in 1.64s
BUILD_EXIT:0
```

## The reported bug, reproduced then fixed

Symptom: a 10-question quiz reported "generated 9 of 10", and Retry could not help.

Cause chain, all verified in code:

1. `planBatchRequests` asked for exactly the missing amount. With 9 accepted and 1
   missing it asked for **1** question. A one-question request is the worst case
   for duplicate rejection: the model returns a rewording of a question already in
   the quiz, `isNearDuplicate` rejects it, the round accepts nothing, the stall
   counter trips, generation stops at 9.
2. When the loop fell short, `QuizRunner.start()` **threw**, so no quiz was created
   and the Retry button did not exist on the error screen.
3. `max_tokens` for JSON mode was 8192, which truncates larger batches mid-array.
4. Partial batches were accepted without clamping to what the quiz still needed.

## Fixes

- `src/lib/quiz-questions.ts`
  - `batchAskTotal()` + `splitIntoBatchSizes()`: every round asks for ~1.6x the
    shortfall with a floor of `MIN_BATCH_ASK = 3` and a ceiling of
    `MAX_BATCH_REQUESTS = 6` requests, so a surplus absorbs rejections and the
    provider is never asked for a single question.
  - `acceptLimit()` exported: a batch can never contribute more than the quiz
    still needs, so the extra questions in a batch cannot inflate the quiz.
  - Comprehensive exam top-up now asks for `MIN_BATCH_ASK`-sized batches instead
    of single questions.
- `src/components/set/QuizRunner.tsx`
  - Per-batch `retryableStream()` (3 attempts, backoff) — a timeout costs a batch,
    not the quiz.
  - If the loop ends short, the accepted questions are used and a warning toast is
    shown instead of throwing. Starting with 9 real questions beats a dead end.
  - Server-side finalization failure falls back to the local validated pool.
  - `Retry generation` button renders next to Start whenever an error is shown.
- `src/routes/api/ai-stream.ts`
  - JSON-mode `max_tokens` raised 8192 -> 12000 so long batches are not truncated.

## Tests proving the fix (all passing)

`src/test/quiz-generation-runner.test.tsx`
- produces all 20 questions across multiple batches
- keeps requesting replacements when the provider repeats itself
- survives a provider timeout and still fills the quiz
- persists partial progress so a retry resumes instead of restarting
- **fills a 10-question quiz when every batch returns two fewer than asked -> 10/10**
- **fills a 20-question quiz when batches are truncated and contain invalid items -> 20/20**
- never asks the provider for a single question and never exceeds the quiz total

`src/test/quiz-generation-pipeline.test.ts` (42 tests)
- exactly 10, 20, 30, 40, 50 and 60 questions across batches
- duplicates within a batch, across batches of the same quiz
- reuse from an earlier completed quiz, Regular <-> Practice Exam, Comprehensive -> Regular
- resume of an unfinished quiz without duplicating existing questions
- comprehensive exam de-duplication across different study sets
- malformed questions rejected and never counted
- exhausted material part skipped without blocking the quiz
- thin source material still delivers a full quiz

## Not verified

- Live NVIDIA NIM calls. All provider responses in the tests are mocked; the tests
  prove the pipeline arithmetic, parsing and recovery, not live model quality.
- Real Supabase round-trips and real browser rendering.
- A 60-question live generation run (needs provider quota).
