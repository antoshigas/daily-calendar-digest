import { randomUUID } from "node:crypto";
import { readEvents, writeEvents } from "../../../lib/storage.js";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^$|^([01]\d|2[0-3]):[0-5]\d$/;

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function cleanEvent(input, id) {
  const date = typeof input.date === "string" ? input.date : "";
  const time = typeof input.time === "string" ? input.time : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";

  if (!DATE_PATTERN.test(date)) {
    throw new Error("Неверная дата");
  }

  if (!TIME_PATTERN.test(time)) {
    throw new Error("Неверное время");
  }

  if (!title) {
    throw new Error("Введите дело");
  }

  return {
    id,
    date,
    time,
    title: title.slice(0, 120),
    note: note.slice(0, 300),
  };
}

export async function GET() {
  const events = await readEvents();
  return Response.json({ ok: true, events });
}

export async function POST(request) {
  try {
    const input = await request.json();
    const events = await readEvents();
    const nextEvent = cleanEvent(input, randomUUID());
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

    const nextEvent = cleanEvent(input, id);
    const nextEvents = [...events];
    nextEvents[index] = nextEvent;

    return Response.json({ ok: true, event: nextEvent, events: await writeEvents(nextEvents) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось сохранить");
  }
}

export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    return jsonError("Не найден id");
  }

  const events = await readEvents();
  const nextEvents = events.filter((event) => event.id !== id);

  if (nextEvents.length === events.length) {
    return jsonError("Дело не найдено", 404);
  }

  return Response.json({ ok: true, events: await writeEvents(nextEvents) });
}
