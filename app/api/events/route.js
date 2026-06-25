import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_OWNER_ID,
  PEOPLE,
  getBerlinDateKey,
  getDateLockReason,
  isValidOwnerId,
  isWritableDateKey,
} from "../../../lib/calendar.js";
import {
  hasDigestRun,
  readEvents,
  readOwnerPasswords,
  writeEvents,
  writeOwnerPasswords,
} from "../../../lib/storage.js";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^$|^([01]\d|2[0-3]):[0-5]\d$/;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_ITERATIONS = 120000;

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function cleanPassword(input) {
  return typeof input.ownerPassword === "string" ? input.ownerPassword : "";
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");

  return { salt, hash, createdAt: new Date().toISOString() };
}

function verifyPassword(password, record) {
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hashPassword(password, record.salt).hash, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cleanEvent(input, id) {
  const date = typeof input.date === "string" ? input.date : "";
  const time = typeof input.time === "string" ? input.time : "";
  const ownerId = typeof input.ownerId === "string" ? input.ownerId : DEFAULT_OWNER_ID;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";

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

  return {
    id,
    date,
    time,
    ownerId,
    title: title.slice(0, 120),
    note: note.slice(0, 300),
  };
}

async function getWriteContext() {
  const todayKey = getBerlinDateKey();
  const todayLocked = await hasDigestRun(todayKey);

  return { todayKey, todayLocked };
}

function assertWritableDate(dateKey, context) {
  if (!isWritableDateKey(dateKey, context)) {
    throw new Error(getDateLockReason(dateKey, context));
  }
}

async function authorizeOwner(ownerId, password, { allowCreate = false } = {}) {
  if (password.trim().length < PASSWORD_MIN_LENGTH) {
    throw new Error("Пароль должен быть минимум 4 символа");
  }

  const passwords = await readOwnerPasswords();
  const record = passwords[ownerId];

  if (!record) {
    if (!allowCreate) {
      throw new Error("Сначала создайте первое дело с паролем этого человека");
    }

    const nextPasswords = {
      ...passwords,
      [ownerId]: hashPassword(password),
    };
    await writeOwnerPasswords(nextPasswords);
    return { created: true };
  }

  if (!verifyPassword(password, record)) {
    throw new Error("Неверный пароль");
  }

  return { created: false };
}

export async function GET() {
  const todayKey = getBerlinDateKey();
  const [events, todayLocked, ownerPasswords] = await Promise.all([
    readEvents(),
    hasDigestRun(todayKey),
    readOwnerPasswords(),
  ]);
  const ownerPasswordStatus = Object.fromEntries(
    PEOPLE.map((person) => [person.id, Boolean(ownerPasswords[person.id])]),
  );

  return Response.json({ ok: true, events, todayKey, todayLocked, people: PEOPLE, ownerPasswordStatus });
}

export async function POST(request) {
  try {
    const input = await request.json();
    const context = await getWriteContext();
    const nextEvent = cleanEvent(input, randomUUID());
    assertWritableDate(nextEvent.date, context);
    await authorizeOwner(nextEvent.ownerId, cleanPassword(input), { allowCreate: true });

    const events = await readEvents();
    const nextEvents = await writeEvents([...events, nextEvent]);

    return Response.json({ ok: true, event: nextEvent, events: nextEvents }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось добавить");
  }
}

export async function PUT(request) {
  try {
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

    const context = await getWriteContext();
    const nextEvent = cleanEvent(input, id);
    assertWritableDate(events[index].date, context);
    assertWritableDate(nextEvent.date, context);

    if (nextEvent.ownerId !== events[index].ownerId) {
      throw new Error("Человека у существующего дела менять нельзя");
    }

    await authorizeOwner(events[index].ownerId, cleanPassword(input));

    const nextEvents = [...events];
    nextEvents[index] = nextEvent;

    return Response.json({ ok: true, event: nextEvent, events: await writeEvents(nextEvents) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось сохранить");
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const input = await request.json().catch(() => ({}));
    const ownerPassword =
      typeof input.ownerPassword === "string" ? input.ownerPassword : url.searchParams.get("ownerPassword") || "";

    if (!id) {
      return jsonError("Не найден id");
    }

    const events = await readEvents();
    const target = events.find((event) => event.id === id);

    if (!target) {
      return jsonError("Дело не найдено", 404);
    }

    const context = await getWriteContext();
    assertWritableDate(target.date, context);
    await authorizeOwner(target.ownerId, ownerPassword);

    const nextEvents = events.filter((event) => event.id !== id);

    return Response.json({ ok: true, events: await writeEvents(nextEvents) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось удалить");
  }
}
