import type { APIRoute } from "astro";
import { resolveUnsubscribeToken, unsubscribeByToken } from "../../../lib/broadcast/unsubscribe";

/**
 * GET /api/unsubscribe/<rawToken> — tautan satu-klik di footer email broadcast.
 * Token valid → unsubscribe (idempoten) lalu 303 ke halaman konfirmasi
 * /batal-berlangganan/<token> (halaman ramah cetak). Token invalid →
 * 303 ke /batal-berlangganan/invalid yang menampilkan kondisi kedaluwarsa.
 * Selalu Cache-Control: no-store.
 */
export const GET: APIRoute = async ({ params }) => {
  const raw = params.token ?? "";
  const target = await resolveUnsubscribeToken(raw);
  if (target) await unsubscribeByToken(raw);

  return new Response(null, {
    status: 303,
    headers: {
      Location: target ? `/batal-berlangganan/${raw}` : "/batal-berlangganan/invalid",
      "Cache-Control": "no-store",
    },
  });
};
