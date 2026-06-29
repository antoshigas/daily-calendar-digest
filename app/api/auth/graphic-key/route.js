import { deleteGraphicKey, getGraphicKeyStatus, requireSessionAccount, setGraphicKey } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function GET(request) {
  try {
    const account = await requireSessionAccount(request);
    const graphicKey = await getGraphicKeyStatus(account.id);

    return Response.json({ ok: true, graphicKey });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось загрузить графический ключ", error?.status || 400);
  }
}

export async function PUT(request) {
  try {
    const account = await requireSessionAccount(request);
    const input = await request.json();
    const pattern = Array.isArray(input.pattern) ? input.pattern : [];
    const graphicKey = await setGraphicKey(account.id, pattern);

    return Response.json({ ok: true, graphicKey });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось сохранить графический ключ", error?.status || 400);
  }
}

export async function DELETE(request) {
  try {
    const account = await requireSessionAccount(request);
    const graphicKey = await deleteGraphicKey(account.id);

    return Response.json({ ok: true, graphicKey });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось отключить графический ключ", error?.status || 400);
  }
}
