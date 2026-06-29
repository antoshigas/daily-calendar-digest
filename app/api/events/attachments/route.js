import { del, put } from "@vercel/blob";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { requireSessionAccount } from "../../../../lib/auth.js";
import {
  filterVisibleEvents,
  getBerlinDateKey,
  getDateLockReason,
  isTodayAfterDigestTime,
  isWritableDateKey,
  sortEvents,
} from "../../../../lib/calendar.js";
import {
  hasDigestRun,
  readDeletedEvents,
  readEvents,
  writeEvents,
} from "../../../../lib/storage.js";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function getErrorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 400;
}

function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const error = new Error("Хранилище документов ещё не подключено. В Vercel нужен Blob store.");
    error.status = 501;
    throw error;
  }
}

async function getWriteContext() {
  const todayKey = getBerlinDateKey();
  const todayLocked = await hasDigestRun(todayKey);
  const todayAfterDigest = isTodayAfterDigestTime();

  return { todayKey, todayLocked, todayAfterDigest };
}

function assertWritableDate(dateKey, context) {
  if (!isWritableDateKey(dateKey, context)) {
    throw new Error(getDateLockReason(dateKey, context));
  }
}

function assertEventVisible(event, account) {
  if (event.private && account.id !== "kristina") {
    const error = new Error("Дело не найдено");
    error.status = 404;
    throw error;
  }
}

function serializeAttachment(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    uploadedBy: attachment.uploadedBy,
    uploadedAt: attachment.uploadedAt,
  };
}

function serializeEvent(event) {
  return {
    ...event,
    attachments: (event.attachments || []).map(serializeAttachment),
  };
}

function serializeEvents(events, account) {
  return sortEvents(filterVisibleEvents(events, account.id)).map(serializeEvent);
}

function serializeDeletedEvents(events, account) {
  return filterVisibleEvents(events, account.id)
    .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt) || left.date.localeCompare(right.date))
    .map(serializeEvent);
}

function createHistoryEntry(type, account, summary) {
  return {
    id: randomUUID(),
    type,
    actorId: account.id,
    at: new Date().toISOString(),
    summary,
    changes: {},
  };
}

function safeBlobName(name) {
  const fallback = "file";
  const cleaned = String(name || fallback)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return cleaned || fallback;
}

function encryptBuffer(buffer) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);

  return {
    encrypted,
    key: key.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptBuffer(buffer, attachment) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(attachment.key, "base64url"),
    Buffer.from(attachment.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(attachment.tag, "base64url"));

  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function buildContentDisposition(name) {
  const fallback = safeBlobName(name).replaceAll('"', "");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function findAttachmentEvent(events, eventId, attachmentId, account) {
  const event = events.find((item) => item.id === eventId);
  if (!event) return null;

  assertEventVisible(event, account);
  const attachment = (event.attachments || []).find((item) => item.id === attachmentId);
  if (!attachment) return null;

  return { event, attachment };
}

export async function GET(request) {
  try {
    const account = await requireSessionAccount(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId") || "";
    const attachmentId = url.searchParams.get("attachmentId") || "";
    const activeEvents = await readEvents();
    const deletedEvents = await readDeletedEvents();
    const found =
      findAttachmentEvent(activeEvents, eventId, attachmentId, account) ||
      findAttachmentEvent(deletedEvents, eventId, attachmentId, account);

    if (!found) {
      return jsonError("Файл не найден", 404);
    }

    const blobResponse = await fetch(found.attachment.blobUrl, { cache: "no-store" });
    if (!blobResponse.ok) {
      return jsonError("Файл не удалось загрузить из хранилища", 502);
    }

    const encrypted = Buffer.from(await blobResponse.arrayBuffer());
    const decrypted = decryptBuffer(encrypted, found.attachment);

    return new Response(decrypted, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": buildContentDisposition(found.attachment.name),
        "Content-Length": String(decrypted.length),
        "Content-Type": found.attachment.type || "application/octet-stream",
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось скачать файл", getErrorStatus(error));
  }
}

export async function POST(request) {
  try {
    assertBlobConfigured();
    const account = await requireSessionAccount(request);
    const formData = await request.formData();
    const eventId = String(formData.get("eventId") || "");
    const file = formData.get("file");

    if (!eventId) {
      return jsonError("Не найдено дело");
    }

    if (!file || typeof file.arrayBuffer !== "function") {
      return jsonError("Выберите файл");
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      return jsonError("Файл слишком большой. Сейчас лимит 4 МБ.");
    }

    const fileType = file.type || "application/octet-stream";
    if (!ALLOWED_ATTACHMENT_TYPES.has(fileType)) {
      return jsonError("Этот тип файла пока не разрешён");
    }

    const events = await readEvents();
    const index = events.findIndex((event) => event.id === eventId);
    if (index === -1) {
      return jsonError("Дело не найдено", 404);
    }

    const target = events[index];
    assertEventVisible(target, account);
    assertWritableDate(target.date, await getWriteContext());

    const bytes = Buffer.from(await file.arrayBuffer());
    const encrypted = encryptBuffer(bytes);
    const attachmentId = randomUUID();
    const safeName = safeBlobName(file.name);
    const blob = await put(`attachments/${target.id}/${attachmentId}-${safeName}.bin`, encrypted.encrypted, {
      access: "public",
      contentType: "application/octet-stream",
    });
    const now = new Date().toISOString();
    const attachment = {
      id: attachmentId,
      name: String(file.name || "Файл").trim().slice(0, 160) || "Файл",
      type: fileType,
      size: file.size,
      blobUrl: blob.url,
      key: encrypted.key,
      iv: encrypted.iv,
      tag: encrypted.tag,
      uploadedBy: account.id,
      uploadedAt: now,
    };
    const nextEvent = {
      ...target,
      attachments: [...(target.attachments || []), attachment],
      updatedBy: account.id,
      updatedAt: now,
      history: [
        ...(target.history || []),
        createHistoryEntry("attachment-added", account, `Прикрепил(а) файл: ${attachment.name}`),
      ],
    };
    const nextEvents = [...events];
    nextEvents[index] = nextEvent;
    const storedEvents = await writeEvents(nextEvents);
    const deletedEvents = await readDeletedEvents();

    return Response.json({
      ok: true,
      event: serializeEvent(nextEvent),
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось прикрепить файл", getErrorStatus(error));
  }
}

export async function DELETE(request) {
  try {
    const account = await requireSessionAccount(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId") || "";
    const attachmentId = url.searchParams.get("attachmentId") || "";
    const events = await readEvents();
    const index = events.findIndex((event) => event.id === eventId);

    if (index === -1) {
      return jsonError("Дело не найдено", 404);
    }

    const target = events[index];
    assertEventVisible(target, account);
    assertWritableDate(target.date, await getWriteContext());

    const attachment = (target.attachments || []).find((item) => item.id === attachmentId);
    if (!attachment) {
      return jsonError("Файл не найден", 404);
    }

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      await del(attachment.blobUrl).catch(() => {});
    }

    const now = new Date().toISOString();
    const nextEvent = {
      ...target,
      attachments: (target.attachments || []).filter((item) => item.id !== attachmentId),
      updatedBy: account.id,
      updatedAt: now,
      history: [
        ...(target.history || []),
        createHistoryEntry("attachment-deleted", account, `Удалил(а) файл: ${attachment.name}`),
      ],
    };
    const nextEvents = [...events];
    nextEvents[index] = nextEvent;
    const storedEvents = await writeEvents(nextEvents);
    const deletedEvents = await readDeletedEvents();

    return Response.json({
      ok: true,
      event: serializeEvent(nextEvent),
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось удалить файл", getErrorStatus(error));
  }
}
