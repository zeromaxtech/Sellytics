-- Read-only preflight for 002_orders_feed.sql.
-- Run this in the Supabase SQL editor and paste the output before applying
-- the migration if your store_connections table was created by an older
-- version of the app. It does not modify anything.

-- 1. Which related tables already exist?
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('store_connections', 'orders_feed', 'daily_tips')
order by table_name;

-- 2. Exact columns and types in store_connections.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'store_connections'
order by ordinal_position;

-- 3. Constraints, including the unique (user_id, platform) target used by
--    the connect-printify upsert and the auth.users foreign key.
select c.conname, c.contype, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'store_connections'
order by c.conname;

-- 4. If orders_feed already exists, show its columns before re-running 002.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders_feed'
order by ordinal_position;

-- Expected for the current app:
--   store_connections.user_id       uuid
--   store_connections.platform      text
--   store_connections.encrypted_token text
--   unique constraint on (user_id, platform)
--   store_connections.shop_id       text   (added by 002)
--   store_connections.shop_title    text   (added by 002)
--   orders_feed.user_id             uuid references auth.users(id)
