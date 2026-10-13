-- Who has a trial, who has Premium, and which device syncs on the free plan.
-- Rows are keyed like reader_grants: an HMAC of the Google id (never the id).
-- Only the functions below reach the table (row level security, no policies).
create table if not exists public.reader_plans (
  k text primary key check (k ~ '^[0-9a-f]{64}$'),
  trial_started timestamptz not null default now(),
  -- Set by purchase verification (Google Play / App Store); null: no purchase.
  premium_until timestamptz,
  premium_source text,
  -- The one device that may sync on the free plan, and when it was chosen.
  sync_device text check (sync_device is null or length(sync_device) between 8 and 64),
  sync_device_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.reader_plans enable row level security;

-- A person's plan. The first call starts their trial and, when a device id is
-- given, makes it the sync device if none was chosen yet.
create or replace function public.reader_plan_get(p_k text, p_device text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare r public.reader_plans;
begin
  insert into public.reader_plans (k) values (p_k) on conflict (k) do nothing;
  if p_device is not null and length(p_device) between 8 and 64 then
    update public.reader_plans
      set sync_device = p_device, sync_device_at = now(), updated_at = now()
      where k = p_k and sync_device is null;
  end if;
  select * into r from public.reader_plans where k = p_k;
  return json_build_object(
    'trial_started', (extract(epoch from r.trial_started) * 1000)::bigint,
    'premium_until', (extract(epoch from r.premium_until) * 1000)::bigint,
    'sync_device', r.sync_device,
    'sync_device_at', (extract(epoch from r.sync_device_at) * 1000)::bigint
  );
end;
$$;

-- Moves the free plan's sync to another device. Allowed once a day, so the
-- choice cannot simply be flipped back and forth.
create or replace function public.reader_plan_move_sync(p_k text, p_device text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare r public.reader_plans; moved boolean := false;
begin
  if p_device is null or length(p_device) not between 8 and 64 then
    raise exception 'bad device';
  end if;
  insert into public.reader_plans (k) values (p_k) on conflict (k) do nothing;
  update public.reader_plans
    set sync_device = p_device, sync_device_at = now(), updated_at = now()
    where k = p_k and (sync_device is null or sync_device = p_device
      or sync_device_at is null or sync_device_at < now() - interval '1 day');
  moved := found;
  select * into r from public.reader_plans where k = p_k;
  return json_build_object(
    'moved', moved,
    'sync_device', r.sync_device,
    'sync_device_at', (extract(epoch from r.sync_device_at) * 1000)::bigint
  );
end;
$$;

revoke all on function public.reader_plan_get(text, text) from public, authenticated;
revoke all on function public.reader_plan_move_sync(text, text) from public, authenticated;
grant execute on function public.reader_plan_get(text, text) to anon, service_role;
grant execute on function public.reader_plan_move_sync(text, text) to anon, service_role;
