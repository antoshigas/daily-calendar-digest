export const TIME_ZONE = "Europe/Berlin";

export function getBerlinDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function keyToDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDaysToKey(dateKey, days) {
  const date = keyToDate(dateKey);
  date.setDate(date.getDate() + days);
  return getTodayKey(date);
}

export function isWritableDateKey(dateKey, { todayKey = getBerlinDateKey(), todayLocked = false } = {}) {
  return dateKey > todayKey || (dateKey === todayKey && !todayLocked);
}

export function getDateLockReason(dateKey, { todayKey = getBerlinDateKey(), todayLocked = false } = {}) {
  if (dateKey < todayKey) return "Прошлый день открыт только для просмотра";
  if (dateKey === todayKey && todayLocked) return "Рассылка за сегодня уже сработала";
  return "";
}

export function isSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

export function buildMonthCells(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date,
      key: getTodayKey(date),
    };
  });
}

export function formatMonthLabel(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDisplayDate(dateKey) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(keyToDate(dateKey));
}

export function formatBerlinDay(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function normalizeEvent(event) {
  return {
    id: String(event.id),
    date: String(event.date),
    time: event.time ? String(event.time) : "",
    title: String(event.title).trim(),
    note: event.note ? String(event.note).trim() : "",
  };
}

export function sortEvents(events) {
  return [...events].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    return (left.time || "99:99").localeCompare(right.time || "99:99");
  });
}

export function buildTelegramMessage(events, now = new Date()) {
  const lines = [`Сегодня, ${formatBerlinDay(now)}:`, ""];

  for (const event of sortEvents(events)) {
    const time = event.time || "весь день";
    const note = event.note ? ` - ${event.note}` : "";
    lines.push(`- ${time} - ${event.title}${note}`);
  }

  return lines.join("\n");
}
