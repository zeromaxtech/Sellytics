# Shop Digest — Local Prototype

Proves the core idea end-to-end before any web frontend, OAuth, or real database:
a business owner registers, connects their Printify store with their own API token
(never their password), and gets a digest of their shop activity.

## What's deliberately simplified for this local version

- **SQLite instead of Supabase** — same table shapes (`users`, `store_connections`),
  so moving to Supabase later is a connection change, not a rewrite
- **Printify only, not Etsy yet** — Printify uses a personal API token you generate
  yourself in its dashboard; Etsy requires an approved OAuth app, which takes longer
  to set up and isn't needed to test whether the core idea works
- **CLI menu instead of a website** — proves the logic before spending time on UI
- **No email delivery yet** — the digest just prints to the terminal for now

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# paste that output as ENCRYPTION_KEY= in .env
python main.py
```

## Try it

1. Register with any email/password (this is YOUR app's login, not Printify's)
2. Log in
3. Get a real Printify token: Printify dashboard → My Account → Connections →
   Generate API token — paste it when prompted
4. Run the digest — you should see your actual shop name and recent order count

## What's next, once this works

1. Add Etsy via OAuth (needs an approved Etsy app — apply early, it takes days)
2. Swap SQLite for a real Supabase project (same table design already matches)
3. Add email delivery (Resend/Postmark) instead of printing to terminal
4. Add a scheduled weekly run (cron / Supabase Edge Function + pg_cron)
5. Build the actual web frontend (signup, "Connect Printify" button, dashboard)
