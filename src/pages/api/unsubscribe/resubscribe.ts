import type { APIRoute } from "astro";
import { resubscribeByToken } from "../../../lib/broadcast/unsubscribe";
import { clientIp } from "../../../lib/ip";
import { consumeRateLimit, hashIp } from "../../../lib/ratelimit";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * POST /api/unsubscribe/resubscribe (form-encoded) — aksi eksplisit dari
 * halaman persetujuan /subscribe-again/<token> (atau mirror EN-nya
 * /en/subscribe-again/<token>). Bukan unsubscribe; segmen "resubscribe"
 * statis mengalahkan [token] pada routing Astro.
 * Sukses → 303 kembali ke halaman yang sama (locale dari form, default id)
 * dengan ?ok=1 (Success state). Token invalid → 303 ke halaman invalid
 * (locale sama). Cache-Control: no-store.
 */
export const POST: APIRoute = async ({ request }) => {
  let locale = "id";
  let token = "";
  try {
    const form = await request.formData();
    token = String(form.get("token") ?? "");
    locale = form.get("locale") === "en" ? "en" : "id";
  } catch {
    token = "";
  }
  const invalidPath = locale === "en" ? "/en/batal-berlangganan/invalid" : "/batal-berlangganan/invalid";
  const successPath = (t: string) => (locale === "en" ? `/en/subscribe-again/${t}?ok=1` : `/subscribe-again/${t}?ok=1`);

  // Bucket yang sama dengan unsubscribe satu-klik; kena limit → 303 generik
  // ke halaman invalid yang sama (jangan bedakan respons).
  if (!(await consumeRateLimit("unsub", hashIp(clientIp(request)), 30))) {
    return new Response(null, {
      status: 303,
      headers: { Location: invalidPath, "Cache-Control": "no-store" },
    });
  }

  const result = await resubscribeByToken(token);
  if (result.ok) {
    return new Response(null, {
      status: 303,
      headers: { Location: successPath(token), "Cache-Control": "no-store" },
    });
  }

  return new Response(null, {
    status: 303,
    headers: { Location: invalidPath, "Cache-Control": "no-store" },
  });
};
