CREATE TABLE public.study_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  material_text text NOT NULL DEFAULT '',
  material_source text NOT NULL DEFAULT 'text',
  material_filename text,
  notes text,
  status text NOT NULL DEFAULT 'processing',
  error text,
  quiz_score integer,
  quiz_total integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_sets TO authenticated;
GRANT ALL ON public.study_sets TO service_role;
ALTER TABLE public.study_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sets" ON public.study_sets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcards TO authenticated;
GRANT ALL ON public.flashcards TO service_role;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cards" ON public.flashcards FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX flashcards_set_idx ON public.flashcards(set_id);