-- Connect course materials and lectures to other existing Study Sets without copying or replacing data.
CREATE TABLE IF NOT EXISTS public.study_set_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  source_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('set_material', 'lecture')),
  source_lecture_id uuid REFERENCES public.lectures(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_set_source_links_kind_check CHECK (
    (source_kind = 'set_material' AND source_lecture_id IS NULL) OR
    (source_kind = 'lecture' AND source_lecture_id IS NOT NULL)
  ),
  CONSTRAINT study_set_source_links_not_self_check CHECK (target_set_id <> source_set_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_set_source_links TO authenticated;
GRANT ALL ON public.study_set_source_links TO service_role;
ALTER TABLE public.study_set_source_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own study set source links" ON public.study_set_source_links;
CREATE POLICY "own study set source links" ON public.study_set_source_links
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.study_sets t WHERE t.id = target_set_id AND t.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.study_sets s WHERE s.id = source_set_id AND s.user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.study_sets t WHERE t.id = target_set_id AND t.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.study_sets s WHERE s.id = source_set_id AND s.user_id = auth.uid())
    AND (source_lecture_id IS NULL OR EXISTS (
      SELECT 1 FROM public.lectures l WHERE l.id = source_lecture_id AND l.set_id = source_set_id AND l.user_id = auth.uid()
    ))
  );
CREATE INDEX IF NOT EXISTS study_set_source_links_target_idx ON public.study_set_source_links(target_set_id, created_at DESC);
CREATE INDEX IF NOT EXISTS study_set_source_links_source_idx ON public.study_set_source_links(source_set_id);
CREATE UNIQUE INDEX IF NOT EXISTS study_set_source_links_material_unique
  ON public.study_set_source_links(target_set_id, source_set_id) WHERE source_kind = 'set_material';
CREATE UNIQUE INDEX IF NOT EXISTS study_set_source_links_lecture_unique
  ON public.study_set_source_links(target_set_id, source_lecture_id) WHERE source_kind = 'lecture';
