import { clearSessionCookieHeader, destroySession } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  await destroySession(request);

  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookieHeader(),
      },
    },
  );
}
