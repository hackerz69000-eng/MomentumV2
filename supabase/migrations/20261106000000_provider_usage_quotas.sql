-- Durable, per-user provider quotas and usage accounting.
-- Requests reserve quota before the external provider is contacted. Only short-lived
-- active reservations are retained; usage and cost estimates aggregate by UTC day.
create table if not exists public.provider_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('nvidia', 'deepgram_asr', 'deepgram_tts')),
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  cancelled_count integer not null default 0 check (cancelled_count >= 0),
  input_units bigint not null default 0 check (input_units >= 0),
  output_units bigint not null default 0 check (output_units >= 0),
  total_latency_ms bigint not null default 0 check (total_latency_ms >= 0),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  cost_estimate_complete boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, usage_date)
);

create table if not exists public.provider_usage_active (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('nvidia', 'deepgram_asr', 'deepgram_tts')),
  input_units bigint not null check (input_units >= 0),
  started_at timestamptz not null default now()
);

create index if not exists provider_usage_active_user_provider_idx
  on public.provider_usage_active(user_id, provider, started_at);
create index if not exists provider_usage_daily_date_idx
  on public.provider_usage_daily(usage_date desc, provider);

alter table public.provider_usage_daily enable row level security;
alter table public.provider_usage_active enable row level security;
drop policy if exists "Users can read their own provider usage" on public.provider_usage_daily;
create policy "Users can read their own provider usage"
  on public.provider_usage_daily for select to authenticated using (auth.uid() = user_id);
revoke all on public.provider_usage_daily from public, anon, authenticated;
grant select on public.provider_usage_daily to authenticated;
revoke all on public.provider_usage_active from public, anon, authenticated;

create or replace function public.reserve_provider_usage(p_provider text, p_input_units bigint)
returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_limit_requests integer;
  v_limit_units bigint;
  v_limit_concurrency integer;
  v_requests integer;
  v_units bigint;
  v_active integer;
  v_id uuid;
begin
  if v_user_id is null then raise exception 'PROVIDER_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_provider is null or p_provider not in ('nvidia', 'deepgram_asr', 'deepgram_tts') then
    raise exception 'PROVIDER_UNSUPPORTED' using errcode = '22023';
  end if;
  if p_input_units is null or p_input_units < 0 then
    raise exception 'PROVIDER_INVALID_USAGE' using errcode = '22023';
  end if;

  -- Fixed server-enforced limits cannot be raised by changing RPC arguments.
  if p_provider = 'nvidia' then
    v_limit_requests := 160; v_limit_units := 24000000; v_limit_concurrency := 4;
    if p_input_units > 8000000 then raise exception 'PROVIDER_REQUEST_TOO_LARGE' using errcode = 'P0001'; end if;
  elsif p_provider = 'deepgram_asr' then
    v_limit_requests := 120; v_limit_units := 250000000; v_limit_concurrency := 2;
    if p_input_units > 4194304 then raise exception 'PROVIDER_REQUEST_TOO_LARGE' using errcode = 'P0001'; end if;
  else
    v_limit_requests := 80; v_limit_units := 100000; v_limit_concurrency := 2;
    if p_input_units > 4000 then raise exception 'PROVIDER_REQUEST_TOO_LARGE' using errcode = 'P0001'; end if;
  end if;

  -- Serialize reservations for one user/provider so simultaneous instances cannot
  -- race past the daily or concurrency limits.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_provider, 0));
  insert into public.provider_usage_daily(user_id, provider, usage_date)
    values (v_user_id, p_provider, v_day) on conflict do nothing;
  select request_count, input_units into v_requests, v_units
    from public.provider_usage_daily
    where user_id = v_user_id and provider = p_provider and usage_date = v_day
    for update;
  delete from public.provider_usage_active
    where user_id = v_user_id and provider = p_provider and started_at < now() - interval '10 minutes';
  select count(*) into v_active from public.provider_usage_active
    where user_id = v_user_id and provider = p_provider;
  if v_active >= v_limit_concurrency then
    raise exception 'PROVIDER_CONCURRENCY_LIMIT' using errcode = 'P0001';
  end if;
  if v_requests >= v_limit_requests or v_units + p_input_units > v_limit_units then
    raise exception 'PROVIDER_DAILY_QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.provider_usage_active(user_id, provider, input_units)
    values (v_user_id, p_provider, p_input_units) returning id into v_id;
  update public.provider_usage_daily set
    request_count = request_count + 1,
    input_units = input_units + p_input_units,
    updated_at = now()
    where user_id = v_user_id and provider = p_provider and usage_date = v_day;
  return v_id;
end;
$$;

create or replace function public.complete_provider_usage(
  p_reservation_id uuid,
  p_status text,
  p_latency_ms integer,
  p_output_units bigint default 0,
  p_estimated_cost_micros bigint default 0,
  p_cost_estimate_complete boolean default false
) returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_active public.provider_usage_active%rowtype;
begin
  if auth.uid() is null then raise exception 'PROVIDER_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('success', 'failure', 'cancelled')
     or p_latency_ms is null or p_output_units is null or p_estimated_cost_micros is null
     or p_latency_ms < 0
     or p_latency_ms > 900000 or p_output_units < 0 or p_estimated_cost_micros < 0
     or p_cost_estimate_complete is null then
    raise exception 'PROVIDER_INVALID_USAGE' using errcode = '22023';
  end if;
  delete from public.provider_usage_active
    where id = p_reservation_id and user_id = auth.uid()
    returning * into v_active;
  if not found then return false; end if;
  update public.provider_usage_daily set
    success_count = success_count + case when p_status = 'success' then 1 else 0 end,
    failure_count = failure_count + case when p_status = 'failure' then 1 else 0 end,
    cancelled_count = cancelled_count + case when p_status = 'cancelled' then 1 else 0 end,
    output_units = output_units + p_output_units,
    total_latency_ms = total_latency_ms + p_latency_ms,
    estimated_cost_micros = estimated_cost_micros + p_estimated_cost_micros,
    cost_estimate_complete = cost_estimate_complete and p_cost_estimate_complete,
    updated_at = now()
    where user_id = v_active.user_id and provider = v_active.provider
      and usage_date = (v_active.started_at at time zone 'utc')::date;
  return true;
end;
$$;

revoke all on function public.reserve_provider_usage(text, bigint) from public, anon;
revoke all on function public.complete_provider_usage(uuid, text, integer, bigint, bigint, boolean) from public, anon;
grant execute on function public.reserve_provider_usage(text, bigint) to authenticated;
grant execute on function public.complete_provider_usage(uuid, text, integer, bigint, bigint, boolean) to authenticated;
