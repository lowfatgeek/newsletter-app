import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { anonymizeContact } from "../../../../../lib/admin/contacts";
import { clientIp } from "../../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/contacts/[id]/anonymize — anonimisasi destruktif satu
 * kontak (email dimask, token akses dihapus, riwayat claim tetap). UI wajib
 * melakukan konfirmasi ganda sebelum memanggil endpoint ini. Kontak tidak
 * ada → 404. Cookie tidak valid → 401 JSON.
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401,
      headers: noStore,
    });
  }

  const contactId = params.id ?? "";
  const result = await anonymizeContact(contactId, {
    adminUserId: admin.id,
    ip: clientIp(request),
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), {
      status: 404,
      headers: noStore,
    });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: noStore });
};
