import type { APIRoute } from "astro";
import { resolveFeaturedImage } from "../../../lib/download";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });
  const r = await resolveFeaturedImage(key);
  if (!r.ok) return new Response("not found", { status: 404 });
  // Task 2.5 / 07-P2: featured image jarang berganti; 302 boleh di-cache
  // browser/CDN 1 jam sebelum kembali mengecek presigned URL baru.
  const res = Response.redirect(r.url, 302);
  res.headers.set("Cache-Control", "public, max-age=3600");
  return res;
};
