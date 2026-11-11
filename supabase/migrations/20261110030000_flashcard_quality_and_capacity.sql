-- Expand study-set flashcard capacity, enforce contextual cloze prompts, and deduplicate inserts.
alter table public.flashcards add column if not exists card_type text not null default 'qa' check (card_type in ('qa','cloze'));

create or replace function public.replace_study_set_flashcards(p_set_id uuid, p_notes text, p_cards jsonb)
returns void
language plpgsql security invoker set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_cards jsonb;
  v_set_name text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_notes is null or length(p_notes) > 250000 then
    raise exception 'INVALID_SET_CONTENT' using errcode = '22023';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) is distinct from 'array' then
    raise exception 'INVALID_SET_CONTENT' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cards) < 1 or jsonb_array_length(p_cards) > 60 then
    raise exception 'INVALID_SET_CONTENT' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cards) as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'q') <> 'string'
       or jsonb_typeof(item.value -> 'a') <> 'string'
       or (item.value ? 't' and jsonb_typeof(item.value -> 't') <> 'string')
       or (item.value ? 'kind' and item.value ->> 'kind' not in ('qa','cloze'))
  ) then raise exception 'INVALID_FLASHCARD' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_cards) as c(q text, a text, t text)
    where c.q is null or length(btrim(c.q)) < 1 or length(c.q) > 1000
       or c.a is null or length(btrim(c.a)) < 1 or length(c.a) > 2000
       or length(coalesce(c.t, '')) > 80
  ) then raise exception 'INVALID_FLASHCARD' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_cards) as item(value) where coalesce(item.value ->> 'kind', 'qa') = 'cloze' and (item.value ->> 'q' !~ '\{\{c1::[^}]+\}\}' or length(regexp_replace(item.value ->> 'q', '\{\{c1::.*?\}\}', '', 'g')) < 28)) then
    raise exception 'INVALID_CLOZE_CONTEXT' using errcode = '22023';
  end if;
  select name into v_set_name from public.study_sets where id = p_set_id and user_id = v_user_id for update;
  if not found then raise exception 'STUDY_SET_NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.position, f.created_at), '[]'::jsonb)
    into v_old_cards from public.flashcards f where f.set_id = p_set_id and f.user_id = v_user_id;
  if jsonb_array_length(v_old_cards) > 0 then
    insert into public.trash(user_id, kind, label, set_id, data)
      values (v_user_id, 'flashcards', jsonb_array_length(v_old_cards) || ' replaced flashcards — ' || v_set_name,
        p_set_id, jsonb_build_object('rows', v_old_cards));
  end if;
  delete from public.flashcards where set_id = p_set_id and user_id = v_user_id;
  with expanded as (
    select item.value, item.ordinality,
      lower(regexp_replace(regexp_replace(item.value ->> 'q', '\{\{c[0-9]+::(.*?)\}\}', '\1', 'g'), '[^a-zA-Z0-9]', '', 'g')) as normalized_question
    from jsonb_array_elements(p_cards) with ordinality as item(value, ordinality)
  ), ranked as (
    select *, row_number() over (partition by normalized_question order by ordinality) as duplicate_rank
    from expanded
  )
  insert into public.flashcards(set_id, user_id, question, answer, topic, position, card_type)
    select p_set_id, v_user_id,
      btrim(item.value ->> 'q'), btrim(item.value ->> 'a'),
      left(coalesce(btrim(item.value ->> 't'), ''), 60),
      (item.ordinality - 1)::integer, coalesce(item.value ->> 'kind', 'qa')
    from ranked item
    where item.duplicate_rank = 1 and item.normalized_question <> '';
  update public.study_sets set notes = p_notes, status = 'ready', error = null, updated_at = now()
    where id = p_set_id and user_id = v_user_id;
end;
$$;

revoke all on function public.replace_study_set_flashcards(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_study_set_flashcards(uuid, text, jsonb) to authenticated;


-- Remove exact normalized duplicates left by earlier generation runs, retaining review progress.
with ranked as (
  select id,
    row_number() over (
      partition by set_id, lower(regexp_replace(
        regexp_replace(question, '\{\{c[0-9]+::(.*?)\}\}', '\1', 'g'),
        '[^a-zA-Z0-9]', '', 'g'
      ))
      order by coalesce(reps, 0) desc, last_reviewed_at desc nulls last, created_at asc, id asc
    ) as duplicate_rank
  from public.flashcards
  where nullif(regexp_replace(lower(question), '[^a-zA-Z0-9]', '', 'g'), '') is not null
)
delete from public.flashcards f using ranked r
where f.id = r.id and r.duplicate_rank > 1;
