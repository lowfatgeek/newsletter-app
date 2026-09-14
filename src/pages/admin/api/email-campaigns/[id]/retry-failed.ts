import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../../lib/admin/guard";
import { retryFailedRecipients } from "../../../../../lib/broadcast/stats";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/[id]/retry-failed — kirim ulang recipient
 * gagal (failed → pending; completed/failed kampanye kembali ke 'queued',
 * worker tick berikutnya mengirim lewat limit yang sama).
 * 200 { ok:true, reset } · 400 invalid-state · 404 not-found · 401.
 */
export const POST: APIRoute = async ({ cookies, params, request }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const result = await retryFailedRecipients(params.id ?? "", { adminUserId: admin.id, ip });
  if (result.ok) return json({ ok: true, reset: result.reset });
  return json({ ok: false, reason: result.reason }, result.reason === "not-found" ? 404 : 400);
};
