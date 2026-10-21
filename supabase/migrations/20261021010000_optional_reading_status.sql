ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS optional_reading_status text DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS optional_reading_detail text;

UPDATE public.study_sets
SET optional_reading_status = 'not_applicable'
WHERE optional_reading_status IS NULL;
