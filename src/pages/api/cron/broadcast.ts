import type { APIRoute } from "astro";
import { cronAuthorized } from "../../../lib/cron-auth";
import { processBroadcast } from "../../../lib/broadcast/worker";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * Cron worker broadcast (interval 1 menit, lihat vercel.json).
 * Satu tick = satu batch satu kampanye; single-flight via claimForSending.
 * Jalur transaksional email_outbox (Plan 1) tidak tersentuh di sini.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!cronAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await processBroadcast();
  return new Response(JSON.stringify(result), { status: 200 });
};
