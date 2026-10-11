# Sellytics

A dashboard + digest email for print-on-demand sellers. Users register,
connect a Printify store with their own API token (stored encrypted with
AES-256-GCM), see live shop stats, and get a digest email — on demand or
automatically every morning.

## Features

- Email/password accounts (Supabase Auth, sessions via access tokens)
- Connect a Printify store with **your own API token** — never your
  password; tokens are encrypted at rest (AES-256-GCM) and decrypted
  only while making requests on your behalf
- Live shop stats: shop title + recent order count
- On-demand digest email (Gmail SMTP)
- Automatic daily digest via a Netlify scheduled function
  (06:00 UTC = 08:00 Berlin in summer)
- AI-generated daily tips (OpenRouter) — date/season prompt only,
  no user data — cached once per day in Supabase
- Account deletion cascades to your stored connections
- Privacy Policy, Terms of Service and Impressum pages

## Tech stack

| Layer | Technology |
| --- | --- |
| API | Express 5, wrapped with `serverless-http` |
| Hosting | Netlify (static publish dir + Functions) |
| Background job | Netlify scheduled function (`netlify.toml` cron) |
| Database + auth | Supabase (Postgres, Row Level Security) |
| Store data | Printify API, fetched live per request |
| Email | Gmail SMTP (nodemailer) |
| Daily tips | OpenRouter (generic guidance only) |

## Architecture

- **`server.js`** — all API routes. The Express app is exported;
  `app.listen` runs only in local development (`require.main === module`),
  so the same file serves Netlify Functions without a running server.
- **`netlify/functions/api.js`** — the Express app wrapped with
  `serverless-http`. Every API route is proxied to it by the
  `[[redirects]]` rules in `netlify.toml`.
- **`netlify/functions/daily-digest.js`** — scheduled function that
  replaces node-cron: generates today's tips, then emails every user
  with a connected store (the same work as `POST /run-digest`).
- **`public/`** — static frontend, published by Netlify.
- **`supabase/migrations/001_daily_tips.sql`** — creates the
  `daily_tips` table (replaces the old `data/daily-tips.json` cache).

## Setup (local)

```bash
npm install
cp .env.example .env   # fill in real values
npm start              # http://localhost:3000

# Trigger the digest manually (same work as the scheduled function):
curl -X POST localhost:3000/run-digest -H "x-cron-secret: $CRON_SECRET"
```

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | yes | public/anon key (alias: `SUPABASE_ANON_KEY`) |
| `SUPABASE_SECRET_KEY` | yes | service-role key (alias: `SUPABASE_SERVICE_ROLE_KEY`); server-side only — digest runs, tips upsert, account deletion |
| `ENCRYPTION_KEY` | yes | 64 hex chars = 32 bytes; AES-256-GCM key for Printify tokens |
| `CRON_SECRET` | yes | shared secret for `POST /run-digest` (sent as `X-Cron-Secret`) |
| `SMTP_HOST` | yes | Gmail SMTP host |
| `SMTP_PORT` | yes | Gmail SMTP port |
| `SMTP_USER` | yes | Gmail sender address |
| `SMTP_PASSWORD` | yes | Gmail app password |
| `OPENROUTER_API_KEY` | no | daily AI tips; the dashboard falls back to evergreen tips if unset |
| `OPENROUTER_MODEL` | no | defaults to `openai/gpt-4o-mini` |
| `TZ` | no | process timezone for date formatting; the schedule itself is always UTC |

## Daily tips: Supabase `daily_tips` table

The old `data/daily-tips.json` file cache was removed. Tips are cached
in Supabase (one row per day; `content` holds `tips` + `social`), so
nothing writes to the local filesystem. Run
`supabase/migrations/001_daily_tips.sql` once in the Supabase SQL
editor:

```sql
create table if not exists public.daily_tips (
  date       date        not null primary key,
  content    jsonb       not null,
  created_at timestamptz not null default now()
);

alter table public.daily_tips enable row level security;

create policy "daily tips are readable"
  on public.daily_tips
  for select
  to anon, authenticated
  using (true);
-- Writes (upsert ... on conflict (date)) use the service-role key,
-- which bypasses RLS; no write policies are granted.
```

## Runtime file I/O

**None.** The app never writes to the local filesystem: daily tips are
cached in the `daily_tips` table, and everything else is HTTP (Supabase,
Printify, Gmail SMTP, OpenRouter). Netlify Functions are read-only apart
from `/tmp`, which this app does not use.

## API routes (all unchanged)

`POST /register` · `POST /login` · `POST /connect-printify` ·
`GET /shop-stats` · `POST /send-digest` · `GET /daily-tips` ·
`POST /delete-account` · `POST /run-digest` (requires `X-Cron-Secret`
matching `CRON_SECRET`; fails closed when `CRON_SECRET` is unset)

## Roadmap

- Etsy connector (pending Etsy API approval — the dashboard button is
  already wired and disabled)
- Connect additional stores by shop link
- More platforms and digest formats

## Trademark

The term 'Etsy' is a trademark of Etsy, Inc. This application uses
Etsy's API, but is not endorsed or certified by Etsy. Sellytics is not
affiliated with, endorsed by, or certified by Etsy or Printify.

## Deploy to Netlify from GitHub

Environment variables to set in the Netlify dashboard
(Site configuration → Environment variables), in order:

1. `SUPABASE_URL`
2. `SUPABASE_PUBLISHABLE_KEY`
3. `SUPABASE_SECRET_KEY`
4. `ENCRYPTION_KEY`
5. `CRON_SECRET`
6. `SMTP_HOST`
7. `SMTP_PORT`
8. `SMTP_USER`
9. `SMTP_PASSWORD`
10. `OPENROUTER_API_KEY` *(optional — daily tips fall back to evergreen)*
11. `OPENROUTER_MODEL` *(optional — defaults to `openai/gpt-4o-mini`)*
12. `TZ` *(optional — e.g. `Europe/Berlin`)*

Deploy steps:

1. Commit and push the repo to GitHub:
   `git add . && git commit -m "Netlify deployment" && git push`
2. In Netlify, go to **Sites → Import from GitHub** and select this
   repository (build settings are read from `netlify.toml` — publish
   dir `public`, functions dir `netlify/functions`; leave the build
   command empty).
3. Set the environment variables listed above.
4. Deploy. Then run `supabase/migrations/001_daily_tips.sql` once in
   the Supabase SQL editor.
5. Verify: open the site, register, connect a Printify store, and
   check the Functions tab — `api` and `daily-digest` should appear.
   Scheduled functions run on **published deploys only**; use
   **Run now** in the Functions UI to test `daily-digest` without
   waiting for the schedule. Note the 30-second execution limit: with
   many connected users, move the digest loop to a background function.
