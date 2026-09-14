import type { APIRoute } from "astro";
import { resolveDownload } from "../../../../lib/download";
import { clientIp } from "../../../../lib/ip";
import { consumeRateLimit, hashIp } from "../../../../lib/ratelimit";

export const prerender = false;

/**
 * GET /api/download/<session>/<assetId> — unduhan file reward.
 * Rate limit 30/jam per IP (hash) SEBELUM resolveDownload agar token tidak
 * bisa dienumerasi/bruteforce. Kena limit → 429 generik (jangan bocorkan
 * alasan); token invalid tetap 403.
 */
export const GET: APIRoute = async ({ params, request }) => {
  if (!(await consumeRateLimit("dl", hashIp(clientIp(request)), 30))) {
    return new Response("too many requests", { status: 429 });
  }
  const r = await resolveDownload(params.session!, params.assetId!);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  return Response.redirect(r.url, 302);
};
