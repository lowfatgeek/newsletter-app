import type { APIRoute } from "astro";
import { processBroadcast } from "../../../lib/broadcast/worker";
import { cronAuthorized } from "../../../lib/cron-auth";
import { processOutbox } from "../../../lib/mailworker";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * Cron worker broadcast (interval 1 menit, lihat vercel.json).
 * Satu tick = satu batch satu kampanye; single-flight via claimForSending.
 * Prioritas transaksional (task 1.7 / PRD §12, 04-N3): drain email_outbox
 * transaksional (konfirmasi/reward/OTP) SEBELUM worker mengambil batch
 * broadcast berikutnya, lalu laporkan kedua hasil.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!cronAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  const outbox = await processOutbox();
  const result = await processBroadcast();
  return new Response(JSON.stringify({ ...result, outbox }), { status: 200 });
};
