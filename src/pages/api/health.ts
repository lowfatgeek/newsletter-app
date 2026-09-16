import type { APIRoute } from "astro";
import { databaseHealthy } from "../../lib/health";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

export const GET: APIRoute = async () => {
  const healthy = await databaseHealthy();
  return new Response(JSON.stringify({ status: healthy ? "ok" : "error" }), { status: healthy ? 200 : 503 });
};
