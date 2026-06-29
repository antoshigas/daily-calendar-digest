import { createLoginChallenge } from "../../../../lib/auth.js";

export const dynamic = "force-dynamic";

const DOTS = [
  { x: 32, y: 30 },
  { x: 100, y: 30 },
  { x: 168, y: 30 },
  { x: 32, y: 98 },
  { x: 100, y: 98 },
  { x: 168, y: 98 },
  { x: 32, y: 166 },
  { x: 100, y: 166 },
  { x: 168, y: 166 },
];

function escapeSvg(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildChallengeImage(pattern) {
  const points = pattern.map((index) => DOTS[index]);
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const label = pattern.map((index) => index + 1).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="196" viewBox="0 0 200 196" role="img" aria-label="Рисунок защиты ${escapeSvg(label)}">
<rect width="200" height="196" rx="16" fill="#10182b"/>
<path d="M20 18h160a12 12 0 0 1 12 12v136a12 12 0 0 1-12 12H20a12 12 0 0 1-12-12V30a12 12 0 0 1 12-12Z" fill="#1d2942" stroke="rgba(255,255,255,.12)"/>
<polyline points="${line}" fill="none" stroke="#65f3d0" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="${first.x}" cy="${first.y}" r="16" fill="#ffcf6d"/>
<circle cx="${last.x}" cy="${last.y}" r="16" fill="#ff7ab6"/>
${DOTS.map((point, index) => {
  const step = pattern.indexOf(index);
  const selected = step !== -1;
  const fill = selected ? "#fffdf7" : "#34415c";
  const stroke = selected ? "#10182b" : "rgba(255,255,255,.28)";
  const text = selected ? step + 1 : "";
  return `<circle cx="${point.x}" cy="${point.y}" r="12" fill="${fill}" stroke="${stroke}" stroke-width="3"/><text x="${point.x}" y="${point.y + 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#10182b">${text}</text>`;
}).join("")}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function jsonError(message, status = 400) {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId") || "";
    const challenge = await createLoginChallenge(accountId);

    return Response.json(
      {
        ok: true,
        challenge: {
          id: challenge.id,
          image: buildChallengeImage(challenge.pattern),
          expiresAt: challenge.expiresAt,
          length: challenge.length,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Не удалось создать рисунок защиты", 400);
  }
}
