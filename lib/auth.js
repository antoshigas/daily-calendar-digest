import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { ACCOUNTS, getAccountName, isValidAccountId, normalizeAccountId } from "./calendar.js";
import { readOwnerPasswords, readSessions, writeSessions } from "./storage.js";

const SESSION_COOKIE = "daily_calendar_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;
const PASSWORD_ITERATIONS = 120000;

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
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
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

export async function loginWithPassword(accountId, password) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!isValidAccountId(normalizedAccountId)) {
    throw new Error("Выберите аккаунт");
  }

  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Введите пароль");
  }

  const ok = await verifyLegacyPassword(normalizedAccountId, password);
  if (!ok) {
    throw new Error("Неверный пароль");
  }

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
