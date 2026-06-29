import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { ACCOUNTS, getAccountName, normalizeAccountId } from "./calendar.js";
import {
  readGraphicKeys,
  readLoginAttempts,
  readOwnerPasswords,
  readSessions,
  writeGraphicKeys,
  writeLoginAttempts,
  writeSessions,
} from "./storage.js";

const SESSION_COOKIE = "daily_calendar_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 120000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 30 * 60 * 1000;
const GRAPHIC_KEY_MIN_LENGTH = 4;
const GRAPHIC_KEY_MAX_LENGTH = 9;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

async function verifyLegacyPassword(accountId, password) {
  const passwords = await readOwnerPasswords();
  const record = passwords[normalizeAccountId(accountId)];

  if (!record?.salt || !record?.hash) {
    throw new Error("Для этого аккаунта пароль ещё не заведён в БД");
  }

  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(pbkdf2Sync(password, record.salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex"), "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function getSessionCookie(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies[SESSION_COOKIE] || "";
}

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_MAX_AGE_SECONDS}; Priority=High`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0; Priority=High`;
}

export async function createSession(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const sessions = await readSessions();

  await writeSessions({
    ...sessions,
    [tokenHash(token)]: {
      accountId: normalizedAccountId,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt,
    },
  });

  return { token, account: getPublicAccount(normalizedAccountId) };
}

export async function destroySession(request) {
  const token = getSessionCookie(request);
  if (!token) return;

  const sessions = await readSessions();
  const hash = tokenHash(token);
  if (!sessions[hash]) return;

  const nextSessions = { ...sessions };
  delete nextSessions[hash];
  await writeSessions(nextSessions);
}

export async function getSessionAccount(request) {
  const token = getSessionCookie(request);
  if (!token) return null;

  const sessions = await readSessions();
  const hash = tokenHash(token);
  const session = sessions[hash];
  if (!session) return null;

  const now = new Date();
  await writeSessions({
    ...sessions,
    [hash]: {
      ...session,
      lastSeenAt: now.toISOString(),
    },
  });

  return getPublicAccount(session.accountId);
}

export async function requireSessionAccount(request) {
  const account = await getSessionAccount(request);
  if (!account) {
    const error = new Error("Нужно войти в аккаунт");
    error.status = 401;
    throw error;
  }

  return account;
}

function authError(message = "Не удалось войти", status = 401, retryAfter = 0) {
  const error = new Error(message);
  error.status = status;
  if (retryAfter > 0) error.retryAfter = retryAfter;
  return error;
}

function normalizeStrictAccountId(accountId) {
  const rawAccountId = accountId === "stanislovas" ? "kristina" : String(accountId || "");
  if (!ACCOUNTS.some((account) => account.id === rawAccountId)) {
    throw authError("Выберите аккаунт", 400);
  }

  return rawAccountId;
}

function clientHash(request) {
  const forwardedFor = request?.headers?.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim() || request?.headers?.get("x-real-ip") || "unknown";
  const userAgent = request?.headers?.get("user-agent") || "unknown";

  return createHash("sha256").update(`${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

function attemptKey(accountId, request) {
  return `${accountId}:${clientHash(request)}`;
}

async function assertLoginAllowed(accountId, request) {
  const attempts = await readLoginAttempts();
  const record = attempts[attemptKey(accountId, request)];
  const lockedUntil = Date.parse(record?.lockedUntil || "");

  if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
    throw authError(`Слишком много попыток. Вход закрыт ещё на ${Math.ceil(retryAfter / 60)} мин.`, 429, retryAfter);
  }
}

async function recordLoginFailure(accountId, request) {
  const attempts = await readLoginAttempts();
  const key = attemptKey(accountId, request);
  const now = Date.now();
  const existing = attempts[key];
  const firstFailedAt = Date.parse(existing?.firstFailedAt || "");
  const withinWindow = Number.isFinite(firstFailedAt) && now - firstFailedAt < LOGIN_WINDOW_MS;
  const failedCount = withinWindow ? Number(existing.failedCount || 0) + 1 : 1;
  const lockedUntil = failedCount >= LOGIN_MAX_ATTEMPTS ? new Date(now + LOGIN_LOCK_MS).toISOString() : "";

  await writeLoginAttempts({
    ...attempts,
    [key]: {
      accountId,
      scope: "client",
      failedCount,
      firstFailedAt: withinWindow ? existing.firstFailedAt : new Date(now).toISOString(),
      lastFailedAt: new Date(now).toISOString(),
      lockedUntil,
    },
  });

  if (lockedUntil) {
    throw authError("Слишком много попыток. Вход закрыт на 30 мин.", 429, Math.ceil(LOGIN_LOCK_MS / 1000));
  }
}

async function clearLoginFailures(accountId, request) {
  const attempts = await readLoginAttempts();
  const key = attemptKey(accountId, request);
  if (!attempts[key]) return;

  const nextAttempts = { ...attempts };
  delete nextAttempts[key];
  await writeLoginAttempts(nextAttempts);
}

function graphicKeyHash(salt, pattern) {
  return createHash("sha256").update(`${salt}:${pattern.join("-")}`).digest("hex");
}

function cleanGraphicPattern(answer, { required = true } = {}) {
  const rawItems = Array.isArray(answer) ? answer : [];
  const items = rawItems.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 8);

  if (items.length === 0 && !required) return [];

  if (
    items.length < GRAPHIC_KEY_MIN_LENGTH ||
    items.length > GRAPHIC_KEY_MAX_LENGTH ||
    new Set(items).size !== items.length
  ) {
    throw authError("Графический ключ должен содержать минимум 4 разные точки", 400);
  }

  return items;
}

export async function getGraphicKeyStatus(accountId) {
  const normalizedAccountId = normalizeStrictAccountId(accountId);
  const keys = await readGraphicKeys();

  return {
    accountId: normalizedAccountId,
    enabled: Boolean(keys[normalizedAccountId]?.salt && keys[normalizedAccountId]?.hash),
    minLength: GRAPHIC_KEY_MIN_LENGTH,
  };
}

export async function setGraphicKey(accountId, pattern) {
  const normalizedAccountId = normalizeStrictAccountId(accountId);
  const cleanPattern = cleanGraphicPattern(pattern);
  const keys = await readGraphicKeys();
  const salt = randomBytes(16).toString("base64url");
  const now = new Date();

  await writeGraphicKeys({
    ...keys,
    [normalizedAccountId]: {
      salt,
      hash: graphicKeyHash(salt, cleanPattern),
      createdAt: keys[normalizedAccountId]?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });

  return getGraphicKeyStatus(normalizedAccountId);
}

export async function deleteGraphicKey(accountId) {
  const normalizedAccountId = normalizeStrictAccountId(accountId);
  const keys = await readGraphicKeys();
  if (!keys[normalizedAccountId]) return getGraphicKeyStatus(normalizedAccountId);

  const nextKeys = { ...keys };
  delete nextKeys[normalizedAccountId];
  await writeGraphicKeys(nextKeys);
  return getGraphicKeyStatus(normalizedAccountId);
}

async function verifyGraphicKey(accountId, pattern) {
  const keys = await readGraphicKeys();
  const record = keys[accountId];
  if (!record?.salt || !record?.hash) return true;

  const cleanPattern = cleanGraphicPattern(pattern);
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(graphicKeyHash(record.salt, cleanPattern), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw authError("Неверный вход. Проверьте пароль и графический ключ.");
  }

  return true;
}

export async function loginWithPassword(accountId, password, request, graphicPattern = []) {
  const normalizedAccountId = normalizeStrictAccountId(accountId);

  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Введите пароль");
  }

  await assertLoginAllowed(normalizedAccountId, request);

  let ok = false;
  try {
    ok = await verifyLegacyPassword(normalizedAccountId, password);
  } catch {
    ok = false;
  }

  if (!ok) {
    await recordLoginFailure(normalizedAccountId, request);
    throw authError("Неверный вход. Проверьте пароль и графический ключ.");
  }

  try {
    await verifyGraphicKey(normalizedAccountId, graphicPattern);
  } catch (error) {
    await recordLoginFailure(normalizedAccountId, request);
    throw error;
  }

  await clearLoginFailures(normalizedAccountId, request);
  return createSession(normalizedAccountId);
}

export function getPublicAccount(accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  return {
    id: normalizedAccountId,
    name: getAccountName(normalizedAccountId),
  };
}

export function getPublicAccounts() {
  return ACCOUNTS.map((account) => getPublicAccount(account.id));
}

export async function getPublicAccountsWithSecurity() {
  const keys = await readGraphicKeys();

  return ACCOUNTS.map((account) => ({
    ...getPublicAccount(account.id),
    graphicKeyEnabled: Boolean(keys[account.id]?.salt && keys[account.id]?.hash),
  }));
}
