-- Sellytics: live order feed for Printify webhooks.
-- Run once in the Supabase SQL editor (after 001_daily_tips.sql).

-- Webhooks arrive with a shop_id, not a user_id. Save the shop id when
-- the user connects / loads their dashboard so we can route events.
alter table public.store_connections
  add column if not exists shop_id text;

alter table public.store_connections
  add column if not exists shop_title text;

create index if not exists store_connections_shop_id_idx
  on public.store_connections (shop_id);

create table if not exists public.orders_feed (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  store_id           text,
  printify_order_id  text not null unique,
  status             text not null default 'new'
                     check (status in ('new', 'in_production', 'shipped', 'delivered', 'problem', 'canceled')),
  tracking_number    text,
  carrier            text,
  total              numeric(12, 2),
  currency           text default 'USD',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  raw                jsonb
);

create index if not exists orders_feed_user_created_idx
  on public.orders_feed (user_id, created_at desc);

-- Users may read only their own order rows. Inserts/updates/deletes are
-- performed by the server with the service-role key, which bypasses RLS.
alter table public.orders_feed enable row level security;

drop policy if exists "orders feed read own" on public.orders_feed;
create policy "orders feed read own"
  on public.orders_feed
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.touch_orders_feed_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_feed_touch_updated_at on public.orders_feed;
create trigger orders_feed_touch_updated_at
  before update on public.orders_feed
  for each row execute function public.touch_orders_feed_updated_at();

-- Supabase Realtime: publish changes so the dashboard can subscribe.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders_feed'
  ) then
    alter publication supabase_realtime add table public.orders_feed;
  end if;
end;
$$;
