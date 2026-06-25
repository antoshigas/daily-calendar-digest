# Daily Calendar Digest

Responsive monthly calendar with a daily Telegram digest.

## Storage

Production stores events and daily digest run markers in Upstash Redis connected through Vercel Marketplace. The app supports these Redis env pairs:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- `REDIS_REST_API_URL` and `REDIS_REST_API_TOKEN`

Local development falls back to JSON files:

- `data/events.local.json`
- `data/digest-runs.local.json`

## Calendar Rules

- Past empty days are inactive.
- Past days with events can be opened for viewing only.
- Today is writable until the daily cron endpoint runs.
- After the cron runs, today becomes view-only too.

## Files

- `app/page.js` - monthly calendar UI.
- `app/api/events/route.js` - create, update, delete, and read events.
- `app/api/cron/morning/route.js` - protected endpoint called by Vercel Cron.
- `vercel.json` - daily schedule at `04:00 UTC`, about `06:00` in Berlin during summer time.
- `.env.local` - local secrets. Do not commit it.

## Event Format

```json
[
  {
    "id": "doctor-2026-07-01",
    "date": "2026-07-01",
    "time": "09:30",
    "title": "Врач",
    "note": "Взять документы"
  }
]
```

## Local Run

```bash
npm install
npm run dev
```

## Deploy

1. Create or link a Vercel project from this folder or repository.
2. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `CRON_SECRET`.
3. Add an Upstash Redis integration in Vercel Marketplace.
4. Deploy.
5. Check Vercel Cron logs for `/api/cron/morning`.

For Hobby projects, Vercel may run the daily cron at any point inside the configured hour.

## Testing The Cron

Vercel Cron calls the same endpoint that can be tested manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://your-domain.vercel.app/api/cron/morning?dryRun=1"
```

`dryRun=1` returns the message payload without sending Telegram and without locking today.

To test the full flow, remove `dryRun=1`. That sends the Telegram message immediately and marks today as already processed, so today's date becomes view-only.
