import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { accessTokens, consentEvents, contacts, marketingSubscriptions, rewardClaims } from "./schema";
import { generateOpaqueToken, hashToken } from "./crypto";

const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
const ONE_HOUR_MS = 3_600_000;

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
): Promise<{ ok: true; claimId: string } | { ok: false }> {
  const tokenHash = hashToken(rawToken);
  if (type === "session") {
    // session tokens are reusable until expiry
    const [row] = await db.select().from(accessTokens)
      .where(and(
        eq(accessTokens.tokenHash, tokenHash),
        eq(accessTokens.type, type),
        gt(accessTokens.expiresAt, new Date()),
      ));
    return row ? { ok: true, claimId: row.claimId } : { ok: false };
  }
  // confirm/access tokens are one-time: atomic UPDATE ... WHERE unused AND unexpired RETURNING
  const rows = await db.update(accessTokens)
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
  const result = await consumeToken(rawToken, "confirm");
  if (!result.ok) return { ok: false };
  const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, result.claimId));
  await db.update(contacts)
    .set({ confirmationStatus: "confirmed", confirmedAt: sql`coalesce(${contacts.confirmedAt}, now())` })
    .where(eq(contacts.id, claim.contactId));
  await db.update(rewardClaims).set({ status: "accessed" }).where(eq(rewardClaims.id, result.claimId));
  const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, claim.contactId));
  if (!sub || sub.status !== "active") {
    await db.insert(marketingSubscriptions)
      .values({ contactId: claim.contactId, status: "active", subscribedAt: new Date(), source: "reward_claim" })
      .onConflictDoUpdate({
        target: marketingSubscriptions.contactId,
        set: { status: "active", subscribedAt: new Date(), unsubscribedAt: null },
      });
    await db.insert(consentEvents).values({ contactId: claim.contactId, event: "subscribed" });
  }
  return { ok: true, claimId: result.claimId };
}
