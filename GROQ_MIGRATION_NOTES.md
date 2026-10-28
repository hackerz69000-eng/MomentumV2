# Groq provider migration

Momentum's server-side AI calls now use Groq instead of NVIDIA NIM for text generation, image/vision analysis, and audio transcription.

## Required Vercel environment variable

- `GROQ_API_KEY`: create a key in the Groq Console and add it to Vercel's server-side environment variables. Do not use a `VITE_` prefix or expose it to the browser.

## Optional model overrides

- `GROQ_MODEL=openai/gpt-oss-20b` — default text model for study sets, notes, flashcards, exams, tutor, writing tools, and other AI features.
- `GROQ_VISION_MODEL=qwen/qwen3.8-27b` — default vision model for OCR and visual explanations.
- `GROQ_ASR_MODEL=whisper-large-v3-turbo` — default audio transcription model.

The application retains its existing `DEEPGRAM_API_KEY` dependency for text-to-speech generation. That is a separate service and was not replaced by this change.

## Deployment steps

1. Create a Groq API key in the Groq Console.
2. Add `GROQ_API_KEY` to the Vercel project for each environment you use (Development/Preview/Production as needed).
3. Redeploy so the server functions receive the new variable.
4. Test text-based study set generation, flashcards, a 30-question exam, image/PDF visual extraction, and microphone transcription.
5. Check the Groq Console usage and rate-limit pages after testing.

NVIDIA NIM credentials are no longer read by the application's active text-generation, vision, or transcription code paths. Live provider calls were not run as part of this source update; valid Groq credentials and account access are required to verify them end-to-end.
