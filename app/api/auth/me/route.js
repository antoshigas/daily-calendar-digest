import { getPublicAccountsWithSecurity, getSessionAccount } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const account = await getSessionAccount(request);
  const accounts = await getPublicAccountsWithSecurity();

  return Response.json({
    ok: true,
    account,
    accounts,
  });
}
