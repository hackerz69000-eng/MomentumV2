CREATE TABLE public.audio_study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('quick', 'full', 'deep', 'weak')),
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'generating', 'ready', 'audio_error', 'error')),
  title text NOT NULL DEFAULT '',
  script text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_paths text[] NOT NULL DEFAULT '{}'::text[],
  audio_error text,
  position_seconds double precision NOT NULL DEFAULT 0,
  duration_seconds double precision NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  request_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_study_sessions TO authenticated;
GRANT ALL ON public.audio_study_sessions TO service_role;
ALTER TABLE public.audio_study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own audio sessions" ON public.audio_study_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own audio sessions" ON public.audio_study_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own audio sessions" ON public.audio_study_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own audio sessions" ON public.audio_study_sessions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE UNIQUE INDEX audio_study_request_key_unique ON public.audio_study_sessions (user_id, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX audio_study_sessions_set_updated_idx ON public.audio_study_sessions (set_id, updated_at DESC);

CREATE TABLE public.audio_study_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.audio_study_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('question', 'answer', 'quiz_question', 'quiz_result')),
  content text NOT NULL DEFAULT '',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_study_events TO authenticated;
GRANT ALL ON public.audio_study_events TO service_role;
ALTER TABLE public.audio_study_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own audio events" ON public.audio_study_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own audio events" ON public.audio_study_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own audio events" ON public.audio_study_events FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own audio events" ON public.audio_study_events FOR DELETE TO authenticated USING (auth.uid() = user_id);