import type { APIRoute } from "astro";
import { resubscribeByToken } from "../../../lib/broadcast/unsubscribe";
import { clientIp } from "../../../lib/ip";
import { consumeRateLimit, hashIp } from "../../../lib/ratelimit";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * POST /api/unsubscribe/resubscribe (form-encoded) — aksi eksplisit dari
 * halaman persetujuan /subscribe-again/<token>. Bukan unsubscribe; segmen
 * "resubscribe" statis mengalahkan [token] pada routing Astro.
 * Sukses → 303 kembali ke halaman yang sama dengan ?ok=1 (Success state).
 * Token invalid → 303 ke /batal-berlangganan/invalid. Cache-Control: no-store.
 */
export const POST: APIRoute = async ({ request }) => {
  // Bucket yang sama dengan unsubscribe satu-klik; kena limit → 303 generik
  // ke halaman invalid yang sama (jangan bedakan respons).
  if (!(await consumeRateLimit("unsub", hashIp(clientIp(request)), 30))) {
    return new Response(null, {
      status: 303,
      headers: { Location: "/batal-berlangganan/invalid", "Cache-Control": "no-store" },
    });
  }
  let token = "";
  try {
    token = String((await request.formData()).get("token") ?? "");
  } catch {
    token = "";
  }

  const result = await resubscribeByToken(token);
  if (result.ok) {
    return new Response(null, {
      status: 303,
      headers: { Location: `/subscribe-again/${token}?ok=1`, "Cache-Control": "no-store" },
    });
  }

  return new Response(null, {
    status: 303,
    headers: { Location: "/batal-berlangganan/invalid", "Cache-Control": "no-store" },
  });
};
