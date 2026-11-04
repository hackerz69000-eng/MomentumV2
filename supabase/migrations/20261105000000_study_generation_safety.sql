-- Cross-tab/device generation leases and atomic final writes. No existing
-- study data is deleted by this migration.

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS generation_source_revision uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.study_sets
  ALTER COLUMN generation_source_revision SET DEFAULT gen_random_uuid();

UPDATE public.study_sets
SET generation_source_revision = gen_random_uuid()
WHERE generation_source_revision IS NULL;

ALTER TABLE public.study_sets
  ALTER COLUMN generation_source_revision SET NOT NULL;

CREATE OR REPLACE FUNCTION public.bump_study_source_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.subject IS DISTINCT FROM NEW.subject
     OR OLD.material_text IS DISTINCT FROM NEW.material_text
     OR OLD.custom_instructions IS DISTINCT FROM NEW.custom_instructions THEN
    NEW.generation_source_revision := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS study_sets_bump_source_revision ON public.study_sets;
CREATE TRIGGER study_sets_bump_source_revision
BEFORE UPDATE OF name, subject, material_text, custom_instructions ON public.study_sets
FOR EACH ROW EXECUTE FUNCTION public.bump_study_source_revision();

CREATE TABLE IF NOT EXISTS public.study_set_generation_locks (
  set_id uuid PRIMARY KEY REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lock_token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.study_set_generation_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_set_generation_locks FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'study_set_generation_locks'
      AND policyname = 'Users can inspect their generation leases'
  ) THEN
    CREATE POLICY "Users can inspect their generation leases"
      ON public.study_set_generation_locks
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_study_set_generation(
  p_set_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claimed uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before generating study resources.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.study_sets s WHERE s.id = p_set_id AND s.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Study set not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.study_set_generation_locks AS existing (set_id, user_id, lock_token, expires_at)
  VALUES (p_set_id, v_user_id, p_lock_token, now() + interval '2 minutes')
  ON CONFLICT (set_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        lock_token = EXCLUDED.lock_token,
        expires_at = EXCLUDED.expires_at
    WHERE existing.expires_at <= now()
       OR (existing.user_id = EXCLUDED.user_id AND existing.lock_token = EXCLUDED.lock_token)
  RETURNING lock_token INTO v_claimed;

  RETURN v_claimed = p_lock_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_study_set_generation(
  p_set_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  UPDATE public.study_set_generation_locks
  SET expires_at = now() + interval '2 minutes'
  WHERE set_id = p_set_id AND user_id = v_user_id AND lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_study_set_generation(
  p_set_id uuid,
  p_lock_token uuid,
  p_error text DEFAULT NULL,
  p_mark_set_error boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.study_set_generation_locks l
    WHERE l.set_id = p_set_id AND l.user_id = v_user_id AND l.lock_token = p_lock_token
    FOR UPDATE
  ) THEN RETURN false; END IF;

  IF p_mark_set_error THEN
    UPDATE public.study_sets
    SET status = 'error', error = left(coalesce(p_error, 'Generation failed.'), 500)
    WHERE id = p_set_id AND user_id = v_user_id;
  END IF;
  DELETE FROM public.study_set_generation_locks
  WHERE set_id = p_set_id AND user_id = v_user_id AND lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_study_generation_checkpoint(
  p_set_id uuid,
  p_lock_token uuid,
  p_generation_key text,
  p_source_revision uuid,
  p_checkpoint jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_revision uuid;
  v_current_checkpoint jsonb;
  v_checkpoint jsonb;
  v_lock_token uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sign in before saving generation progress.' USING ERRCODE = '28000'; END IF;
  IF p_generation_key !~ '^[0-9a-f]{64}$' OR p_checkpoint IS NULL OR jsonb_typeof(p_checkpoint) <> 'object' THEN
    RAISE EXCEPTION 'Invalid generation checkpoint.' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (p_checkpoint ? 'notes' AND jsonb_typeof(p_checkpoint->'notes') = 'string' AND length(p_checkpoint->>'notes') >= 50)
    OR (p_checkpoint ? 'cards' AND jsonb_typeof(p_checkpoint->'cards') = 'array' AND jsonb_array_length(p_checkpoint->'cards') BETWEEN 1 AND 20)
  ) THEN RAISE EXCEPTION 'Checkpoint must contain completed notes or flashcards.' USING ERRCODE = '22023'; END IF;

  SELECT s.generation_source_revision, s.generation_checkpoint
  INTO v_current_revision, v_current_checkpoint
  FROM public.study_sets s
  WHERE s.id = p_set_id AND s.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Study set not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_current_revision <> p_source_revision THEN
    RAISE EXCEPTION 'Study material changed during generation. Retry to use the latest source.' USING ERRCODE = '40001';
  END IF;
  SELECT l.lock_token INTO v_lock_token FROM public.study_set_generation_locks l
  WHERE l.set_id = p_set_id AND l.user_id = v_user_id AND l.lock_token = p_lock_token AND l.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This generation lease expired. Retry to continue safely.' USING ERRCODE = '55P03'; END IF;

  IF v_current_checkpoint->>'generationKey' = p_generation_key
     AND v_current_checkpoint->>'sourceRevision' = p_source_revision::text THEN
    v_checkpoint := v_current_checkpoint || p_checkpoint;
  ELSE
    v_checkpoint := jsonb_build_object('generationKey', p_generation_key, 'sourceRevision', p_source_revision::text) || p_checkpoint;
  END IF;
  UPDATE public.study_sets SET generation_checkpoint = v_checkpoint
  WHERE id = p_set_id AND user_id = v_user_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_study_set_generation(
  p_set_id uuid,
  p_lock_token uuid,
  p_generation_key text,
  p_source_revision uuid,
  p_notes text,
  p_cards jsonb,
  p_append_cards boolean DEFAULT false,
  p_lecture_id uuid DEFAULT NULL,
  p_lecture_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_set public.study_sets%ROWTYPE;
  v_old_cards jsonb;
  v_lock_token uuid;
  v_lecture_updated_at timestamptz;
  v_card_position integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sign in before saving study resources.' USING ERRCODE = '28000'; END IF;
  IF p_generation_key !~ '^[0-9a-f]{64}$' OR p_source_revision IS NULL
     OR (p_notes IS NULL AND p_cards IS NULL) THEN
    RAISE EXCEPTION 'Invalid study generation result.' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) NOT BETWEEN 50 AND 250000 THEN
    RAISE EXCEPTION 'Generated notes are outside the allowed size.' USING ERRCODE = '22023';
  END IF;
  IF p_append_cards AND p_cards IS NULL THEN
    RAISE EXCEPTION 'Appending cards requires a non-empty card list.' USING ERRCODE = '22023';
  END IF;
  IF p_cards IS NOT NULL AND (jsonb_typeof(p_cards) <> 'array' OR jsonb_array_length(p_cards) NOT BETWEEN 1 AND CASE WHEN p_append_cards THEN 25 ELSE 20 END) THEN
    RAISE EXCEPTION 'Generated flashcards are invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_cards IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_cards) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
       OR length(trim(coalesce(item.value->>'q', ''))) NOT BETWEEN 1 AND 1000
       OR length(trim(coalesce(item.value->>'a', ''))) NOT BETWEEN 1 AND 2000
       OR length(coalesce(item.value->>'t', '')) > CASE WHEN p_append_cards THEN 100 ELSE 80 END
  ) THEN RAISE EXCEPTION 'Generated flashcards contain invalid fields.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_set FROM public.study_sets s
  WHERE s.id = p_set_id AND s.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Study set not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_set.generation_source_revision <> p_source_revision THEN
    RAISE EXCEPTION 'Study material changed while Momentum was generating. The outdated result was not saved. Retry generation to use the latest material.' USING ERRCODE = '40001';
  END IF;
  SELECT l.lock_token INTO v_lock_token FROM public.study_set_generation_locks l
  WHERE l.set_id = p_set_id AND l.user_id = v_user_id AND l.lock_token = p_lock_token AND l.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This generation lease expired or belongs to another tab. Retry to continue safely.' USING ERRCODE = '55P03'; END IF;

  IF p_lecture_id IS NOT NULL THEN
    SELECT l.updated_at INTO v_lecture_updated_at FROM public.lectures l
    WHERE l.id = p_lecture_id AND l.set_id = p_set_id AND l.user_id = v_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_lecture_updated_at IS DISTINCT FROM p_lecture_updated_at THEN
      RAISE EXCEPTION 'The lecture changed while Momentum was generating. The outdated result was not saved. Retry generation.' USING ERRCODE = '40001';
    END IF;
  ELSIF p_lecture_updated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Lecture version was supplied without a lecture id.' USING ERRCODE = '22023';
  END IF;

  IF p_notes IS NOT NULL AND v_set.notes IS NOT NULL AND v_set.notes <> p_notes THEN
    INSERT INTO public.trash (user_id, kind, label, set_id, data)
    VALUES (v_user_id, 'notes', 'Previous notes — ' || v_set.name, p_set_id, jsonb_build_object('notes', v_set.notes));
  END IF;
  IF p_cards IS NOT NULL THEN
    IF p_append_cards THEN
      SELECT coalesce(max(fc.position) + 1, 0) INTO v_card_position
      FROM public.flashcards fc WHERE fc.set_id = p_set_id AND fc.user_id = v_user_id;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(fc) ORDER BY fc.position), '[]'::jsonb)
      INTO v_old_cards FROM public.flashcards fc
      WHERE fc.set_id = p_set_id AND fc.user_id = v_user_id;
      IF jsonb_array_length(v_old_cards) > 0 THEN
        INSERT INTO public.trash (user_id, kind, label, set_id, data)
        VALUES (v_user_id, 'flashcards', jsonb_array_length(v_old_cards)::text || ' replaced flashcards — ' || v_set.name, p_set_id, jsonb_build_object('rows', v_old_cards));
      END IF;
      DELETE FROM public.flashcards fc WHERE fc.set_id = p_set_id AND fc.user_id = v_user_id;
      v_card_position := 0;
    END IF;
    INSERT INTO public.flashcards (set_id, user_id, question, answer, topic, position, is_custom)
    SELECT p_set_id, v_user_id, trim(c.value->>'q'), trim(c.value->>'a'), left(coalesce(c.value->>'t', ''), 60), v_card_position + (c.ordinality - 1)::integer, false
    FROM jsonb_array_elements(p_cards) WITH ORDINALITY AS c(value, ordinality);
  END IF;

  UPDATE public.study_sets
  SET notes = coalesce(p_notes, notes),
      notes_source_version = CASE WHEN p_notes IS NOT NULL THEN p_generation_key ELSE notes_source_version END,
      cards_source_version = CASE WHEN p_cards IS NOT NULL THEN p_generation_key ELSE cards_source_version END,
      study_source_version = p_generation_key,
      generation_checkpoint = '{}'::jsonb,
      status = 'ready', error = NULL, updated_at = now()
  WHERE id = p_set_id AND user_id = v_user_id;

  DELETE FROM public.study_set_generation_locks
  WHERE set_id = p_set_id AND user_id = v_user_id AND lock_token = p_lock_token;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_study_set_generation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renew_study_set_generation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_study_set_generation(uuid, uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_study_generation_checkpoint(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_study_set_generation(uuid, uuid, text, uuid, text, jsonb, boolean, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_study_set_generation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_study_set_generation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_study_set_generation(uuid, uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_study_generation_checkpoint(uuid, uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_study_set_generation(uuid, uuid, text, uuid, text, jsonb, boolean, uuid, timestamptz) TO authenticated;
