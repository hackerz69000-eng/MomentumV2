-- Reusable, per-user file extraction cache. Cache rows contain derived text and
-- metadata only; source uploads remain in the existing private study-files bucket.
ALTER TABLE public.study_files
  ADD COLUMN IF NOT EXISTS content_sha256 text;

CREATE TABLE IF NOT EXISTS public.study_file_extractions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  extraction_version integer NOT NULL CHECK (extraction_version > 0),
  context_sha256 text NOT NULL CHECK (context_sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text text NOT NULL DEFAULT '',
  visual_descriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  visual_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  PRIMARY KEY (user_id, file_sha256, extraction_version, context_sha256)
);

ALTER TABLE public.study_file_extractions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_file_extractions TO authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'study_file_extractions'
      AND policyname = 'Users manage their own extraction cache'
  ) THEN
    CREATE POLICY "Users manage their own extraction cache"
      ON public.study_file_extractions
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS study_file_extractions_expiry_idx
  ON public.study_file_extractions (expires_at);

-- Track what source and prompt version produced saved resources. Checkpoints are
-- transient retry data and are cleared after successful set processing.
ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS study_source_version text,
  ADD COLUMN IF NOT EXISTS notes_source_version text,
  ADD COLUMN IF NOT EXISTS cards_source_version text,
  ADD COLUMN IF NOT EXISTS generation_checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb;
