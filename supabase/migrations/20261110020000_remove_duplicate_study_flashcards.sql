-- Remove duplicate prompts already saved by earlier generation runs.
-- Keep the row with the strongest review history so the student's progress is retained.
with ranked as (
  select id,
         row_number() over (
           partition by set_id,
             lower(regexp_replace(
               regexp_replace(question, '\{\{c[0-9]+::(.*?)\}\}', '\1', 'g'),
               '[^a-z0-9]', '', 'g'
             ))
           order by coalesce(reps, 0) desc,
                    last_reviewed_at desc nulls last,
                    created_at asc,
                    id asc
         ) as duplicate_rank
  from public.flashcards
  where nullif(regexp_replace(lower(question), '[^a-z0-9]', '', 'g'), '') is not null
)
delete from public.flashcards f
using ranked r
where f.id = r.id
  and r.duplicate_rank > 1;
