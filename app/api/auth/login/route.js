import { getPublicAccounts, loginWithPassword, sessionCookieHeader } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message, accounts: getPublicAccounts() }, { status });
}

export async function POST(request) {
  try {
    const input = await request.json();
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    const password = typeof input.password === "string" ? input.password : "";
    const { token, account } = await loginWithPassword(accountId, password);

    return Response.json(
      { ok: true, account, accounts: getPublicAccounts() },
      {
        headers: {
          "Set-Cookie": sessionCookieHeader(token),
        },
      },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось войти", 401);
  }
}
