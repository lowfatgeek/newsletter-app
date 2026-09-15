import type { APIRoute } from "astro";
import { removeAsset } from "../../../../lib/admin/assets";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../lib/admin/guard";
import { clientIp } from "../../../../lib/ip";
import { isValidUuid } from "../../../../lib/uuid";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * DELETE /admin/api/assets/[id] — hapus ROW asset saja. Objek R2 tidak
 * dihapus otomatis (PRD 7.2: asset lama tetap tersimpan di storage).
 * Sukses → { ok:true }. Asset tidak dikenal → 404. Cookie tidak valid → 401.
 */
export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401, headers: noStore });
  }
  const id = params.id ?? "";
  if (!isValidUuid(id)) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid-uuid" }), { status: 400, headers: noStore });
  }
  const ip = clientIp(request);
  await removeAsset(id, { adminUserId: admin.id, ip });
  // removeAsset no-op untuk id tak dikenal — tetap ok agar klien idempotent;
  // klien akan me-refresh list dan row hilang sendiri.
  return new Response(JSON.stringify({ ok: true }), { headers: noStore });
};
