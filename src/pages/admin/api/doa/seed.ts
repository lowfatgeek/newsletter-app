import type { APIRoute } from "astro";
import { ensureDefaultDoaTemplates } from "../../../../lib/admin/doa";
import { getAdmin, verifyAdminOrigin } from "../../../../lib/admin/guard";
import { clientIp } from "../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return json({ ok: false, reason: "forbidden" }, 403);
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const res = await ensureDefaultDoaTemplates({
    adminUserId: admin.id,
    ip: clientIp(request),
  });

  return json({ ok: true, inserted: res.inserted });
};
