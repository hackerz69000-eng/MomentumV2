-- Study folders for organizing study sets. Existing sets remain Unfiled until moved.
CREATE TABLE IF NOT EXISTS public.study_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_folders TO authenticated;
GRANT ALL ON public.study_folders TO service_role;
ALTER TABLE public.study_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own study folders" ON public.study_folders;
CREATE POLICY "own study folders" ON public.study_folders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS study_folders_user_name_unique
  ON public.study_folders(user_id, lower(name));

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.study_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS study_sets_folder_idx ON public.study_sets(folder_id);
