import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeEvent, normalizeOwnerId, sortEvents } from "./calendar.js";

const STORAGE_KEY = "daily-calendar-events:v1";
const DIGEST_RUNS_KEY = "daily-calendar-digest-runs:v1";
const OWNER_PASSWORDS_KEY = "daily-calendar-owner-passwords:v1";
const LOCAL_EVENTS_PATH = path.join(process.cwd(), "data", "events.local.json");
const LOCAL_DIGEST_RUNS_PATH = path.join(process.cwd(), "data", "digest-runs.local.json");
const LOCAL_OWNER_PASSWORDS_PATH = path.join(process.cwd(), "data", "owner-passwords.local.json");

const REDIS_ENV_PAIRS = [
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["REDIS_REST_API_URL", "REDIS_REST_API_TOKEN"],
];

function getRedisConfig() {
  for (const [urlName, tokenName] of REDIS_ENV_PAIRS) {
    const url = process.env[urlName];
    const token = process.env[tokenName];

    if (url && token) {
      return { url, token };
    }
  }

  return null;
}

async function redisCommand(command) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Redis storage is not configured");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
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

async function readLocalJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeLocalJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeDigestRuns(value) {
  const rawDates = Array.isArray(value) ? value : [];
  const dates = rawDates
    .filter((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();

  return [...new Set(dates)];
}

export async function readEvents() {
  const rawEvents = getRedisConfig()
    ? JSON.parse((await redisCommand(["GET", STORAGE_KEY])) || "[]")
    : await readLocalJson(LOCAL_EVENTS_PATH, []);

  if (!Array.isArray(rawEvents)) {
    throw new Error("Stored events must be an array");
  }

  return sortEvents(rawEvents.map(normalizeEvent));
}

export async function writeEvents(events) {
  const normalized = sortEvents(events.map(normalizeEvent));

  if (getRedisConfig()) {
    await redisCommand(["SET", STORAGE_KEY, JSON.stringify(normalized)]);
  } else {
    await writeLocalJson(LOCAL_EVENTS_PATH, normalized);
  }

  return normalized;
}

export async function readDigestRuns() {
  const rawRuns = getRedisConfig()
    ? JSON.parse((await redisCommand(["GET", DIGEST_RUNS_KEY])) || "[]")
    : await readLocalJson(LOCAL_DIGEST_RUNS_PATH, []);

  return normalizeDigestRuns(rawRuns);
}

export async function hasDigestRun(dateKey) {
  return (await readDigestRuns()).includes(dateKey);
}

export async function markDigestRun(dateKey) {
  const runs = await readDigestRuns();
  const nextRuns = normalizeDigestRuns([...runs, dateKey]);

  if (getRedisConfig()) {
    await redisCommand(["SET", DIGEST_RUNS_KEY, JSON.stringify(nextRuns)]);
  } else {
    await writeLocalJson(LOCAL_DIGEST_RUNS_PATH, nextRuns);
  }

  return nextRuns;
}

function normalizeOwnerPasswords(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, record]) => record && typeof record === "object")
      .map(([ownerId, record]) => [
        normalizeOwnerId(ownerId),
        {
          salt: typeof record.salt === "string" ? record.salt : "",
          hash: typeof record.hash === "string" ? record.hash : "",
          createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
        },
      ])
      .filter(([, record]) => record.salt && record.hash),
  );
}

export async function readOwnerPasswords() {
  const rawPasswords = getRedisConfig()
    ? JSON.parse((await redisCommand(["GET", OWNER_PASSWORDS_KEY])) || "{}")
    : await readLocalJson(LOCAL_OWNER_PASSWORDS_PATH, {});

  return normalizeOwnerPasswords(rawPasswords);
}

export async function writeOwnerPasswords(passwords) {
  const normalized = normalizeOwnerPasswords(passwords);

  if (getRedisConfig()) {
    await redisCommand(["SET", OWNER_PASSWORDS_KEY, JSON.stringify(normalized)]);
  } else {
    await writeLocalJson(LOCAL_OWNER_PASSWORDS_PATH, normalized);
  }

  return normalized;
}
