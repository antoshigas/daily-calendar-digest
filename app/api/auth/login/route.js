import { getPublicAccounts, loginWithPassword, sessionCookieHeader } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

function jsonError(message, status = 400, retryAfter = 0) {
  const headers = retryAfter > 0 ? { "Retry-After": String(retryAfter) } : undefined;
  return Response.json({ ok: false, error: message, accounts: getPublicAccounts() }, { status, headers });
}

export async function POST(request) {
  try {
    const input = await request.json();
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    const password = typeof input.password === "string" ? input.password : "";
    const challenge = {
      id: typeof input.graphicChallengeId === "string" ? input.graphicChallengeId : "",
      answer: Array.isArray(input.graphicAnswer) ? input.graphicAnswer : [],
    };
    const { token, account } = await loginWithPassword(accountId, password, request, challenge);

    return Response.json(
      { ok: true, account, accounts: getPublicAccounts() },
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
