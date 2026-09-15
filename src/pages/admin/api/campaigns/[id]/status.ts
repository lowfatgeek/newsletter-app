import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { duplicateCampaign, setCampaignStatus } from "../../../../../lib/admin/campaigns";
import { clientIp } from "../../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

const ACTIONS = new Set(["publish", "pause", "unpause", "archive", "duplicate"]);

/**
 * POST /admin/api/campaigns/[id]/status — body JSON { action } dengan action
 * publish | pause | unpause | archive | duplicate. Mesin transisi divalidasi
 * di lib (transisi ilegal → 400 "invalid-transition"). duplicate → 200 dengan
 * { ok: true, newId }. Campaign tidak ada → 404. Cookie tidak valid → 401.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401, headers: noStore });
  }

  const id = params.id ?? "";
  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const ip = clientIp(request);
  const auditOpts = { adminUserId: admin.id, ip };

  try {
    if (action === "duplicate") {
      const newId = await duplicateCampaign(id, auditOpts);
      return new Response(JSON.stringify({ ok: true, newId }), { headers: noStore });
    }
    const result = await setCampaignStatus(
      id,
      action as "publish" | "pause" | "unpause" | "archive",
      auditOpts,
    );
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : 400;
      return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status, headers: noStore });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: noStore });
  } catch {
    // duplicateCampaign melempar "campaign-not-found".
    return new Response(JSON.stringify({ ok: false, reason: "not-found" }), { status: 404, headers: noStore });
  }
};
