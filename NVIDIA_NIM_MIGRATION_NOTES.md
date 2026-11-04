# Momentum AI model configuration

Momentum uses NVIDIA-hosted NIM chat-completion endpoints for text generation and image/document understanding. Audio transcription and generated speech use Deepgram's dedicated speech APIs.

## Vercel environment variables

- `NVIDIA_API_KEY` — API key from NVIDIA Build / API Catalog. Keep it server-side; never prefix it with `VITE_`.
- `NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b` — fast default model for flashcards, study guides, quizzes, summaries, and everyday generation.
- `NVIDIA_REASONING_MODEL=nvidia/nemotron-3-ultra-550b-a55b` — stronger reasoning route for essay grading, AI Tutor, Ask Your Materials, and answer explanations. If unavailable for the account, Momentum falls back to the primary model.
- `NVIDIA_FALLBACK_MODELS=stepfun-ai/step-3.5-flash` — optional comma-separated fallback model IDs.
- `NVIDIA_VISION_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b` — image and document-page understanding.
- `DEEPGRAM_API_KEY` — speech-to-text transcription and existing text-to-speech generation.

## Setup

1. Generate an NVIDIA API key at https://build.nvidia.com/.
2. Add the NVIDIA variables above to Vercel for the environments you use.
3. Keep `DEEPGRAM_API_KEY` configured for microphone transcription and generated audio.
4. Redeploy and test a short tutor question, study-set generation, flashcards, an essay grade, image/document OCR, microphone transcription, and audio generation.

## Provider and routing details

- NVIDIA text/image requests use `https://integrate.api.nvidia.com/v1/chat/completions` with Bearer-token authentication.
- `aiText` selects the fast model by default. Features can request the reasoning route; if the selected reasoning model fails because of availability, rate limits, or transient provider errors, Momentum tries the primary model and then configured fallbacks.
- Nemotron reasoning is enabled for the Ultra route and disabled for the Lightning fast route.
- `aiImage` uses the Nemotron 3.5 Super VL model for image inputs.
- Audio transcription uses Deepgram Nova-3. NVIDIA's Parakeet and Nemotron Omni model assets are available for download/self-hosting, but should not be assumed to be hosted audio API endpoints.

## Performance notes

- Study-set notes and flashcards are generated concurrently. Flashcards are grounded directly in uploaded source material so they do not need to wait for notes generation.
- Long-source note chunks and optional-reading enrichment chunks use bounded concurrency while preserving source order.
- The app's existing server-function response contract remains non-streaming. True token-by-token browser display requires a separate streaming API/UI implementation.

## Trial and production access

NVIDIA's Build API trial endpoints are subject to NVIDIA's current trial terms, access limits, and model availability. Confirm the current terms and account entitlements before serving real end users at scale. A free prototype endpoint should not be assumed to provide unlimited production capacity.
