import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../lib/admin/guard";
import { validateFilter, countAudience } from "../../../../lib/broadcast/audience";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/count — estimasi audiens.
 * Body JSON { filter } (AudienceFilter) → { ok: true, count }.
 * Filter tidak valid → 400 { ok:false, reason:"invalid-filter" }.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  let body: { filter?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const filter = validateFilter(body.filter);
  if (!filter.ok) return json({ ok: false, reason: "invalid-filter" }, 400);

  const count = await countAudience(filter.filter);
  return json({ ok: true, count });
};
