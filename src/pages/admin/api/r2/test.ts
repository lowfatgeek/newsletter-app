import type { APIRoute } from "astro";
import { getAdmin } from "../../../../lib/admin/guard";
import { testR2Connection } from "../../../../lib/storage";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

/**
 * GET /admin/api/r2/test — uji koneksi & hak akses bucket Cloudflare R2.
 * Memerlukan autentikasi admin.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const result = await testR2Connection();
  return json(result, result.ok ? 200 : 500);
};
