import type { APIRoute } from "astro";
import { env } from "../../../lib/env";
import { processBroadcast } from "../../../lib/broadcast/worker";

/**
 * Cron worker broadcast (interval 1 menit, lihat vercel.json).
 * Satu tick = satu batch satu kampanye; single-flight via claimForSending.
 * Jalur transaksional email_outbox (Plan 1) tidak tersentuh di sini.
 */
export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await processBroadcast();
  return new Response(JSON.stringify(result), { status: 200 });
};
