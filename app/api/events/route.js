import { randomUUID } from "node:crypto";
import { getPublicAccountsWithSecurity, requireSessionAccount } from "../../../lib/auth.js";
import {
  DEFAULT_OWNER_ID,
  PEOPLE,
  filterVisibleEvents,
  getBerlinDateKey,
  getDateLockReason,
  getPersonName,
  isTodayAfterDigestTime,
  isValidOwnerId,
  isWritableDateKey,
  formatRepeatLabel,
  normalizeOwnerId,
  normalizeRepeat,
  occursOnDate,
  sortEvents,
} from "../../../lib/calendar.js";
import {
  hasDigestRun,
  readDeletedEvents,
  readEvents,
  writeDeletedEvents,
  writeEvents,
} from "../../../lib/storage.js";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^$|^([01]\d|2[0-3]):[0-5]\d$/;
const TRACKED_FIELDS = ["date", "time", "ownerId", "title", "note", "private", "repeat"];

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function getErrorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 400;
}

function cleanEvent(input, id, account, previousEvent = null) {
  const date = typeof input.date === "string" ? input.date : "";
  const time = typeof input.time === "string" ? input.time : "";
  const ownerId = normalizeOwnerId(typeof input.ownerId === "string" ? input.ownerId : DEFAULT_OWNER_ID);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const privateRequested = Boolean(input.private);
  const repeat = normalizeRepeat(input.repeat);

  if (!DATE_PATTERN.test(date)) {
    throw new Error("Невірна дата");
  }

  if (repeat && repeat.until && repeat.until < date) {
    throw new Error("Дата завершення повтору раніше за його початок");
  }

  if (!TIME_PATTERN.test(time)) {
    throw new Error("Невірний час");
  }

  if (!isValidOwnerId(ownerId)) {
    throw new Error("Оберіть людину");
  }

  if (!title) {
    throw new Error("Введіть справу");
  }

  if (privateRequested && (account.id !== "kristina" || ownerId !== "kristina")) {
    throw new Error("Приватні справи недоступні в цій версії");
  }

  return {
    id,
    date,
    time,
    ownerId,
    title: title.slice(0, 120),
    note: note.slice(0, 300),
    private: ownerId === "kristina" && account.id === "kristina" && privateRequested,
    repeat,
    skipDates: repeat ? previousEvent?.skipDates || [] : [],
    createdBy: previousEvent?.createdBy || account.id,
    createdAt: previousEvent?.createdAt || new Date().toISOString(),
    updatedBy: account.id,
    updatedAt: new Date().toISOString(),
    attachments: previousEvent?.attachments || [],
    removedAttachments: previousEvent?.removedAttachments || [],
    history: previousEvent?.history || [],
  };
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

function serializeAttachment(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    uploadedBy: attachment.uploadedBy,
    uploadedAt: attachment.uploadedAt,
    removedBy: attachment.removedBy || "",
    removedAt: attachment.removedAt || "",
  };
}

function serializeEvent(event) {
  return {
    ...event,
    attachments: (event.attachments || []).map(serializeAttachment),
    removedAttachments: (event.removedAttachments || []).map(serializeAttachment),
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

function fieldLabel(field) {
  return {
    date: "дата",
    time: "час",
    ownerId: "людина",
    title: "справа",
    note: "нотатка",
    private: "приватність",
    repeat: "повтор",
  }[field];
}

function displayFieldValue(field, value) {
  if (field === "ownerId") return getPersonName(value);
  if (field === "private") return value ? "приватна" : "звичайна";
  if (field === "time") return value || "без часу";
  if (field === "repeat") return value ? formatRepeatLabel(value) : "без повтору";
  return value || "порожньо";
}

function comparableFieldValue(field, value) {
  if (field === "repeat") return JSON.stringify(value || null);
  return value || "";
}

function buildChanges(previousEvent, nextEvent) {
  return Object.fromEntries(
    TRACKED_FIELDS.filter(
      (field) => comparableFieldValue(field, previousEvent[field]) !== comparableFieldValue(field, nextEvent[field]),
    ).map((field) => [
      field,
      {
        label: fieldLabel(field),
        before: displayFieldValue(field, previousEvent[field]),
        after: displayFieldValue(field, nextEvent[field]),
      },
    ]),
  );
}

function createHistoryEntry(type, account, summary, changes = {}) {
  return {
    id: randomUUID(),
    type,
    actorId: account.id,
    at: new Date().toISOString(),
    summary,
    changes,
  };
}

function appendHistory(event, entry) {
  return {
    ...event,
    history: [...(event.history || []), entry],
  };
}

function assertEventVisible(event, account) {
  if (event.private && account.id !== "kristina") {
    const error = new Error("Справу не знайдено");
    error.status = 404;
    throw error;
  }
}

export async function GET(request) {
  try {
    const account = await requireSessionAccount(request);
    const todayKey = getBerlinDateKey();
    const todayAfterDigest = isTodayAfterDigestTime();
    const [events, deletedEvents, todayLocked] = await Promise.all([
      readEvents(),
      readDeletedEvents(),
      hasDigestRun(todayKey),
    ]);

    return Response.json({
      ok: true,
      account,
      accounts: await getPublicAccountsWithSecurity(),
      events: serializeEvents(events, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
      todayKey,
      todayLocked,
      todayAfterDigest,
      people: PEOPLE,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не вдалося завантажити справи", getErrorStatus(error));
  }
}

export async function POST(request) {
  try {
    const account = await requireSessionAccount(request);
    const input = await request.json();
    const context = await getWriteContext();
    const nextEvent = cleanEvent(input, randomUUID(), account);
    assertWritableDate(nextEvent.date, context);

    const createdEvent = appendHistory(
      nextEvent,
      createHistoryEntry("created", account, `Створив(ла) ${account.name}`),
    );
    const events = await readEvents();
    const nextEvents = await writeEvents([...events, createdEvent]);
    const deletedEvents = await readDeletedEvents();

    return Response.json(
      {
        ok: true,
        event: serializeEvent(createdEvent),
        events: serializeEvents(nextEvents, account),
        deletedEvents: serializeDeletedEvents(deletedEvents, account),
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не вдалося додати", getErrorStatus(error));
  }
}

export async function PUT(request) {
  try {
    const account = await requireSessionAccount(request);
    const input = await request.json();
    const id = typeof input.id === "string" ? input.id : "";

    if (!id) {
      return jsonError("Не знайдено id");
    }

    const events = await readEvents();
    const index = events.findIndex((event) => event.id === id);

    if (index === -1) {
      return jsonError("Справу не знайдено", 404);
    }

    assertEventVisible(events[index], account);

    const context = await getWriteContext();
    const nextEvent = cleanEvent(input, id, account, events[index]);
    if (!events[index].repeat) {
      assertWritableDate(events[index].date, context);
    }
    if (!nextEvent.repeat || nextEvent.date !== events[index].date) {
      assertWritableDate(nextEvent.date, context);
    }

    const changes = buildChanges(events[index], nextEvent);
    const eventToStore =
      Object.keys(changes).length === 0
        ? nextEvent
        : appendHistory(nextEvent, createHistoryEntry("updated", account, `Змінив(ла) ${account.name}`, changes));
    const nextEvents = [...events];
    nextEvents[index] = eventToStore;
    const storedEvents = await writeEvents(nextEvents);
    const deletedEvents = await readDeletedEvents();

    return Response.json({
      ok: true,
      event: serializeEvent(eventToStore),
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не вдалося зберегти", getErrorStatus(error));
  }
}

export async function DELETE(request) {
  try {
    const account = await requireSessionAccount(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const occurrence = url.searchParams.get("occurrence") || "";

    if (!id) {
      return jsonError("Не знайдено id");
    }

    const events = await readEvents();
    const target = events.find((event) => event.id === id);

    if (!target) {
      return jsonError("Справу не знайдено", 404);
    }

    assertEventVisible(target, account);

    const context = await getWriteContext();

    if (occurrence && target.repeat) {
      if (!DATE_PATTERN.test(occurrence) || !occursOnDate(target, occurrence)) {
        return jsonError("Повтор на цей день не знайдено", 404);
      }

      assertWritableDate(occurrence, context);

      const skippedEvent = appendHistory(
        {
          ...target,
          skipDates: [...(target.skipDates || []), occurrence],
          updatedBy: account.id,
          updatedAt: new Date().toISOString(),
        },
        createHistoryEntry("updated", account, `Прибрав(ла) повтор ${account.name}`, {
          repeat: {
            label: "повтор",
            before: displayFieldValue("date", occurrence),
            after: "прибрано цей день",
          },
        }),
      );
      const storedEvents = await writeEvents(events.map((event) => (event.id === id ? skippedEvent : event)));
      const deletedEvents = await readDeletedEvents();

      return Response.json({
        ok: true,
        events: serializeEvents(storedEvents, account),
        deletedEvents: serializeDeletedEvents(deletedEvents, account),
      });
    }

    if (!target.repeat) {
      assertWritableDate(target.date, context);
    }

    const deletedAt = new Date().toISOString();
    const deletedRecord = appendHistory(
      {
        ...target,
        updatedBy: account.id,
        updatedAt: deletedAt,
        deletedBy: account.id,
        deletedAt,
      },
      createHistoryEntry("deleted", account, `Видалив(ла) ${account.name}`),
    );
    const storedEvents = await writeEvents(events.filter((event) => event.id !== id));
    const storedDeletedEvents = await writeDeletedEvents([deletedRecord, ...(await readDeletedEvents())]);

    return Response.json({
      ok: true,
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(storedDeletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не вдалося видалити", getErrorStatus(error));
  }
}
