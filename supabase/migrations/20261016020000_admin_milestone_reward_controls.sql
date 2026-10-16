-- Admin-managed reward grants/revocations for a learner.
alter table public.user_progression
  add column if not exists reward_overrides text[] not null default '{}';

drop function if exists public.admin_get_progression(uuid);
create function public.admin_get_progression(target_user_id uuid)
returns table(user_id uuid, email text, xp bigint, tier_override integer, reward_overrides text[], updated_at timestamptz)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query select u.id, u.email::text, coalesce(p.xp, 0)::bigint, p.tier_override, coalesce(p.reward_overrides, '{}'::text[]), p.updated_at
  from auth.users u left join public.user_progression p on p.user_id = u.id where u.id = target_user_id;
end;
$$;

drop function if exists public.admin_set_progression(uuid, bigint, integer);
create function public.admin_set_progression(target_user_id uuid, new_xp bigint, new_tier_override integer, new_reward_overrides text[] default '{}')
returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if new_xp < 0 or new_xp > 1000000000 then raise exception 'XP must be between 0 and 1,000,000,000'; end if;
  if new_tier_override is not null and (new_tier_override < 1 or new_tier_override > 50) then raise exception 'Tier must be between 1 and 50'; end if;
  insert into public.user_progression(user_id, xp, tier_override, reward_overrides, updated_at)
  values (target_user_id, new_xp, new_tier_override, coalesce(new_reward_overrides, '{}'), now())
  on conflict (user_id) do update set xp=excluded.xp, tier_override=excluded.tier_override, reward_overrides=excluded.reward_overrides, updated_at=now();
end;
$$;
revoke all on function public.admin_get_progression(uuid) from public, anon;
revoke all on function public.admin_set_progression(uuid, bigint, integer, text[]) from public, anon;
grant execute on function public.admin_get_progression(uuid) to authenticated;
grant execute on function public.admin_set_progression(uuid, bigint, integer, text[]) to authenticated;
