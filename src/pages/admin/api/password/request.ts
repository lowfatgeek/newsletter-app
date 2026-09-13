import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { requestPasswordReset } from "../../../../lib/admin/login";

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/password/request — body JSON { email }.
 * SELALU menjawab { ok: true } generik — tanpa membocorkan kegagalan.
 * challengeId hanya disertakan bila OTP benar-benar diterbitkan (email ==
 * ADMIN_EMAIL) karena langkah konfirmasi halaman reset membutuhkannya;
 * email lain mendapat { ok: true } tanpa challengeId.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: true }), { headers: noStore });
  }
  const email = typeof body.email === "string" ? body.email : "";
  if (email) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
    const result = await requestPasswordReset(email, ip);
    if (result.ok && "challengeId" in result && result.challengeId) {
      return new Response(JSON.stringify({ ok: true, challengeId: result.challengeId }), { headers: noStore });
    }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: noStore });
};
