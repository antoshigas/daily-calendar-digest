import { getPublicAccounts, getSessionAccount } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const account = await getSessionAccount(request);

  return Response.json({
    ok: true,
    account,
    accounts: getPublicAccounts(),
  });
}
