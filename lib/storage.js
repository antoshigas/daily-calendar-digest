import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeEvent, sortEvents } from "./calendar.js";

const STORAGE_KEY = "daily-calendar-events:v1";
const LOCAL_EVENTS_PATH = path.join(process.cwd(), "data", "events.local.json");

function hasRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCommand(command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Redis request failed with status ${response.status}`);
  }

  return payload.result;
}

async function readLocalEvents() {
  try {
    const raw = await readFile(LOCAL_EVENTS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalEvents(events) {
  await mkdir(path.dirname(LOCAL_EVENTS_PATH), { recursive: true });
  await writeFile(LOCAL_EVENTS_PATH, `${JSON.stringify(events, null, 2)}\n`, "utf8");
}

export async function readEvents() {
  const rawEvents = hasRedis()
    ? JSON.parse((await redisCommand(["GET", STORAGE_KEY])) || "[]")
    : await readLocalEvents();

  if (!Array.isArray(rawEvents)) {
    throw new Error("Stored events must be an array");
  }

  return sortEvents(rawEvents.map(normalizeEvent));
}

export async function writeEvents(events) {
  const normalized = sortEvents(events.map(normalizeEvent));

  if (hasRedis()) {
    await redisCommand(["SET", STORAGE_KEY, JSON.stringify(normalized)]);
  } else {
    await writeLocalEvents(normalized);
  }

  return normalized;
}
