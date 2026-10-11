-- Sellytics: daily tips cache (replaces the old data/daily-tips.json file).
-- Run once in the Supabase SQL editor.

create table if not exists public.daily_tips (
  date       date        not null primary key,
  content    jsonb       not null,
  created_at timestamptz not null default now()
);

-- Reads go through the publishable key (readTipsFromDb in server.js),
-- so anon/authenticated roles need SELECT. Tips contain no user data.
alter table public.daily_tips enable row level security;

create policy "daily tips are readable"
  on public.daily_tips
  for select
  to anon, authenticated
  using (true);

-- Writes (upsert ... on conflict (date)) go through the service-role key
-- (writeTipsToDb in server.js), which bypasses RLS. No write policies
-- are granted to anon/authenticated.
