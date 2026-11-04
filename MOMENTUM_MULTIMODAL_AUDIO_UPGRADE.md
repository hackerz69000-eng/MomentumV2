# Momentum lecture, reading, and audio upgrade

## What changed

- Added an authenticated `/api/speak` endpoint using the existing Deepgram Aura-2 provider. The Deepgram key remains server-side; requests require a valid Supabase access token and are capped at 4,000 characters.
- Added **Listen to notes** to the Study Set Notes view. Notes are cleaned of common Markdown formatting, split into bounded speech chunks, generated sequentially, and played in order. Students can stop playback at any time. The feature uses the existing `DEEPGRAM_API_KEY`; no database migration is required.
- Increased PowerPoint visual analysis to a maximum of eight embedded images across the first 40 slides, and PDF visual analysis to up to six evenly distributed pages. Visual descriptions remain linked to the surrounding slide/page text. Text extraction still covers the full document; visual sampling remains intentionally bounded.
- Tightened owner scoping on lecture and Audio Study server operations so lecture/session reads and writes include the signed-in user's ID.
- Added unit coverage for speech-text cleanup, chunk boundaries, long text, and empty input.

## Existing capabilities retained

- Lecture recording is transcribed in short WAV segments through Deepgram Nova-3. Saved audio segments can be retried if transcription fails.
- Audio Study continues to generate lecture-grounded spoken lessons and save generated section audio using Deepgram Aura-2.
- Optional readings remain separate from primary lecture material. Reading Companion can compare readings with existing notes and let the student review additions before applying them.
- NVIDIA NIM remains the text and vision provider. The vision model remains configurable through `NVIDIA_VISION_MODEL`.

## Required environment variables

- `NVIDIA_API_KEY`
- `DEEPGRAM_API_KEY`
- Existing NVIDIA model variables as documented in `NVIDIA_NIM_MIGRATION_NOTES.md`

No new environment variable or database migration is introduced by this upgrade.

## Verification

- TypeScript transpilation/syntax checks passed for all changed TypeScript and TSX files.
- Speech chunking behavior passed five direct runtime checks, including long text and boundary handling.
- Full project typecheck/build and Vitest could not run in this environment because dependencies are not installed. `npm install` timed out, and the offline npm cache does not contain the project packages. Run `npm install`, `npm run typecheck`, `npm test`, and `npm run build` before deployment.
- Provider-backed transcription, image analysis, and speech generation still require valid NVIDIA/Deepgram credentials and must be smoke-tested in the deployed environment.
