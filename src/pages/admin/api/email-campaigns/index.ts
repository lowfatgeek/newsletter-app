import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../lib/admin/guard";
import { createEmailCampaign } from "../../../../lib/broadcast/crud";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/email-campaigns — buat campaign baru berstatus draft
 * (konten kosong, filter {all:true}, limit default 60/menit, 600/jam).
 * Sukses → { ok: true, id }; cookie admin tidak valid → 401.
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401, headers: noStore });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const id = await createEmailCampaign({ adminUserId: admin.id, ip });
  return new Response(JSON.stringify({ ok: true, id }), { headers: noStore });
};
