import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { accessTokens, consentEvents, contacts, marketingSubscriptions, rewardClaims } from "./schema";
import { generateOpaqueToken, hashToken } from "./crypto";

const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
const ONE_HOUR_MS = 3_600_000;

// Executor DB: koneksi biasa atau transaksi (tipe transaksi drizzle).
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function upsertClaim(contactId: string, campaignId: string): Promise<string> {
  const inserted = await db.insert(rewardClaims)
    .values({ contactId, campaignId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0].id;
  const [existing] = await db.select().from(rewardClaims)
    .where(and(eq(rewardClaims.contactId, contactId), eq(rewardClaims.campaignId, campaignId)));
  return existing.id;
}

async function insertToken(claimId: string, type: "confirm" | "access" | "session", ttlMs: number): Promise<string> {
  const raw = generateOpaqueToken();
  await db.insert(accessTokens).values({
    claimId,
    type,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

export function issueClaimToken(claimId: string, type: "confirm" | "access"): Promise<string> {
  return insertToken(claimId, type, SEVEN_DAYS_MS);
}

export function issueSessionToken(claimId: string): Promise<string> {
  return insertToken(claimId, "session", ONE_HOUR_MS);
}

export async function consumeToken(
  rawToken: string,
  type: "confirm" | "access" | "session",
  exec: DbExecutor = db,
): Promise<{ ok: true; claimId: string } | { ok: false }> {
  const tokenHash = hashToken(rawToken);
  if (type === "session") {
    // session tokens are reusable until expiry
    const [row] = await exec.select().from(accessTokens)
      .where(and(
        eq(accessTokens.tokenHash, tokenHash),
        eq(accessTokens.type, type),
        gt(accessTokens.expiresAt, new Date()),
      ));
    return row ? { ok: true, claimId: row.claimId } : { ok: false };
  }
  // confirm/access tokens are one-time: atomic UPDATE ... WHERE unused AND unexpired RETURNING
  const rows = await exec.update(accessTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(accessTokens.tokenHash, tokenHash),
      eq(accessTokens.type, type),
      isNull(accessTokens.usedAt),
      gt(accessTokens.expiresAt, new Date()),
    ))
    .returning();
  return rows.length > 0 ? { ok: true, claimId: rows[0].claimId } : { ok: false };
}

export async function confirmContactByToken(
  rawToken: string,
): Promise<{ ok: true; claimId: string } | { ok: false }> {
  // Seluruh sekuen — konsumsi token, update contact, update claim, upsert
  // subscription, event consent — atomik dalam satu transaksi: gagal di tengah
  // tidak meninggalkan setengah konfirmasi.
  return db.transaction(async (tx) => {
    const result = await consumeToken(rawToken, "confirm", tx);
    if (!result.ok) return { ok: false } as const;
    const [claim] = await tx.select().from(rewardClaims).where(eq(rewardClaims.id, result.claimId));
    await tx.update(contacts)
      .set({ confirmationStatus: "confirmed", confirmedAt: sql`coalesce(${contacts.confirmedAt}, now())` })
      .where(eq(contacts.id, claim.contactId));
    await tx.update(rewardClaims).set({ status: "accessed" }).where(eq(rewardClaims.id, result.claimId));
    const [sub] = await tx.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, claim.contactId));
    if (!sub || sub.status !== "active") {
      await tx.insert(marketingSubscriptions)
        .values({ contactId: claim.contactId, status: "active", subscribedAt: new Date(), source: "reward_claim" })
        .onConflictDoUpdate({
          target: marketingSubscriptions.contactId,
          set: { status: "active", subscribedAt: new Date(), unsubscribedAt: null },
        });
      await tx.insert(consentEvents).values({ contactId: claim.contactId, event: "subscribed" });
    }
    return { ok: true, claimId: result.claimId } as const;
  });
}
