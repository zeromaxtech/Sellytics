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
- Live order feed via signature-verified Printify webhooks and
  Supabase Realtime (buyer PII stripped before storage)
- Browser push alerts for problem orders (VAPID web push), with
  `on-hold` / `payment-not-received` cancellation from the dashboard
- Installable PWA with an offline app shell (API data is never cached)
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
| `PRINTIFY_WEBHOOK_SECRET` | yes for live orders | shared secret used to verify `X-Pfy-Signature` on webhooks |
| `APP_BASE_URL` | yes for live orders | public site URL used when registering Printify webhooks |
| `DELAYED_SHIPPING_DAYS` | no | days in production before an order is flagged as a shipping problem; default `10` |
| `VAPID_PUBLIC_KEY` | no | web-push public key; sent to the browser via `/public-config` |
| `VAPID_PRIVATE_KEY` | no | web-push private key; server-side only |
| `VAPID_SUBJECT` | no | `mailto:` or `https:` contact URI required by the push spec |
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

## Live orders, issue alerts and PWA

1. Run `supabase/migrations/002_orders_feed.sql` and
   `supabase/migrations/003_alerts_push_rate_limit.sql` in the Supabase
   SQL editor.
2. Set `PRINTIFY_WEBHOOK_SECRET` and `APP_BASE_URL` in Netlify, then
   deploy. For push alerts, also run `npx web-push generate-vapid-keys`
   and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
3. Open the dashboard once (or reconnect Printify) so the server saves
   your `shop_id` on `store_connections`. Webhooks only carry a shop id,
   so existing rows need one dashboard load after the migration.
4. Click **Enable live updates** to register the six Printify webhooks.
   The same secret must be set in Netlify and in Printify.
5. Click **Enable alerts** to save a browser push subscription. On
   iPhone, add Sellytics to the Home Screen first; iOS only delivers
   web push to installed PWAs.

The cancel button is shown only for orders Printify allows to cancel
(`on-hold` or `payment-not-received`). The server re-checks the live
Printify status before calling the documented cancel endpoint.

## Runtime file I/O

**None.** The app never writes to the local filesystem: daily tips are
cached in the `daily_tips` table, and everything else is HTTP (Supabase,
Printify, Gmail SMTP, OpenRouter). Netlify Functions are read-only apart
from `/tmp`, which this app does not use.

## API routes

`POST /register` · `POST /login` · `POST /connect-printify` ·
`GET /shop-stats` · `POST /send-digest` · `GET /daily-tips` ·
`POST /delete-account` · `POST /run-digest` (requires `X-Cron-Secret`
matching `CRON_SECRET`; fails closed when `CRON_SECRET` is unset)

New routes:

- `GET /public-config` — public Supabase URL/anon key + VAPID public key
- `GET /orders` — signed-in user's live order feed (buyer PII stripped)
- `POST /orders/:id/cancel` — guarded Printify cancellation
- `POST /webhooks/printify` — signature-verified Printify receiver
- `POST /webhooks/register` — registers the six Printify topics
- `POST /push/subscribe` / `POST /push/unsubscribe` — web-push subscriptions

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
12. `PRINTIFY_WEBHOOK_SECRET` *(live orders; same value as in Printify)*
13. `APP_BASE_URL` *(live orders; e.g. `https://sellytics.netlify.app`)*
14. `DELAYED_SHIPPING_DAYS` *(optional — default `10`)*
15. `VAPID_PUBLIC_KEY` *(optional — push alerts)*
16. `VAPID_PRIVATE_KEY` *(optional — push alerts; server-side only)*
17. `VAPID_SUBJECT` *(optional — `mailto:` contact for push)*
18. `TZ` *(optional — e.g. `Europe/Berlin`)*

Deploy steps:

1. Commit and push the repo to GitHub:
   `git add . && git commit -m "Netlify deployment" && git push`
2. In Netlify, go to **Sites → Import from GitHub** and select this
   repository (build settings are read from `netlify.toml` — publish
   dir `public`, functions dir `netlify/functions`; leave the build
   command empty).
3. Set the environment variables listed above.
4. Deploy. Then run these migrations once in the Supabase SQL editor:
   `001_daily_tips.sql`, `002_orders_feed.sql`,
   `003_alerts_push_rate_limit.sql`.
5. Open the dashboard once (or reconnect Printify) to save your shop id,
   then click **Enable live updates** and **Enable alerts**.
6. Verify: open the site, register, connect a Printify store, and
   check the Functions tab — `api` and `daily-digest` should appear.
   Scheduled functions run on **published deploys only**; use
   **Run now** in the Functions UI to test `daily-digest` without
   waiting for the schedule. Note the 30-second execution limit: with
   many connected users, move the digest loop to a background function.
