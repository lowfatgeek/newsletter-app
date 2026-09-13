import { db } from "../db";
import { adminAuditLog } from "../schema";
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
