# Supabase setup

Backend for BuzzQuill accounts, cloud projects, and the contact form.

## 1. Apply the migrations

Run the SQL in [`migrations/`](migrations/) against your project — either:

- **Dashboard:** SQL Editor → paste each file → Run, or
- **CLI:** `supabase db push`

This creates the `contact_messages` table (insert-only via RLS; you read rows in
the dashboard).

## 2. Get pinged in Discord when someone uses the contact form

Optional — without this, submissions just sit in the table until you check it.

The flow: **someone submits → a row is inserted → a Database Webhook calls the
`contact-notify` Edge Function → it posts to a Discord channel.** The Discord
webhook URL lives in a function *secret*, never in the code.

1. **Discord webhook URL** — in your server, pick (or make) a private channel like
   `#contact`. *Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.*
2. **Deploy the function** — Supabase → *Edge Functions → Deploy a new function*,
   name it `contact-notify`, paste [`functions/contact-notify/index.ts`](functions/contact-notify/index.ts).
   Then *Manage secrets* and add:
   - `DISCORD_WEBHOOK_URL` — the URL from step 1
3. **Wire the webhook** — *Database → Webhooks → Create*: table `contact_messages`,
   event **Insert**, type **Supabase Edge Function** → `contact-notify`.
4. **Test** — submit the contact form in the app, watch the message appear in `#contact`.
