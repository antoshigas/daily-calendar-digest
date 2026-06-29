import { getPublicAccountsWithSecurity, loginWithPassword, sessionCookieHeader } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

async function jsonError(message, status = 400, retryAfter = 0) {
  const headers = retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined;
  return Response.json({ ok: false, error: message, accounts: await getPublicAccountsWithSecurity() }, { status, headers });
}

export async function POST(request) {
  try {
    const input = await request.json();
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    const password = typeof input.password === "string" ? input.password : "";
    const graphicPattern = Array.isArray(input.graphicPattern) ? input.graphicPattern : [];
    const { token, account } = await loginWithPassword(accountId, password, request, graphicPattern);

    return Response.json(
      { ok: true, account, accounts: await getPublicAccountsWithSecurity() },
      {
        headers: {
          "Set-Cookie": sessionCookieHeader(token),
        },
      },
    );
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 401;
    const retryAfter = Number.isInteger(error?.retryAfter) ? error.retryAfter : 0;
    return jsonError(error instanceof Error ? error.message : "Не удалось войти", status, retryAfter);
  }
}
