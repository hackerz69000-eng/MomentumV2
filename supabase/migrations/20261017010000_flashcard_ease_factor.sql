-- Persist the ease factor returned by the spaced-repetition scheduler.
-- Without this column, Supabase rejects review updates containing ease_factor.
alter table public.flashcards
  add column if not exists ease_factor numeric(3,2) not null default 2.50;

alter table public.flashcards
  drop constraint if exists flashcards_ease_factor_range;
alter table public.flashcards
  add constraint flashcards_ease_factor_range
  check (ease_factor >= 1.30 and ease_factor <= 3.20);
