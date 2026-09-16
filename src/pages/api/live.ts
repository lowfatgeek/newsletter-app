import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * Liveness probe (task: deploy Easypanel). Menjawab 200 selama proses HTTP
 * hidup, TANPA menyentuh database.
 *
 * Kenapa terpisah dari `/api/health`: `/api/health` adalah *readiness* (503
 * bila DB tak terjangkau). Kalau probe container memakai readiness, gangguan
 * database — atau DATABASE_URL yang belum benar saat deploy pertama — membuat
 * container dianggap mati lalu di-restart/stop oleh Docker/Easypanel, dan
 * Console pun tidak bisa dibuka untuk mendiagnosa. Pantau kesiapan DB lewat
 * `/api/health` (checklist go-live), dan biarkan liveness hanya soal proses.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: "live" }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
