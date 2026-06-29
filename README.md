# Daily Calendar Digest

Responsive monthly family calendar with a daily Telegram digest.

## Storage

Production stores events, owner password hashes, and daily digest run markers in Upstash Redis connected through Vercel Marketplace. The app supports these Redis env pairs:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- `REDIS_REST_API_URL` and `REDIS_REST_API_TOKEN`

Local development falls back to JSON files:

- `data/*.local.json`

Documents are stored in Vercel Blob. File bytes are encrypted before upload; Redis stores only the encrypted file URL and the decryption metadata needed by the app.

## Calendar Rules

- The month opens without the details panel.
- The page auto-syncs events in the background every 6 seconds.
- Past days can be opened for viewing only, including days with no events.
- Today is writable only before `06:00` Berlin time and before the daily digest is processed.
- After `06:00` Berlin time or after the cron runs, today becomes view-only too.
- Each event belongs to exactly one person: Elena, Anton, Kristina, or Alexey.
- Login uses existing accounts for Elena, Anton, and Kristina. Alexey has events but no separate account.
- Passwords are stored as salted hashes, not plain text.
- Each account can optionally enable a phone-style graphic key as a second login step.
- Only Kristina can create private events, and only for Kristina.
- Private events are hidden from other accounts and from the main Telegram channel.
- Removed documents are not physically deleted. They leave the active event view and stay downloadable from event history and the deleted-events archive.

## Telegram

The main channel receives the full daily digest for all four people.

Optional personal recipient uses env vars:

- `TELEGRAM_CHAT_ID_KRISTINA` receives Kristina.

Telegram bots can send a personal message only after that user opens the bot and sends `/start` or any message once.

Telegram messages include event notes and document names, but not public document links. Files are downloaded through the calendar after login.

## Files

- `app/page.js` - monthly calendar UI.
- `app/api/events/route.js` - create, update, delete, and read events.
- `app/api/events/attachments/route.js` - encrypted document upload/download and soft removal.
- `app/api/auth/graphic-key/route.js` - optional graphic key setup.
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
