import type { APIRoute } from "astro";
export const GET: APIRoute = async () => {
  try {
    const { db } = await import("../../lib/db");
    await db.execute("select 1");
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ status: "error" }), { status: 503 });
  }
};
