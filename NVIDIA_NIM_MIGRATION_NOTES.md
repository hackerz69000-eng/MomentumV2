# NVIDIA NIM provider setup

Momentum's server-side text generation, vision/OCR, and microphone transcription use NVIDIA-hosted NIM APIs. The app uses the OpenAI-compatible Chat Completions endpoint.

## Required Vercel environment variables

- `NVIDIA_API_KEY` — API key from the NVIDIA API Catalog / Build.NVIDIA.com. Keep it server-side; do not prefix it with `VITE_`.
- `NVIDIA_MODEL=stepfun-ai/step-3.5-flash` — default text model for study sets, notes, flashcards, quizzes, tutoring, writing, and other text tasks.
- `NVIDIA_FALLBACK_MODELS=meta/llama-3.1-8b-instruct` — optional comma-separated fallback model IDs. The fallback is attempted for model-specific errors and transient server/rate-limit failures.
- `NVIDIA_VISION_MODEL=nvidia/nemotron-nano-12b-v2-vl` — vision-language model for image OCR, diagrams, and visual explanations.
- `NVIDIA_ASR_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` — audio-capable model for microphone transcription.
- `DEEPGRAM_API_KEY` — retained for the existing text-to-speech feature; it is separate from NIM.

## Setup

1. Create or use an NVIDIA Developer account and obtain an API key from https://build.nvidia.com/.
2. Add `NVIDIA_API_KEY` and the model variables above to Vercel for the environments you use.
3. Remove the old `BYTEZ_*` variables from Vercel after confirming no other deployment still depends on them.
4. Redeploy.
5. Test a short tutor prompt, study-set generation, flashcards, a quiz, image/PDF OCR, and a short microphone transcription.

## Provider details

- Text and vision requests use `https://integrate.api.nvidia.com/v1/chat/completions`.
- Requests use Bearer-token authentication and the OpenAI-compatible chat-completions message format.
- The transcription route sends WAV audio as a data URL to the audio-capable Nemotron Omni model. NVIDIA model support and audio input limits can vary; verify the selected model remains enabled for your API key.
- `NVIDIA_FALLBACK_MODELS` is an ordered fallback list, not a live availability or credit monitor.

## Important access / production note

NVIDIA describes Developer Program access to hosted NIM endpoints as intended for prototyping, research, development, and testing. NVIDIA states that serving real end users in production requires an NVIDIA AI Enterprise license. Check the current NVIDIA terms and account entitlements before deploying Momentum to public users.

## Performance changes in this migration

- Study-set notes and flashcards are generated concurrently. Flashcards are grounded directly in the uploaded source material so they do not need to wait for the notes request.
- Long-source note chunks and optional-reading enrichment chunks are processed with a concurrency limit of three, preserving source order when results are combined.
- Retry delays were reduced and provider fallback is limited to model-specific/transient errors.
- The create-study-set UI now avoids promising a fixed 20–60 second generation time.

Streaming note: the NIM API supports streamed chat completions, but this migration keeps the current server-function return contract non-streaming. True token-by-token display in the browser needs a separate streaming UI/API path; simply enabling upstream streaming would not make the existing server-function UI update progressively.
