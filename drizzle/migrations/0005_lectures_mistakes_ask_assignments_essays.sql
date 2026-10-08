CREATE TABLE public.lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Lecture',
  transcript text NOT NULL DEFAULT '',
  notes text,
  guide text,
  audio_paths text[] NOT NULL DEFAULT '{}',
  duration_seconds integer NOT NULL DEFAULT 0,
  in_material boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lectures TO authenticated;
GRANT ALL ON public.lectures TO service_role;
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own lectures" ON public.lectures FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX lectures_set_idx ON public.lectures(set_id);

CREATE TABLE public.mistakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  key text NOT NULL,
  question text NOT NULL,
  student_answer text NOT NULL DEFAULT '',
  correct_answer text NOT NULL DEFAULT '',
  explanation text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT 'General',
  source_kind text NOT NULL DEFAULT 'quiz',
  question_data jsonb,
  wrong_count integer NOT NULL DEFAULT 1,
  right_streak integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'review',
  last_wrong_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, set_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mistakes TO authenticated;
GRANT ALL ON public.mistakes TO service_role;
ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mistakes" ON public.mistakes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX mistakes_set_idx ON public.mistakes(set_id);

CREATE TABLE public.material_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  sources jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_messages TO authenticated;
GRANT ALL ON public.material_messages TO service_role;
ALTER TABLE public.material_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own material messages" ON public.material_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX material_messages_set_idx ON public.material_messages(set_id, created_at);

CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled assignment',
  instructions text NOT NULL DEFAULT '',
  rubric text NOT NULL DEFAULT '',
  sources text NOT NULL DEFAULT '',
  ideas text NOT NULL DEFAULT '',
  understanding text,
  brainstorm text,
  chosen text NOT NULL DEFAULT '',
  outline text,
  draft text NOT NULL DEFAULT '',
  chat jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
GRANT ALL ON public.assignments TO service_role;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own assignments" ON public.assignments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.essay_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Essay',
  essay text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  rubric text NOT NULL DEFAULT '',
  teacher_notes text NOT NULL DEFAULT '',
  sources text NOT NULL DEFAULT '',
  result jsonb,
  final_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.essay_grades TO authenticated;
GRANT ALL ON public.essay_grades TO service_role;
ALTER TABLE public.essay_grades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own essay grades" ON public.essay_grades FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);