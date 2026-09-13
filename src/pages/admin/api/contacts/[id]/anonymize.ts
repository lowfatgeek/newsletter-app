import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../../lib/admin/guard";
import { anonymizeContact } from "../../../../../lib/admin/contacts";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/contacts/[id]/anonymize — anonimisasi destruktif satu
 * kontak (email dimask, token akses dihapus, riwayat claim tetap). UI wajib
 * melakukan konfirmasi ganda sebelum memanggil endpoint ini. Kontak tidak
 * ada → 404. Cookie tidak valid → 401 JSON.
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
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
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), {
      status: 404,
      headers: noStore,
    });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: noStore });
};
