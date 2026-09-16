import type { APIRoute } from "astro";
import { cronAuthorized } from "../../../lib/cron-auth";
import { processOutbox } from "../../../lib/mailworker";
import { pruneRateLimits } from "../../../lib/ratelimit";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!cronAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  const [result, prunedRateLimits] = await Promise.all([
    processOutbox(),
    pruneRateLimits().catch(() => 0),
  ]);
  return new Response(JSON.stringify({ ...result, prunedRateLimits }), { status: 200 });
};
