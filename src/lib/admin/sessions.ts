import { and, eq, gt, isNull } from "drizzle-orm";
import { generateOpaqueToken, hashToken } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { adminSessions, adminUsers } from "../schema";

export const ADMIN_SESSION_COOKIE = "kado_admin_session";
export const ADMIN_DEVICE_COOKIE = "kado_admin_device";

export function adminCookieAttrs(secure: boolean): string {
  return `; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Path=/`;
}

export async function createAdminSession(adminUserId: string): Promise<{ id: string; raw: string; expiresAt: Date }> {
  const raw = generateOpaqueToken();
  const hours = Number(env("ADMIN_SESSION_TTL_HOURS", "12"));
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  const [row] = await db
    .insert(adminSessions)
    .values({ adminUserId, tokenHash: hashToken(raw), expiresAt })
    .returning();
  return { id: row.id, raw, expiresAt };
}

export async function resolveSession(raw: string | undefined) {
  if (!raw) return null;
  const rows = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(raw)),
        gt(adminSessions.expiresAt, new Date()),
        isNull(adminSessions.revokedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(raw: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessions.tokenHash, hashToken(raw)));
}

export async function revokeAllSessions(adminUserId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)));
}
