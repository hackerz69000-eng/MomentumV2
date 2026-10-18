-- Canonical cross-device gamification state, isolated per authenticated account.
create table if not exists public.user_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  streak_data jsonb not null default '{}'::jsonb,
  freeze_data jsonb not null default '{"available":0,"used":0}'::jsonb,
  reward_announcements jsonb not null default '[]'::jsonb,
  reward_theme text not null default 'default',
  activity_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_progression enable row level security;
drop policy if exists "Users can read their own progression" on public.user_progression;
create policy "Users can read their own progression" on public.user_progression
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own progression" on public.user_progression;
create policy "Users can insert their own progression" on public.user_progression
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their own progression" on public.user_progression;
create policy "Users can update their own progression" on public.user_progression
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.user_progression to authenticated;
