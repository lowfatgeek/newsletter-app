import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { retryFailedRecipients } from "../../../../../lib/broadcast/stats";
import { clientIp } from "../../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/[id]/retry-failed — kirim ulang recipient
 * gagal (failed → pending; completed/failed kampanye kembali ke 'queued',
 * worker tick berikutnya mengirim lewat limit yang sama).
 * 200 { ok:true, reset } · 400 invalid-state · 404 not-found · 401 ·
 * 429 rate-limited (throttle 3/jam per campaign, tanpa audit).
 */
export const POST: APIRoute = async ({ cookies, params, request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const ip = clientIp(request);
  const result = await retryFailedRecipients(params.id ?? "", { adminUserId: admin.id, ip });
  if (result.ok) return json({ ok: true, reset: result.reset });
  if (result.reason === "rate-limited") {
    return json({ ok: false, reason: "rate-limited", message: "Terlalu sering. Coba lagi nanti." }, 429);
  }
  return json({ ok: false, reason: result.reason }, result.reason === "not-found" ? 404 : 400);
};
