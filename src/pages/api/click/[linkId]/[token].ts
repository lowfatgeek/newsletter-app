import type { APIRoute } from "astro";
import { resolveClick } from "../../../../lib/broadcast/links";

/**
 * GET /api/click/<linkId>/<rawToken> — bentuk URL ini sudah ditanam di
 * lastRenderedHtml oleh linkRewrite saat snapshot.
 * Valid → 302 ke url asli; invalid → 404. Selalu Cache-Control: no-store
 * (respons berisi Location per-recipient, jangan pernah di-cache).
 */
export const GET: APIRoute = async ({ params }) => {
  const result = await resolveClick(params.linkId ?? "", params.token ?? "");
  if (!result.ok) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: result.url, "Cache-Control": "no-store" },
  });
};
