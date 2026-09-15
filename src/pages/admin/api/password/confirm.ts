import { verifyAdminOrigin } from "../../../../lib/admin/guard";
import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { completePasswordReset } from "../../../../lib/admin/login";

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/password/confirm — body JSON { challengeId, code, newPassword }.
 * Sukses → { ok: true }; gagal (kode salah/kedaluwarsa/terlalu banyak percobaan,
 * password lemah) → 400 { ok: false, reason }.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  let body: { challengeId?: unknown; code?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
  const code = typeof body.code === "string" ? body.code : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!challengeId || !code || !newPassword) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const result = await completePasswordReset(challengeId, code, newPassword);
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status: 400, headers: noStore });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: noStore });
};
