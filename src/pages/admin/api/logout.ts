import type { APIRoute } from "astro";
import { revokeTrustedDeviceByHash } from "../../../lib/admin/devices";
import { verifyAdminOrigin } from "../../../lib/admin/guard";
// Route on-demand — tidak pernah diprerender.
import {
  ADMIN_DEVICE_COOKIE,
  ADMIN_SESSION_COOKIE,
  adminCookieAttrs,
  revokeSession,
} from "../../../lib/admin/sessions";

const noStore = { "Cache-Control": "no-store" };

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * POST /admin/api/logout — menerima POST form biasa (dari layout) maupun fetch.
 * Revoke sesi + perangkat tepercaya dari cookie (by hash), hapus kedua cookie
 * (Max-Age=0), redirect 303 ke /admin/login. Selalu redirect, apa pun kondisi
 * cookie.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const cookies = parseCookies(request.headers.get("cookie"));
  const raw = cookies[ADMIN_SESSION_COOKIE];
  if (raw) await revokeSession(raw);
  // Revoke trusted device juga — logout harus mematikan "remember device",
  // bukan hanya sesi OTP saat ini.
  const rawDevice = cookies[ADMIN_DEVICE_COOKIE];
  if (rawDevice) await revokeTrustedDeviceByHash(rawDevice);

  const secure = new URL(request.url).protocol === "https:";
  const cleared = `${adminCookieAttrs(secure)}; Max-Age=0`;
  const headers = new Headers(noStore);
  headers.set("Location", "/admin/login");
  headers.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=${cleared}`);
  headers.append("Set-Cookie", `${ADMIN_DEVICE_COOKIE}=${cleared}`);
  return new Response(null, { status: 303, headers });
};
