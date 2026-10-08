CREATE TABLE public.trash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL DEFAULT '',
  set_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trash TO authenticated;
GRANT ALL ON public.trash TO service_role;
ALTER TABLE public.trash ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trash" ON public.trash FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX trash_user_created ON public.trash(user_id, created_at DESC);