import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { cancelCampaign } from "../../../../../lib/broadcast/machine";
import { clientIp } from "../../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/[id]/cancel — batalkan
 * (scheduled|queued|paused → cancelled; recipient pending → cancelled).
 * 200 { ok:true } · 400 invalid-transition · 404 not-found · 401.
 * Client (Task 12, halaman laporan) wajib memakai dialog konfirmasi kedua.
 */
export const POST: APIRoute = async ({ cookies, params, request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const ip = clientIp(request);
  const result = await cancelCampaign(params.id ?? "", { adminUserId: admin.id, ip });
  if (result.ok) return json({ ok: true });
  return json({ ok: false, reason: result.reason }, result.reason === "not-found" ? 404 : 400);
};
