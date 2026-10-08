-- Study folders + production hardening.
-- Existing study sets remain valid and appear under the virtual "Unfiled" folder.

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
CREATE INDEX IF NOT EXISTS study_folders_user_updated_idx
  ON public.study_folders(user_id, updated_at DESC);

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.study_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS study_sets_folder_idx ON public.study_sets(folder_id);

-- Expired trash cleanup can run without a user visiting Recently Deleted.
-- The cleanup endpoint uses the server-only Supabase service role to remove
-- associated Storage objects as well as the database rows.

-- Prevent duplicate expensive AI generations for the same user/set/action.
CREATE TABLE IF NOT EXISTS public.ai_generation_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid REFERENCES public.study_sets(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.ai_generation_locks TO authenticated;
GRANT ALL ON public.ai_generation_locks TO service_role;
ALTER TABLE public.ai_generation_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ai generation locks" ON public.ai_generation_locks;
CREATE POLICY "own ai generation locks" ON public.ai_generation_locks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_generation_locks_unique
  ON public.ai_generation_locks(user_id, coalesce(set_id, '00000000-0000-0000-0000-000000000000'::uuid), action);

-- Add explicit ownership foreign keys where older migrations omitted them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_sets_user_id_auth_users_fkey'
  ) THEN
    ALTER TABLE public.study_sets
      ADD CONSTRAINT study_sets_user_id_auth_users_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_activity_user_id_auth_users_fkey'
  ) THEN
    ALTER TABLE public.study_activity
      ADD CONSTRAINT study_activity_user_id_auth_users_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure the private bucket exists on a fresh Supabase project.
INSERT INTO storage.buckets (id, name, public)
VALUES ('study-files', 'study-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Storage UPDATE is required by upsert/retry flows.
DROP POLICY IF EXISTS "study files update own" ON storage.objects;
CREATE POLICY "study files update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
