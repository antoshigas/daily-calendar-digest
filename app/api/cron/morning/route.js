import { createDecipheriv } from "node:crypto";
import {
  buildPersonalTelegramMessage,
  buildTelegramMessage,
  expandEventsForDate,
  getBerlinDateKey,
  getPersonName,
} from "../../../../lib/calendar.js";
import { hasDigestRun, markDigestRun, readEvents } from "../../../../lib/storage.js";

export const dynamic = "force-dynamic";

const PERSONAL_RECIPIENTS = [
  {
    id: "kristina",
    envName: "TELEGRAM_CHAT_ID_KRISTINA",
    ownerIds: ["kristina"],
  },
];

async function sendTelegramMessage(text, chatId = process.env.TELEGRAM_CHAT_ID) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

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

function decryptAttachment(buffer, attachment) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(attachment.key, "base64url"),
    Buffer.from(attachment.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(attachment.tag, "base64url"));

  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function buildAttachmentCaption(event) {
  const time = event.time ? ` · ${event.time}` : "";
  return `📎 До справи: ${getPersonName(event.ownerId)} — ${event.title}${time}`;
}

async function sendTelegramDocument(attachment, caption, chatId = process.env.TELEGRAM_CHAT_ID) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }

  const blobResponse = await fetch(attachment.blobUrl, { cache: "no-store" });
  if (!blobResponse.ok) {
    throw new Error(`Blob fetch failed with status ${blobResponse.status}`);
  }

  const decrypted = decryptAttachment(Buffer.from(await blobResponse.arrayBuffer()), attachment);
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("caption", caption.slice(0, 1024));
  formData.append(
    "document",
    new Blob([decrypted], { type: attachment.type || "application/octet-stream" }),
    attachment.name,
  );

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram sendDocument failed with status ${response.status}`);
  }
}

async function sendEventAttachments(events, chatId) {
  const results = [];

  for (const event of events) {
    for (const attachment of event.attachments || []) {
      try {
        await sendTelegramDocument(attachment, buildAttachmentCaption(event), chatId);
        results.push({ eventId: event.id, name: attachment.name, sent: true });
      } catch (error) {
        results.push({
          eventId: event.id,
          name: attachment.name,
          sent: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  return results;
}

async function sendPersonalTelegramMessages(events, now, { test = false } = {}) {
  const results = [];

  for (const recipient of PERSONAL_RECIPIENTS) {
    const chatId = process.env[recipient.envName];

    if (!chatId) {
      results.push({ id: recipient.id, sent: false, skipped: true });
      continue;
    }

    try {
      const text = buildPersonalTelegramMessage(recipient.ownerIds, events, now);
      await sendTelegramMessage(test ? `Тест календаря\n\n${text}` : text, chatId);
      const ownerSet = new Set(recipient.ownerIds);
      const attachments = await sendEventAttachments(
        events.filter((event) => ownerSet.has(event.ownerId)),
        chatId,
      );
      results.push({ id: recipient.id, sent: true, skipped: false, attachments });
    } catch (error) {
      results.push({
        id: recipient.id,
        sent: false,
        skipped: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
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
    const todaysEvents = expandEventsForDate(events, today);
    const todaysPublicEvents = todaysEvents.filter((event) => !event.private);
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
        attachmentPreviews: todaysPublicEvents.flatMap((event) =>
          (event.attachments || []).map((attachment) => ({
            name: attachment.name,
            caption: buildAttachmentCaption(event),
          })),
        ),
        personalPreviews: PERSONAL_RECIPIENTS.map((recipient) => ({
          id: recipient.id,
          configured: Boolean(process.env[recipient.envName]),
          message: buildPersonalTelegramMessage(recipient.ownerIds, todaysEvents, now),
        })),
      });
    }

    if (testSend) {
      await sendTelegramMessage(`Тест календаря\n\n${message}`);
      const attachmentResults = await sendEventAttachments(todaysPublicEvents);
      const personalResults = await sendPersonalTelegramMessages(todaysEvents, now, { test: true });

      return Response.json({
        ok: true,
        sent: true,
        test: true,
        lockedToday: false,
        date: today,
        count: todaysEvents.length,
        attachmentResults,
        personalResults,
      });
    }

    await sendTelegramMessage(message);
    const attachmentResults = await sendEventAttachments(todaysPublicEvents);
    const personalResults = await sendPersonalTelegramMessages(todaysEvents, now);
    await markDigestRun(today);

    return Response.json({
      ok: true,
      sent: true,
      date: today,
      count: todaysEvents.length,
      attachmentResults,
      personalResults,
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
