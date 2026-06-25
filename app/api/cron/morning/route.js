import { buildTelegramMessage, getBerlinDateKey } from "../../../../lib/calendar.js";
import { hasDigestRun, markDigestRun, readEvents } from "../../../../lib/storage.js";

export const dynamic = "force-dynamic";

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram sendMessage failed with status ${response.status}`);
  }
}

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl
      ? request.nextUrl.searchParams
      : new URL(request.url).searchParams;
    const dryRun = searchParams.get("dryRun") === "1" || process.env.DRY_RUN === "1";
    const testSend = searchParams.get("test") === "1";
    const now = new Date();
    const today = getBerlinDateKey(now);
    const events = await readEvents();
    const todaysEvents = events.filter((event) => event.date === today);
    const alreadyRun = await hasDigestRun(today);
    const message = buildTelegramMessage(todaysEvents, now);

    if (alreadyRun && !dryRun && !testSend) {
      return Response.json({
        ok: true,
        sent: false,
        alreadyRun: true,
        date: today,
        count: todaysEvents.length,
      });
    }

    if (dryRun) {
      return Response.json({
        ok: true,
        sent: false,
        dryRun: true,
        date: today,
        count: todaysEvents.length,
        message,
      });
    }

    if (testSend) {
      await sendTelegramMessage(`Тест календаря\n\n${message}`);

      return Response.json({
        ok: true,
        sent: true,
        test: true,
        lockedToday: false,
        date: today,
        count: todaysEvents.length,
      });
    }

    await sendTelegramMessage(message);
    await markDigestRun(today);

    return Response.json({
      ok: true,
      sent: true,
      date: today,
      count: todaysEvents.length,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
