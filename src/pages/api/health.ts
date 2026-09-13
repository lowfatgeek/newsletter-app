import type { APIRoute } from "astro";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db";

export const GET: APIRoute = async () => {
  try {
    await db.execute(sql`select 1`);
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ status: "error" }), { status: 503 });
  }
};
