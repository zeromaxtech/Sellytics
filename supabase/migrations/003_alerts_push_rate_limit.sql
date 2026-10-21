-- Sellytics: issue alerts, web-push subscriptions and contact rate limiting.
-- Run once in the Supabase SQL editor (after 002_orders_feed.sql).

-- ---------- Issue alerts ----------
create table if not exists public.alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  order_id           uuid references public.orders_feed(id) on delete set null,
  printify_order_id  text,
  type               text not null,
  message            text not null,
  created_at         timestamptz not null default now(),
  read_at            timestamptz
);

-- A webhook can be delivered more than once; keep one alert per issue type.
create unique index if not exists alerts_order_type_uidx
  on public.alerts (user_id, printify_order_id, type);

create index if not exists alerts_user_created_idx
  on public.alerts (user_id, created_at desc);

alter table public.alerts enable row level security;

drop policy if exists "alerts read own" on public.alerts;
create policy "alerts read own"
  on public.alerts
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------- Web-push subscriptions ----------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- The server uses the service-role key. This read policy only lets a
-- signed-in user see that their own subscription exists.
drop policy if exists "push subscriptions read own" on public.push_subscriptions;
create policy "push subscriptions read own"
  on public.push_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------- Contact rate limiting (5 per hour per IP) ----------
create table if not exists public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer not null default 0
);

create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No policies: only the service-role key may touch this table.

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  -- Keep the table small and avoid retaining hashed IPs indefinitely.
  delete from public.rate_limits
  where window_start < now() - interval '1 day';

  with upserted as (
    insert into public.rate_limits as rl (key, window_start, count)
    values (p_key, now(), 1)
    on conflict (key) do update
      set count = case
            when rl.window_start < now() - make_interval(secs => p_window_seconds)
              then 1
            else rl.count + 1
          end,
          window_start = case
            when rl.window_start < now() - make_interval(secs => p_window_seconds)
              then now()
            else rl.window_start
          end
    returning rl.count
  )
  select count <= p_limit into v_allowed from upserted;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;
