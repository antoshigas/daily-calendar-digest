# Daily Calendar Digest

Responsive monthly calendar with a daily Telegram digest.

## Files

- `app/page.js` - monthly calendar UI.
- `app/api/events/route.js` - create, update, delete, and read events.
- `app/api/cron/morning/route.js` - protected endpoint called by Vercel Cron.
- `vercel.json` - daily schedule at `04:00 UTC`, about `06:00` in Berlin during summer time.
- `.env.local` - local secrets. Do not commit it.
- `data/events.local.json` - local fallback storage, created automatically.

## Event format

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

## Local run

```bash
npm install
npm run dev
```

Local data is stored in `data/events.local.json`. Production data should use Upstash Redis through `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, because serverless files are not persistent on Vercel.

## Deploy

1. Create a Vercel project from this folder or repository.
2. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `CRON_SECRET` from `.env.local`.
3. Add an Upstash Redis integration in Vercel Marketplace and expose `UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN`.
4. Deploy.
5. Check Vercel Cron logs for `/api/cron/morning`.

For Hobby projects, Vercel may run the daily cron at any point inside the configured hour.
