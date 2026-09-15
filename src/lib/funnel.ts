import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { accessTokens, contacts, emailOutbox, marketingSubscriptions, rewardClaims } from "./schema";

export type FunnelStats = {
  contactsTotal: number;
  contactsConfirmed30d: number;
  activeSubscribers: number;
  claimsTotal: number;
  confirmationsSent: number;
  rewardAccessSent: number;
  downloadsIssued: number;
  unsubscribedTotal: number;
};

async function count(
  table:
    | typeof contacts
    | typeof rewardClaims
    | typeof emailOutbox
    | typeof accessTokens
    | typeof marketingSubscriptions,
  where?: ReturnType<typeof eq> | ReturnType<typeof and> | ReturnType<typeof gte> | ReturnType<typeof sql>,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table as any)
    .where(where as any);
  return rows[0]?.n ?? 0;
}

/**
 * Statistik funnel dasar dari tabel existing (tanpa migrasi, tanpa event log).
 * Submit→confirm berbasis confirmed_at; visit→submit tidak tersedia karena
 * page-view tidak pernah ditulis ke DB (batasan eksplisit di halaman admin).
 */
export async function getFunnelStats(): Promise<FunnelStats> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [
    contactsTotal,
    contactsConfirmed30d,
    activeSubscribers,
    claimsTotal,
    confirmationsSent,
    rewardAccessSent,
    downloadsIssued,
    unsubscribedTotal,
  ] = await Promise.all([
    count(contacts),
    count(contacts, and(eq(contacts.confirmationStatus, "confirmed"), gte(contacts.confirmedAt, cutoff))),
    count(marketingSubscriptions, eq(marketingSubscriptions.status, "active")),
    count(rewardClaims),
    count(emailOutbox, eq(emailOutbox.emailType, "confirmation")),
    count(emailOutbox, eq(emailOutbox.emailType, "reward_access")),
    count(accessTokens, eq(accessTokens.type, "session")),
    count(marketingSubscriptions, eq(marketingSubscriptions.status, "unsubscribed")),
  ]);
  return {
    contactsTotal,
    contactsConfirmed30d,
    activeSubscribers,
    claimsTotal,
    confirmationsSent,
    rewardAccessSent,
    downloadsIssued,
    unsubscribedTotal,
  };
}
