import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { startLogin } from "../../../lib/admin/login";
import { clientIp } from "../../../lib/ip";

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

/**
 * POST /admin/api/login — body JSON { email, password }.
 * Sukses → { ok: true, challengeId }; kredensial salah → 401 generik;
 * terkena rate limit → 429. Tidak pernah mengungkap apakah email terdaftar.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const ip = clientIp(request);
  const result = await startLogin({ email, password, ip });

  if (!result.ok) {
    const status = result.reason === "rate-limited" ? 429 : 401;
    return new Response(JSON.stringify({ ok: false, reason: result.reason }), { status, headers: noStore });
  }
  return new Response(JSON.stringify({ ok: true, challengeId: result.challengeId }), { headers: noStore });
};
