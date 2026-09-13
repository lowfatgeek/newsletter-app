import type { APIRoute } from "astro";
import { resolveDownload } from "../../../../lib/download";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const r = await resolveDownload(params.session!, params.assetId!);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  return Response.redirect(r.url, 302);
};
