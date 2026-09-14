import { desc, sql } from "drizzle-orm";
import { db } from "../db";
import { adminAuditLog, adminUsers } from "../schema";
import { hashIp } from "../ratelimit";

export async function audit(
  action: string,
  opts?: { adminUserId?: string; detail?: Record<string, unknown>; ip?: string },
): Promise<void> {
  await db.insert(adminAuditLog).values({
    action,
    adminUserId: opts?.adminUserId ?? null,
    detail: opts?.detail ?? {},
    ipHash: opts?.ip ? hashIp(opts.ip) : null,
  });
}

export type AuditEventRow = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  ipHash: string | null;
  createdAt: Date;
  adminEmail: string | null;
};

/**
 * Viewer read-only audit log admin: terbaru dulu, join admin_user untuk
 * email. `limit` di-clamp 1..100 (default 50); `total` mengabaikan
 * limit/offset untuk pagination.
 */
export async function listAuditEvents(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ rows: AuditEventRow[]; total: number }> {
  const rawLimit = opts?.limit ?? 50;
  const limit = Math.min(Math.max(Math.floor(rawLimit) || 50, 1), 100);
  const rawOffset = opts?.offset ?? 0;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminAuditLog);
  const total = totalRows[0]?.n ?? 0;

  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      detail: adminAuditLog.detail,
      ipHash: adminAuditLog.ipHash,
      createdAt: adminAuditLog.createdAt,
      adminEmail: adminUsers.email,
    })
    .from(adminAuditLog)
    .leftJoin(adminUsers, sql`${adminUsers.id} = ${adminAuditLog.adminUserId}`)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(limit)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      ipHash: r.ipHash,
      createdAt: r.createdAt,
      adminEmail: r.adminEmail,
    })),
    total,
  };
}
