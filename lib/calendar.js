export const TIME_ZONE = "Europe/Berlin";
export const PEOPLE = [
  { id: "elena", name: "Елена" },
  { id: "anton", name: "Антон" },
  { id: "kristina", name: "Кристина" },
  { id: "alexey", name: "Алексей" },
];
export const ACCOUNTS = PEOPLE.filter((person) => person.id !== "alexey");
export const NO_TIME_LABEL = "без времени";
export const DEFAULT_OWNER_ID = PEOPLE[0].id;
export const DEFAULT_ACCOUNT_ID = ACCOUNTS[0].id;

export function normalizeOwnerId(ownerId) {
  if (ownerId === "stanislovas") return "kristina";
  return String(ownerId || DEFAULT_OWNER_ID);
}

export function isValidOwnerId(ownerId) {
  return PEOPLE.some((person) => person.id === normalizeOwnerId(ownerId));
}

export function normalizeAccountId(accountId) {
  if (accountId === "stanislovas") return "kristina";
  const normalized = String(accountId || DEFAULT_ACCOUNT_ID);
  return ACCOUNTS.some((person) => person.id === normalized) ? normalized : DEFAULT_ACCOUNT_ID;
}

export function isValidAccountId(accountId) {
  return ACCOUNTS.some((person) => person.id === normalizeAccountId(accountId));
}

export function getPersonName(ownerId) {
  return PEOPLE.find((person) => person.id === normalizeOwnerId(ownerId))?.name || "Без владельца";
}

export function getAccountName(accountId) {
  return ACCOUNTS.find((person) => person.id === normalizeAccountId(accountId))?.name || "Аккаунт";
}

export function getBerlinDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getBerlinHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );
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

export function isTodayAfterDigestTime(date = new Date(), digestHour = 6) {
  return getBerlinHour(date) >= digestHour;
}

export function isWritableDateKey(
  dateKey,
  { todayKey = getBerlinDateKey(), todayLocked = false, todayAfterDigest = isTodayAfterDigestTime() } = {},
) {
  return dateKey > todayKey || (dateKey === todayKey && !todayLocked && !todayAfterDigest);
}

export function getDateLockReason(
  dateKey,
  { todayKey = getBerlinDateKey(), todayLocked = false, todayAfterDigest = isTodayAfterDigestTime() } = {},
) {
  if (dateKey < todayKey) return "Этот день уже прошёл. Дела можно только посмотреть.";
  if (dateKey === todayKey && (todayLocked || todayAfterDigest)) {
    return "Рассылка на сегодня уже ушла. Дела можно только посмотреть.";
  }
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

export function normalizeAttachments(attachments) {
  const items = Array.isArray(attachments) ? attachments : [];

  return items
    .filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      id: String(attachment.id || ""),
      name: String(attachment.name || "Файл").trim().slice(0, 160) || "Файл",
      type: String(attachment.type || "application/octet-stream").slice(0, 120),
      size: Number.isFinite(Number(attachment.size)) ? Math.max(0, Number(attachment.size)) : 0,
      blobUrl: typeof attachment.blobUrl === "string" ? attachment.blobUrl : "",
      key: typeof attachment.key === "string" ? attachment.key : "",
      iv: typeof attachment.iv === "string" ? attachment.iv : "",
      tag: typeof attachment.tag === "string" ? attachment.tag : "",
      uploadedBy: normalizeOwnerId(attachment.uploadedBy || DEFAULT_OWNER_ID),
      uploadedAt:
        typeof attachment.uploadedAt === "string" && attachment.uploadedAt ? attachment.uploadedAt : new Date().toISOString(),
      removedBy: attachment.removedBy ? normalizeOwnerId(attachment.removedBy) : "",
      removedAt: typeof attachment.removedAt === "string" ? attachment.removedAt : "",
    }))
    .filter((attachment) => attachment.id && attachment.blobUrl && attachment.key && attachment.iv && attachment.tag)
    .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt));
}

const REPEAT_UNITS = ["day", "week", "month", "year"];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeRepeat(repeat) {
  if (!repeat || typeof repeat !== "object" || Array.isArray(repeat)) return null;
  if (!REPEAT_UNITS.includes(repeat.unit)) return null;

  const rawInterval = Number(repeat.interval);
  const interval = Number.isFinite(rawInterval) ? Math.min(99, Math.max(1, Math.round(rawInterval))) : 1;
  const until = typeof repeat.until === "string" && DATE_KEY_PATTERN.test(repeat.until) ? repeat.until : "";

  return { unit: repeat.unit, interval, until };
}

export function normalizeSkipDates(skipDates) {
  const items = Array.isArray(skipDates) ? skipDates : [];
  return [...new Set(items.filter((date) => typeof date === "string" && DATE_KEY_PATTERN.test(date)))].sort();
}

export function occursOnDate(event, dateKey) {
  if (!event.repeat) return event.date === dateKey;
  if (dateKey < event.date) return false;
  if (event.repeat.until && dateKey > event.repeat.until) return false;
  if ((event.skipDates || []).includes(dateKey)) return false;

  const start = keyToDate(event.date);
  const target = keyToDate(dateKey);
  const { unit, interval } = event.repeat;

  if (unit === "day" || unit === "week") {
    const days = Math.round((target - start) / 86400000);
    const step = unit === "week" ? interval * 7 : interval;
    return days % step === 0;
  }

  if (target.getDate() !== start.getDate()) return false;

  const months = (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
  if (unit === "month") return months % interval === 0;
  return months % (interval * 12) === 0;
}

export function expandEventsForDate(events, dateKey) {
  return events
    .filter((event) => occursOnDate(event, dateKey))
    .map((event) => (event.date === dateKey ? event : { ...event, date: dateKey }));
}

function pluralForm(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const REPEAT_EVERY_LABELS = {
  day: "каждый день",
  week: "каждую неделю",
  month: "каждый месяц",
  year: "каждый год",
};

const REPEAT_UNIT_FORMS = {
  day: ["день", "дня", "дней"],
  week: ["неделю", "недели", "недель"],
  month: ["месяц", "месяца", "месяцев"],
  year: ["год", "года", "лет"],
};

export function formatRepeatLabel(repeat) {
  if (!repeat) return "";

  const base =
    repeat.interval === 1
      ? REPEAT_EVERY_LABELS[repeat.unit]
      : `каждые ${repeat.interval} ${pluralForm(repeat.interval, REPEAT_UNIT_FORMS[repeat.unit])}`;

  if (!repeat.until) return base;

  const until = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "numeric", year: "numeric" }).format(
    keyToDate(repeat.until),
  );
  return `${base} до ${until}`;
}

export function normalizeEvent(event) {
  const ownerId = normalizeOwnerId(event.ownerId || event.owner || DEFAULT_OWNER_ID);
  const id = String(event.id);
  const createdAt = typeof event.createdAt === "string" && event.createdAt ? event.createdAt : new Date().toISOString();
  const updatedAt = typeof event.updatedAt === "string" && event.updatedAt ? event.updatedAt : createdAt;
  const createdBy = normalizeOwnerId(event.createdBy || ownerId);
  const updatedBy = normalizeOwnerId(event.updatedBy || event.createdBy || ownerId);

  return {
    id,
    date: String(event.date),
    time: event.time ? String(event.time) : "",
    ownerId: isValidOwnerId(ownerId) ? ownerId : DEFAULT_OWNER_ID,
    title: String(event.title).trim(),
    note: event.note ? String(event.note).trim() : "",
    private: ownerId === "kristina" && Boolean(event.private),
    repeat: normalizeRepeat(event.repeat),
    skipDates: normalizeRepeat(event.repeat) ? normalizeSkipDates(event.skipDates) : [],
    createdBy,
    createdAt,
    updatedBy,
    updatedAt,
    attachments: normalizeAttachments(event.attachments),
    removedAttachments: normalizeAttachments(event.removedAttachments),
    history: normalizeHistory(event.history, { id, actorId: createdBy, at: createdAt }),
  };
}

export function normalizeHistory(history, fallback = {}) {
  const items = Array.isArray(history) ? history : [];
  const normalized = items
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      id: String(entry.id || `${entry.type || "entry"}-${entry.at || fallback.at || index}`),
      type: typeof entry.type === "string" ? entry.type : "updated",
      actorId: normalizeOwnerId(entry.actorId || fallback.actorId || DEFAULT_OWNER_ID),
      at: typeof entry.at === "string" && entry.at ? entry.at : fallback.at || new Date().toISOString(),
      summary: typeof entry.summary === "string" ? entry.summary : "",
      changes: entry.changes && typeof entry.changes === "object" && !Array.isArray(entry.changes) ? entry.changes : {},
    }))
    .sort((left, right) => left.at.localeCompare(right.at));

  if (normalized.length > 0) return normalized;

  return [
    {
      id: `legacy-created-${fallback.id || "event"}`,
      type: "created",
      actorId: normalizeOwnerId(fallback.actorId || DEFAULT_OWNER_ID),
      at: fallback.at || new Date().toISOString(),
      summary: "Перенесено из старой версии",
      changes: {},
    },
  ];
}

export function isPrivateEventVisible(event, accountId) {
  return !event.private || normalizeAccountId(accountId) === "kristina";
}

export function filterVisibleEvents(events, accountId) {
  return events.filter((event) => isPrivateEventVisible(event, accountId));
}

export function sortEvents(events) {
  return [...events].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    const ownerCompare = getPersonName(left.ownerId).localeCompare(getPersonName(right.ownerId), "ru");
    if (ownerCompare !== 0) return ownerCompare;
    return (left.time || "99:99").localeCompare(right.time || "99:99");
  });
}

function formatAttachmentSummary(event) {
  const attachments = normalizeAttachments(event.attachments);
  if (attachments.length === 0) return "";

  const names = attachments.map((attachment) => attachment.name).join(", ");
  return ` - доки: ${names}`;
}

export function buildTelegramMessage(events, now = new Date()) {
  const lines = [`Сегодня, ${formatBerlinDay(now)}:`, ""];
  const publicEvents = events.filter((event) => !event.private);
  const eventsByOwner = publicEvents.reduce((groups, event) => {
    groups[event.ownerId] ||= [];
    groups[event.ownerId].push(event);
    return groups;
  }, {});

  for (const person of PEOPLE) {
    const personEvents = sortEvents(eventsByOwner[person.id] || []);
    lines.push(`${person.name}:`);

    if (personEvents.length === 0) {
      lines.push("- дел нет");
    } else {
      for (const event of personEvents) {
        const time = event.time || NO_TIME_LABEL;
        const note = event.note ? ` - ${event.note}` : "";
        const attachments = formatAttachmentSummary(event);
        lines.push(`- ${time} - ${event.title}${note}${attachments}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildPersonalTelegramMessage(ownerIds, events, now = new Date()) {
  const ownerSet = new Set(ownerIds);
  const people = PEOPLE.filter((person) => ownerSet.has(person.id));
  const eventsByOwner = events.reduce((groups, event) => {
    groups[event.ownerId] ||= [];
    groups[event.ownerId].push(event);
    return groups;
  }, {});
  const lines = [`Сегодня, ${formatBerlinDay(now)}:`, ""];

  for (const person of people) {
    const personEvents = sortEvents(eventsByOwner[person.id] || []);
    lines.push(`${person.name}:`);

    if (personEvents.length === 0) {
      lines.push("- дел нет");
    } else {
      for (const event of personEvents) {
        const time = event.time || NO_TIME_LABEL;
        const note = event.note ? ` - ${event.note}` : "";
        const attachments = formatAttachmentSummary(event);
        lines.push(`- ${time} - ${event.title}${note}${attachments}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
