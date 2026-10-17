-- Persist a monotonically increasing revision for every manual tier edit.
-- This lets clients distinguish a new admin save from stale local state, including
-- when the admin re-selects the same tier.
alter table public.user_progression
  add column if not exists tier_override_revision bigint not null default 0;

create or replace function public.admin_set_progression(
  target_user_id uuid, new_xp bigint, new_tier_override integer, new_reward_overrides text[] default '{}'
) returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if new_xp < 0 or new_xp > 1000000000 then raise exception 'XP must be between 0 and 1,000,000,000'; end if;
  if new_tier_override is not null and (new_tier_override < 1 or new_tier_override > 50) then raise exception 'Tier must be between 1 and 50'; end if;
  insert into public.user_progression(user_id, xp, tier_override, tier_override_revision, reward_overrides, updated_at)
  values (target_user_id, new_xp, new_tier_override, 1, coalesce(new_reward_overrides, '{}'), now())
  on conflict (user_id) do update set
    xp = excluded.xp,
    tier_override = excluded.tier_override,
    tier_override_revision = public.user_progression.tier_override_revision + 1,
    reward_overrides = excluded.reward_overrides,
    updated_at = now();
end;
$$;
revoke all on function public.admin_set_progression(uuid, bigint, integer, text[]) from public, anon;
grant execute on function public.admin_set_progression(uuid, bigint, integer, text[]) to authenticated;
