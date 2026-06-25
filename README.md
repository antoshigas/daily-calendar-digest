# Daily Calendar Digest

Responsive monthly family calendar with a daily Telegram digest.

## Storage

Production stores events, owner password hashes, and daily digest run markers in Upstash Redis connected through Vercel Marketplace. The app supports these Redis env pairs:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- `REDIS_REST_API_URL` and `REDIS_REST_API_TOKEN`

Local development falls back to JSON files:

- `data/events.local.json`
- `data/digest-runs.local.json`
- `data/owner-passwords.local.json`

## Calendar Rules

- The month opens without the details panel.
- The page auto-syncs events every 18 seconds.
- Past empty days are inactive.
- Past days with events can be opened for viewing only.
- Today is writable only before `06:00` Berlin time and before the daily digest is processed.
- After `06:00` Berlin time or after the cron runs, today becomes view-only too.
- Each event belongs to exactly one person: Elena, Anton, Kristina, or Alexey.
- A person's password is created on their first event. Later create, edit, and delete actions for that person require the same password.
- Passwords are stored as salted hashes, not plain text.

## Telegram

The main channel receives the full daily digest for all four people.

Optional personal recipient uses env vars:

- `TELEGRAM_CHAT_ID_KRISTINA` receives Kristina.

Telegram bots can send a personal message only after that user opens the bot and sends `/start` or any message once.

## Files

- `app/page.js` - monthly calendar UI.
- `app/api/events/route.js` - create, update, delete, and read events.
- `app/api/cron/morning/route.js` - protected endpoint called by Vercel Cron.
- `vercel.json` - daily schedule at `04:00 UTC`, about `06:00` in Berlin during summer time.

## Testing The Cron

Preview without Telegram send and without locking today:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-domain.vercel.app/api/cron/morning?dryRun=1"
```

Send a real Telegram test message without locking today:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-domain.vercel.app/api/cron/morning?test=1"
```

To test the full flow, remove query parameters. That sends the Telegram message immediately and marks today as already processed.
