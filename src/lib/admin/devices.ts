import { and, eq, gt, isNull } from "drizzle-orm";
import { generateOpaqueToken, hashToken } from "../crypto";
import { db } from "../db";
import { trustedDevices } from "../schema";

export const THIRTY_DAYS_MS = 30 * 86_400_000;

export async function mintTrustedDevice(adminUserId: string, userAgent?: string): Promise<{ id: string; raw: string }> {
  const raw = generateOpaqueToken();
  const [row] = await db
    .insert(trustedDevices)
    .values({
      adminUserId,
      tokenHash: hashToken(raw),
      userAgent: userAgent?.slice(0, 300),
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    })
    .returning();
  return { id: row.id, raw };
}

export async function resolveTrustedDevice(
  raw: string | undefined,
): Promise<{ id: string; adminUserId: string } | null> {
  if (!raw) return null;
  const rows = await db
    .select({ id: trustedDevices.id, adminUserId: trustedDevices.adminUserId })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.tokenHash, hashToken(raw)),
        gt(trustedDevices.expiresAt, new Date()),
        isNull(trustedDevices.revokedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeTrustedDevice(id: string): Promise<void> {
  await db.update(trustedDevices).set({ revokedAt: new Date() }).where(eq(trustedDevices.id, id));
}

/**
 * Revoke perangkat tepercaya langsung dari token mentah (dipakai logout:
 * cookie hanya menyimpan token mentah, bukan id). Revoke by hash.
 */
export async function revokeTrustedDeviceByHash(raw: string): Promise<void> {
  await db
    .update(trustedDevices)
    .set({ revokedAt: new Date() })
    .where(eq(trustedDevices.tokenHash, hashToken(raw)));
}

export async function revokeAllDevices(adminUserId: string): Promise<void> {
  await db
    .update(trustedDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(trustedDevices.adminUserId, adminUserId), isNull(trustedDevices.revokedAt)));
}
