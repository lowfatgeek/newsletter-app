import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminUsers } from "../schema";
import { ADMIN_SESSION_COOKIE, ADMIN_DEVICE_COOKIE, resolveSession } from "./sessions";
import { resolveTrustedDevice } from "./devices";

type CookieBag = { get(name: string): { value: string } | undefined };

/**
 * CSRF defense-in-depth (task 2.2 / 05-S1): request mutasi dari browser
 * membawa header Origin; Origin harus sama dengan origin halaman tujuan.
 * Request tanpa Origin (curl, service-to-service, e2e via API) diizinkan —
 * lapisan proteksi utama tetap cookie SameSite + otorisasi admin.
 * PUBLIC_SITE_URL diterima sebagai fallback untuk deployment di belakang
 * proxy yang host-nya berbeda dari URL request.
 */
export function verifyAdminOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const candidates = new Set<string>([new URL(request.url).origin]);
  const site = process.env.PUBLIC_SITE_URL;
  if (site) {
    try {
      candidates.add(new URL(site).origin);
    } catch {
      /* siteUrl tidak valid — abaikan, request-origin tetap dicek */
    }
  }
  return candidates.has(origin);
}

/**
 * Resolve admin dari cookie sesi, lalu cookie perangkat tepercaya.
 * secure tidak memengaruhi resolusi (hanya penandaan cookie saat set).
 */
export async function getAdmin(cookies: CookieBag, _secure = false) {
  const viaSession = await resolveSession(cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (viaSession) return viaSession;
  const viaDevice = await resolveTrustedDevice(cookies.get(ADMIN_DEVICE_COOKIE)?.value);
  if (viaDevice) {
    const [u] = await db.select({ id: adminUsers.id, email: adminUsers.email })
      .from(adminUsers).where(eq(adminUsers.id, viaDevice.adminUserId));
    return u ?? null;
  }
  return null;
}

/**
 * Helper halaman: return AdminUser bila terautentikasi, atau null —
 * halaman melakukan redirect sendiri agar kompatibel tipe Astro:
 *   const admin = await requireAdminOrRedirect(Astro);
 *   if (!admin) return Astro.redirect("/admin/login");
 */
export async function requireAdminOrRedirect(
  astro: { cookies: CookieBag; url: URL; redirect(path: string, status?: number): unknown },
) {
  const secure = astro.url.protocol === "https:";
  const admin = await getAdmin(astro.cookies, secure);
  if (admin) return admin;
  astro.redirect("/admin/login", 303);
  return null;
}
