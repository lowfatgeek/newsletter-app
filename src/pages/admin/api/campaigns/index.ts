import type { APIRoute } from "astro";
import { createCampaign } from "../../../../lib/admin/campaigns";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../lib/admin/guard";
import { clientIp } from "../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/campaigns — body JSON { slug }.
 * Sukses → { ok: true, id }; slug tidak valid / sudah dipakai → 400.
 * Cookie admin tidak valid → 401.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
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

  let body: { slug?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const ip = clientIp(request);
  const result = await createCampaign({ slug }, { adminUserId: admin.id, ip });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status: 400, headers: noStore });
  }
  return new Response(JSON.stringify({ ok: true, id: result.id }), { headers: noStore });
};
