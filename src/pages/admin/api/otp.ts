import type { APIRoute } from "astro";
import { verifyAdminOrigin } from "../../../lib/admin/guard";

// Route on-demand — tidak pernah diprerender.
import { completeLogin, UUID_RE } from "../../../lib/admin/login";
import { ADMIN_DEVICE_COOKIE, ADMIN_SESSION_COOKIE, adminCookieAttrs } from "../../../lib/admin/sessions";
import { clientIp } from "../../../lib/ip";

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/otp — body JSON { challengeId, code, trustDevice }.
 * Sukses → Set-Cookie sesi (+ perangkat tepercaya bila diminta) + { ok: true }.
 * Gagal → { ok: false, reason } tanpa cookie.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: { challengeId?: unknown; code?: unknown; trustDevice?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const code = typeof body.code === "string" ? body.code : "";
  const trustDevice = body.trustDevice === true;
  if (!challengeId || !code) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  if (!UUID_RE.test(challengeId)) {
    // 401 generik — sama seperti challengeId yang tidak dikenal DB.
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 401, headers: noStore });
  }

  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const result = await completeLogin({ challengeId, code, trustDevice, ip, userAgent });

  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status: 401, headers: noStore });
  }

  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers(noStore);
  headers.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${result.session.raw}${adminCookieAttrs(secure)}`);
  if (result.device) {
    headers.append(
      "Set-Cookie",
      `${ADMIN_DEVICE_COOKIE}=${result.device.raw}${adminCookieAttrs(secure)}; Max-Age=${30 * 86_400}`,
    );
  }
  return new Response(JSON.stringify({ ok: true }), { headers });
};
