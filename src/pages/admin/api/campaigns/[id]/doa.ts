import type { APIRoute } from "astro";
import { setDoaSelections } from "../../../../../lib/admin/campaigns";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { clientIp } from "../../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/campaigns/[id]/doa — body JSON { muslim, universal }
 * (templateId per variant). Variant template divalidasi di lib → mismatch 400
 * { ok:false, reason:"variant-mismatch" }. Cookie tidak valid → 401.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
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
  let body: { muslim?: unknown; universal?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const muslim = typeof body.muslim === "string" ? body.muslim : "";
  const universal = typeof body.universal === "string" ? body.universal : "";
  if (!muslim || !universal) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const ip = clientIp(request);
  const result = await setDoaSelections(id, { muslim, universal }, { adminUserId: admin.id, ip });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status: 400, headers: noStore });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: noStore });
};
