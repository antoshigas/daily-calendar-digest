import { randomUUID } from "node:crypto";
import { getPublicAccounts, requireSessionAccount } from "../../../lib/auth.js";
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
  normalizeOwnerId,
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
const TRACKED_FIELDS = ["date", "time", "ownerId", "title", "note", "private"];

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

  if (!DATE_PATTERN.test(date)) {
    throw new Error("Неверная дата");
  }

  if (!TIME_PATTERN.test(time)) {
    throw new Error("Неверное время");
  }

  if (!isValidOwnerId(ownerId)) {
    throw new Error("Выберите человека");
  }

  if (!title) {
    throw new Error("Введите дело");
  }

  if (privateRequested && (account.id !== "kristina" || ownerId !== "kristina")) {
    throw new Error("Частные дела доступны только аккаунту Кристины и только для Кристины");
  }

  return {
    id,
    date,
    time,
    ownerId,
    title: title.slice(0, 120),
    note: note.slice(0, 300),
    private: ownerId === "kristina" && account.id === "kristina" && privateRequested,
    createdBy: previousEvent?.createdBy || account.id,
    createdAt: previousEvent?.createdAt || new Date().toISOString(),
    updatedBy: account.id,
    updatedAt: new Date().toISOString(),
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

function serializeEvents(events, account) {
  return sortEvents(filterVisibleEvents(events, account.id));
}

function serializeDeletedEvents(events, account) {
  return filterVisibleEvents(events, account.id).sort(
    (left, right) => right.deletedAt.localeCompare(left.deletedAt) || left.date.localeCompare(right.date),
  );
}

function fieldLabel(field) {
  return {
    date: "дата",
    time: "время",
    ownerId: "человек",
    title: "дело",
    note: "заметка",
    private: "частность",
  }[field];
}

function displayFieldValue(field, value) {
  if (field === "ownerId") return getPersonName(value);
  if (field === "private") return value ? "частное" : "обычное";
  if (field === "time") return value || "без времени";
  return value || "пусто";
}

function buildChanges(previousEvent, nextEvent) {
  return Object.fromEntries(
    TRACKED_FIELDS.filter((field) => (previousEvent[field] || "") !== (nextEvent[field] || "")).map((field) => [
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
    const error = new Error("Дело не найдено");
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
      accounts: getPublicAccounts(),
      events: serializeEvents(events, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
      todayKey,
      todayLocked,
      todayAfterDigest,
      people: PEOPLE,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось загрузить дела", getErrorStatus(error));
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
      createHistoryEntry("created", account, `Создал(а) ${account.name}`),
    );
    const events = await readEvents();
    const nextEvents = await writeEvents([...events, createdEvent]);
    const deletedEvents = await readDeletedEvents();

    return Response.json(
      {
        ok: true,
        event: createdEvent,
        events: serializeEvents(nextEvents, account),
        deletedEvents: serializeDeletedEvents(deletedEvents, account),
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось добавить", getErrorStatus(error));
  }
}

export async function PUT(request) {
  try {
    const account = await requireSessionAccount(request);
    const input = await request.json();
    const id = typeof input.id === "string" ? input.id : "";

    if (!id) {
      return jsonError("Не найден id");
    }

    const events = await readEvents();
    const index = events.findIndex((event) => event.id === id);

    if (index === -1) {
      return jsonError("Дело не найдено", 404);
    }

    assertEventVisible(events[index], account);

    const context = await getWriteContext();
    const nextEvent = cleanEvent(input, id, account, events[index]);
    assertWritableDate(events[index].date, context);
    assertWritableDate(nextEvent.date, context);

    const changes = buildChanges(events[index], nextEvent);
    const eventToStore =
      Object.keys(changes).length === 0
        ? nextEvent
        : appendHistory(nextEvent, createHistoryEntry("updated", account, `Изменил(а) ${account.name}`, changes));
    const nextEvents = [...events];
    nextEvents[index] = eventToStore;
    const storedEvents = await writeEvents(nextEvents);
    const deletedEvents = await readDeletedEvents();

    return Response.json({
      ok: true,
      event: eventToStore,
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(deletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось сохранить", getErrorStatus(error));
  }
}

export async function DELETE(request) {
  try {
    const account = await requireSessionAccount(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return jsonError("Не найден id");
    }

    const events = await readEvents();
    const target = events.find((event) => event.id === id);

    if (!target) {
      return jsonError("Дело не найдено", 404);
    }

    assertEventVisible(target, account);

    const context = await getWriteContext();
    assertWritableDate(target.date, context);

    const deletedAt = new Date().toISOString();
    const deletedRecord = appendHistory(
      {
        ...target,
        updatedBy: account.id,
        updatedAt: deletedAt,
        deletedBy: account.id,
        deletedAt,
      },
      createHistoryEntry("deleted", account, `Удалил(а) ${account.name}`),
    );
    const storedEvents = await writeEvents(events.filter((event) => event.id !== id));
    const storedDeletedEvents = await writeDeletedEvents([deletedRecord, ...(await readDeletedEvents())]);

    return Response.json({
      ok: true,
      events: serializeEvents(storedEvents, account),
      deletedEvents: serializeDeletedEvents(storedDeletedEvents, account),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось удалить", getErrorStatus(error));
  }
}
