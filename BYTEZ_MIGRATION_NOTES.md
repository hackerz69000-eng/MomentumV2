# Bytez provider migration

Momentum's server-side text generation, image analysis, and microphone transcription now use Bytez endpoints. AI API keys are read server-side only and must not use a `VITE_` prefix.

## Vercel environment variables

- `BYTEZ_API_KEY` — required; create/copy this from your Bytez dashboard.
- `BYTEZ_MODEL=microsoft/Phi-3-mini-4k-instruct` — default text/chat model for study sets, notes, flashcards, exams, tutoring, and other AI features. Override it with a Bytez model that supports the `chat` task and fits your plan.
- `BYTEZ_VISION_MODEL=Qwen/Qwen2.5-VL-7B-Instruct` — vision model for OCR and visual explanations. Confirm that the model ID exists in your Bytez account and supports image inputs.
- `BYTEZ_ASR_MODEL=openai/whisper-large-v3` — speech-to-text model for microphone transcription. Confirm the model supports audio input through Bytez's model API.
- `DEEPGRAM_API_KEY` — retained for the app's existing text-to-speech feature; this is separate from Bytez.

## Deployment

1. Copy the `BYTEZ_API_KEY` from your Bytez dashboard.
2. Add `BYTEZ_API_KEY` and the model settings above to Vercel for the Development, Preview, and Production environments you use.
3. Redeploy so the server functions receive the updated variables.
4. Test text-based study-set generation, flashcards, a 30-question exam, image/PDF visual extraction, and microphone transcription.
5. If Bytez returns a model/task or input-schema error, choose a model that supports the corresponding task and adjust the model-specific request schema based on that model's Bytez documentation.

The integration uses Bytez's unified HTTP API (`https://api.bytez.com/models/v2/...`) and its standardized `messages` / multimodal input conventions. Live provider requests were not run during this source update because no Bytez credentials are available in this workspace. The project still needs end-to-end validation with your Bytez account and selected models.
