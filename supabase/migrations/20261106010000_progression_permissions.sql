-- Restrict direct user writes to progression fields intended for user sync.
-- Admin-managed tier and reward controls remain writable only by SECURITY DEFINER
-- admin RPCs; own-row RLS continues to protect all ordinary user data.
revoke update on public.user_progression from authenticated;
grant update (xp, streak_data, freeze_data, reward_announcements, reward_theme, activity_ids)
  on public.user_progression to authenticated;

-- New rows can be initialized by the client without allowing it to set admin fields.
revoke insert on public.user_progression from authenticated;
grant insert (user_id, xp, streak_data, freeze_data, reward_announcements, reward_theme, activity_ids)
  on public.user_progression to authenticated;

create or replace function public.set_user_progression_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists set_user_progression_updated_at on public.user_progression;
create trigger set_user_progression_updated_at before insert or update on public.user_progression
  for each row execute function public.set_user_progression_updated_at();

-- Replace generated set cards in one transaction and preserve the prior cards in trash.
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
  if jsonb_array_length(p_cards) < 1 or jsonb_array_length(p_cards) > 20 then
    raise exception 'INVALID_SET_CONTENT' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cards) as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'q') <> 'string'
       or jsonb_typeof(item.value -> 'a') <> 'string'
       or (item.value ? 't' and jsonb_typeof(item.value -> 't') <> 'string')
  ) then raise exception 'INVALID_FLASHCARD' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_cards) as c(q text, a text, t text)
    where c.q is null or length(btrim(c.q)) < 1 or length(c.q) > 1000
       or c.a is null or length(btrim(c.a)) < 1 or length(c.a) > 2000
       or length(coalesce(c.t, '')) > 80
  ) then raise exception 'INVALID_FLASHCARD' using errcode = '22023'; end if;
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
  insert into public.flashcards(set_id, user_id, question, answer, topic, position)
    select p_set_id, v_user_id, btrim(c.q), btrim(c.a), left(coalesce(btrim(c.t), ''), 60), (c.ordinality - 1)::integer
      from jsonb_to_recordset(p_cards) with ordinality as c(q text, a text, t text, ordinality bigint);
  update public.study_sets set notes = p_notes, status = 'ready', error = null, updated_at = now()
    where id = p_set_id and user_id = v_user_id;
end;
$$;

revoke all on function public.replace_study_set_flashcards(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_study_set_flashcards(uuid, text, jsonb) to authenticated;
