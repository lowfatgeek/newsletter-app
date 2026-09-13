import type { APIRoute } from "astro";
import { env } from "../../lib/env";
import { processOutbox } from "../../lib/mailworker";

export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await processOutbox();
  return new Response(JSON.stringify(result), { status: 200 });
};
