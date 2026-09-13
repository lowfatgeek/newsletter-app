import type { APIRoute } from "astro";
import { resolveFeaturedImage } from "../../../lib/download";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });
  const r = await resolveFeaturedImage(key);
  if (!r.ok) return new Response("not found", { status: 404 });
  return Response.redirect(r.url, 302);
};
