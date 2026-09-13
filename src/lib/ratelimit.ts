import { sql } from "drizzle-orm";
import { db } from "./db";
import { sha256Hex } from "./crypto";
import { env } from "./env";

export function hashIp(ip: string): string {
  return sha256Hex(`${env("IP_HASH_SALT")}:${ip}`);
}

export async function consumeRateLimit(
  scope: string, identity: string, limit: number, windowMs: number = 3_600_000,
): Promise<boolean> {
  const key = `${scope}:${identity}:${Math.floor(Date.now() / windowMs)}`;
  const result = await db.execute(sql`
    INSERT INTO rate_limit (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET count = rate_limit.count + 1
    RETURNING count
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { count: number }[];
  const count = Number(rows[0].count);
  return count <= limit;
}
