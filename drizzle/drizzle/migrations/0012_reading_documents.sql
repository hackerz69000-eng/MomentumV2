-- Separate optional readings from the primary lecture/material uploaded when a Study Set is created.
create table if not exists public.study_set_readings (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.study_sets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  content_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists study_set_readings_set_created_idx
  on public.study_set_readings(set_id, created_at desc);

grant select, insert, delete on public.study_set_readings to authenticated;
grant all on public.study_set_readings to service_role;
alter table public.study_set_readings enable row level security;

drop policy if exists "Users can read their own study set readings" on public.study_set_readings;
create policy "Users can read their own study set readings"
  on public.study_set_readings for select using (auth.uid() = user_id);

drop policy if exists "Users can add readings to their own study sets" on public.study_set_readings;
create policy "Users can add readings to their own study sets"
  on public.study_set_readings for insert with check (
    auth.uid() = user_id and exists (
      select 1 from public.study_sets s where s.id = set_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own study set readings" on public.study_set_readings;
create policy "Users can delete their own study set readings"
  on public.study_set_readings for delete using (auth.uid() = user_id);
