ALTER TABLE public.study_sets ADD COLUMN IF NOT EXISTS study_guide text, ADD COLUMN IF NOT EXISTS study_guide_at timestamptz;

CREATE TABLE public.study_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_activity TO authenticated;
GRANT ALL ON public.study_activity TO service_role;
ALTER TABLE public.study_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own activity" ON public.study_activity FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX study_activity_user_idx ON public.study_activity(user_id, created_at);

INSERT INTO public.study_activity (user_id, set_id, kind, count, created_at)
SELECT user_id, set_id, kind, 1, created_at FROM public.quiz_attempts;
INSERT INTO public.study_activity (user_id, set_id, kind, count, created_at)
SELECT user_id, set_id, 'flashcard', reps, last_reviewed_at FROM public.flashcards WHERE reps > 0 AND last_reviewed_at IS NOT NULL;