ALTER TABLE public.flashcards
  ADD COLUMN topic text NOT NULL DEFAULT '',
  ADD COLUMN interval_days real NOT NULL DEFAULT 0,
  ADD COLUMN due_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reps integer NOT NULL DEFAULT 0,
  ADD COLUMN lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN last_reviewed_at timestamptz,
  ADD COLUMN is_custom boolean NOT NULL DEFAULT false;

ALTER TABLE public.study_sets
  ADD COLUMN exam_date date,
  ADD COLUMN minutes_per_day integer,
  ADD COLUMN plan jsonb;

CREATE TABLE public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'quiz',
  difficulty text NOT NULL DEFAULT 'mixed',
  score integer NOT NULL,
  total integer NOT NULL,
  duration_seconds integer,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_attempts TO authenticated;
GRANT ALL ON public.quiz_attempts TO service_role;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts" ON public.quiz_attempts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX quiz_attempts_set_idx ON public.quiz_attempts(set_id, created_at);