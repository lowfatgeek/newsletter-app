import type { APIRoute } from "astro";
import { cronAuthorized } from "../../../lib/cron-auth";
import { processOutbox } from "../../../lib/mailworker";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!cronAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await processOutbox();
  return new Response(JSON.stringify(result), { status: 200 });
};
