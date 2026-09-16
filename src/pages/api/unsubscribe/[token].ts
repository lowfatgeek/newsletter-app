import type { APIRoute } from "astro";
import { resolveUnsubscribeToken, unsubscribeByToken } from "../../../lib/broadcast/unsubscribe";
import { clientIp } from "../../../lib/ip";
import { consumeRateLimit, hashIp } from "../../../lib/ratelimit";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * GET /api/unsubscribe/<rawToken> — tautan satu-klik di footer email broadcast.
 * Token valid → unsubscribe (idempoten) lalu 303 ke halaman konfirmasi
 * /batal-berlangganan/<token> (halaman ramah cetak). Token invalid →
 * 303 ke /batal-berlangganan/invalid yang menampilkan kondisi kedaluwarsa.
 * Selalu Cache-Control: no-store.
 */
export const GET: APIRoute = async ({ params, request }) => {
  // Rate limit SEBELUM resolve token (mencegah enumerasi). Kena limit tetap
  // 303 generik ke halaman invalid yang sama — jangan bedakan respons.
  if (!(await consumeRateLimit("unsub", hashIp(clientIp(request)), 30))) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/batal-berlangganan/invalid",
        "Cache-Control": "no-store",
      },
    });
  }
  const raw = params.token ?? "";
  const target = await resolveUnsubscribeToken(raw);
  if (target) await unsubscribeByToken(raw);

  const prefix = target?.locale === "en" ? "/en" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: target ? `${prefix}/batal-berlangganan/${raw}` : "/batal-berlangganan/invalid",
      "Cache-Control": "no-store",
    },
  });
};
