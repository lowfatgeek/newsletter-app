import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  contacts,
  consentEvents,
  emailCampaignRecipients,
  emailSuppressions,
  marketingSubscriptions,
} from "../schema";
import { hashToken } from "../crypto";

// Executor DB: koneksi biasa atau transaksi (tipe transaksi drizzle) —
// pola yang sama dengan access.ts.
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resolve raw click token (dari URL unsubscribe di email) ke recipient:
 * lookup hash di emailCampaignRecipients.clickTokenHash. Raw token tidak
 * pernah disimpan — hanya hash (lihat snapshotRecipients).
 */
export async function resolveUnsubscribeToken(
  raw: string,
): Promise<{ recipientId: string; contactId: string } | null> {
  if (!raw) return null;
  const [row] = await db
    .select({ id: emailCampaignRecipients.id, contactId: emailCampaignRecipients.contactId })
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.clickTokenHash, hashToken(raw)));
  return row ? { recipientId: row.id, contactId: row.contactId } : null;
}

/**
 * Unsubscribe satu-klik, IDEMPOTEN:
 * - bila subscription sudah 'unsubscribed' → tidak melakukan apa pun
 *   (tanpa consent event ganda), tetap return { ok: true }.
 * - selain itu: set status 'unsubscribed' + unsubscribedAt (row dibuat bila
 *   belum ada), insert suppression reason 'unsubscribe' (onConflictDoNothing),
 *   insert consent event 'unsubscribed'.
 * Seluruh sekuen atomik dalam satu transaksi.
 */
export async function unsubscribeByToken(raw: string): Promise<{ ok: boolean }> {
  const target = await resolveUnsubscribeToken(raw);
  if (!target) return { ok: false };

  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(marketingSubscriptions)
      .where(eq(marketingSubscriptions.contactId, target.contactId));
    if (sub?.status === "unsubscribed") return { ok: true } as const;

    if (sub) {
      await tx
        .update(marketingSubscriptions)
        .set({ status: "unsubscribed", unsubscribedAt: new Date() })
        .where(eq(marketingSubscriptions.contactId, target.contactId));
    } else {
      await tx
        .insert(marketingSubscriptions)
        .values({ contactId: target.contactId, status: "unsubscribed", unsubscribedAt: new Date(), source: "unsubscribe_link" });
    }

    const [contact] = await tx
      .select({ emailNormalized: contacts.emailNormalized })
      .from(contacts)
      .where(eq(contacts.id, target.contactId));
    await tx
      .insert(emailSuppressions)
      .values({ emailNormalized: contact.emailNormalized, reason: "unsubscribe" })
      .onConflictDoNothing();

    await tx.insert(consentEvents).values({ contactId: target.contactId, event: "unsubscribed" });
    return { ok: true } as const;
  });
}

/**
 * Re-subscribe eksplisit dari halaman persetujuan (/subscribe-again/<token>):
 * - hapus suppression reason 'unsubscribe' SAJA (hard_bounce / complaint
 *   tetap tertahan),
 * - set subscription kembali 'active' + subscribedAt + unsubscribedAt null
 *   (upsert, pola confirmContactByToken di access.ts),
 * - insert consent event 'resubscribed'.
 * Atomik dalam satu transaksi. Token invalid → { ok: false }.
 */
export async function resubscribeByToken(raw: string): Promise<{ ok: boolean }> {
  const target = await resolveUnsubscribeToken(raw);
  if (!target) return { ok: false };

  return db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ emailNormalized: contacts.emailNormalized })
      .from(contacts)
      .where(eq(contacts.id, target.contactId));

    await tx
      .delete(emailSuppressions)
      .where(and(eq(emailSuppressions.emailNormalized, contact.emailNormalized), eq(emailSuppressions.reason, "unsubscribe")));

    await tx
      .insert(marketingSubscriptions)
      .values({ contactId: target.contactId, status: "active", subscribedAt: new Date(), source: "resubscribe" })
      .onConflictDoUpdate({
        target: marketingSubscriptions.contactId,
        set: { status: "active", subscribedAt: new Date(), unsubscribedAt: null },
      });

    await tx
      .insert(consentEvents)
      .values({ contactId: target.contactId, event: "resubscribed" });
    return { ok: true } as const;
  });
}
