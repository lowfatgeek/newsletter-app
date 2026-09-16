import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Ping DB termurah untuk /api/health (task 3.8 / 04-N1 — route ini dulu
 * menyimpan `db.execute(sql...)` langsung di file halaman).
 * Mengembalikan false, bukan melempar, supaya route tetap bisa membalas 503.
 */
export async function databaseHealthy(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
