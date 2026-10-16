ALTER TABLE public.study_sets ADD COLUMN IF NOT EXISTS custom_instructions text NOT NULL DEFAULT '';
ALTER TABLE public.study_activity
  ADD COLUMN IF NOT EXISTS score integer,
  ADD COLUMN IF NOT EXISTS total integer,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS meta jsonb;

CREATE TABLE public.study_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  path text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL DEFAULT '',
  size integer NOT NULL DEFAULT 0,
  chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_files TO authenticated;
GRANT ALL ON public.study_files TO service_role;
ALTER TABLE public.study_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own files" ON public.study_files FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "study files read own" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'study-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "study files insert own" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'study-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "study files delete own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'study-files' AND (storage.foldername(name))[1] = auth.uid()::text);