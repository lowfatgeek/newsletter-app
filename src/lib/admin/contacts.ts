import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accessTokens,
  consentEvents,
  contacts,
  emailDeliveries,
  marketingSubscriptions,
  rewardCampaignLocales,
  rewardCampaigns,
  rewardClaims,
} from "../schema";
import { audit } from "./audit";
import type { AuditOpts } from "./campaigns";

export type ContactsFilter = {
  status?: "pending" | "confirmed" | "unsubscribed";
  campaignId?: string;
  search?: string;
  limit: number;
  offset: number;
};

export type ContactRow = {
  id: string;
  emailNormalized: string;
  locale: string;
  confirmationStatus: string;
  marketingStatus: string | null;
  subscribedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
  claimsCount: number;
  claimSlugs: string; // slug distinct di-join dengan ";"
};

export type ContactDetail = {
  contact: typeof contacts.$inferSelect;
  subscription: typeof marketingSubscriptions.$inferSelect | null;
  consents: Array<typeof consentEvents.$inferSelect>;
  claims: Array<{
    claimId: string;
    campaignId: string;
    campaignSlug: string;
    campaignTitle: string;
    claimStatus: string;
    firstClaimedAt: Date;
  }>;
  deliveries: Array<{
    emailType: string;
    status: string;
    sentAt: Date | null;
    deliveredAt: Date | null;
    bouncedAt: Date | null;
  }>;
};

function filterConditions(filter: ContactsFilter) {
  const conds = [];
  if (filter.status === "confirmed") conds.push(eq(contacts.confirmationStatus, "confirmed"));
  if (filter.status === "pending") conds.push(eq(contacts.confirmationStatus, "pending"));
  if (filter.status === "unsubscribed") conds.push(eq(marketingSubscriptions.status, "unsubscribed"));
  if (filter.campaignId) {
    conds.push(
      inArray(
        contacts.id,
        db.select({ id: rewardClaims.contactId }).from(rewardClaims).where(eq(rewardClaims.campaignId, filter.campaignId)),
      ),
    );
  }
  if (filter.search && filter.search.trim() !== "") {
    conds.push(ilike(contacts.emailNormalized, `%${filter.search.trim()}%`));
  }
  return conds;
}

/**
 * Daftar kontak + status marketing + agregat claim. Filter `unsubscribed`
 * membaca marketing_subscription.status; `search` ILIKE pada email
 * (case-insensitive). Urutan created_at desc. `total` menghitung seluruh
 * baris yang cocok (abaikan limit/offset) untuk pagination.
 */
export async function listContacts(filter: ContactsFilter): Promise<{ rows: ContactRow[]; total: number }> {
  const conds = filterConditions(filter);
  const where = conds.length > 0 ? and(...conds) : undefined;

  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .leftJoin(marketingSubscriptions, eq(marketingSubscriptions.contactId, contacts.id))
    .where(where);
  const total = totalRows[0]?.n ?? 0;

  const base = await db
    .select({
      id: contacts.id,
      emailNormalized: contacts.emailNormalized,
      locale: contacts.locale,
      confirmationStatus: contacts.confirmationStatus,
      createdAt: contacts.createdAt,
      marketingStatus: marketingSubscriptions.status,
      subscribedAt: marketingSubscriptions.subscribedAt,
      unsubscribedAt: marketingSubscriptions.unsubscribedAt,
    })
    .from(contacts)
    .leftJoin(marketingSubscriptions, eq(marketingSubscriptions.contactId, contacts.id))
    .where(where)
    .orderBy(desc(contacts.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);

  if (base.length === 0) return { rows: [], total };

  // Agregat claim per contact: jumlah + slug distinct (";"-join).
  const claimAgg = await db
    .select({
      contactId: rewardClaims.contactId,
      claimsCount: sql<number>`count(*)::int`,
      claimSlugs: sql<string>`coalesce(string_agg(distinct ${rewardCampaigns.slug}, ';'), '')`,
    })
    .from(rewardClaims)
    .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardClaims.campaignId))
    .where(inArray(rewardClaims.contactId, base.map((b) => b.id)))
    .groupBy(rewardClaims.contactId);
  const aggById = new Map(claimAgg.map((a) => [a.contactId, a]));

  const rows: ContactRow[] = base.map((b) => {
    const agg = aggById.get(b.id);
    return {
      id: b.id,
      emailNormalized: b.emailNormalized,
      locale: b.locale,
      confirmationStatus: b.confirmationStatus,
      marketingStatus: b.marketingStatus,
      subscribedAt: b.subscribedAt,
      unsubscribedAt: b.unsubscribedAt,
      createdAt: b.createdAt,
      claimsCount: agg?.claimsCount ?? 0,
      claimSlugs: agg?.claimSlugs ?? "",
    };
  });
  return { rows, total };
}

/**
 * Detail satu kontak: profil, langganan marketing, riwayat consent, dan
 * claim (slug + judul campaign locale id dengan fallback, status, tanggal).
 * Null bila kontak tidak ada.
 */
export async function getContactDetail(contactId: string): Promise<ContactDetail | null> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return null;

  const [subscription] = await db
    .select()
    .from(marketingSubscriptions)
    .where(eq(marketingSubscriptions.contactId, contactId));
  const consents = await db
    .select()
    .from(consentEvents)
    .where(eq(consentEvents.contactId, contactId))
    .orderBy(asc(consentEvents.createdAt));

  const claimRows = await db
    .select({
      claimId: rewardClaims.id,
      campaignId: rewardClaims.campaignId,
      campaignSlug: rewardCampaigns.slug,
      claimStatus: rewardClaims.status,
      firstClaimedAt: rewardClaims.firstClaimedAt,
    })
    .from(rewardClaims)
    .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardClaims.campaignId))
    .where(eq(rewardClaims.contactId, contactId))
    .orderBy(desc(rewardClaims.firstClaimedAt));

  const claims: ContactDetail["claims"] = [];
  if (claimRows.length > 0) {
    const locales = await db
      .select()
      .from(rewardCampaignLocales)
      .where(inArray(rewardCampaignLocales.campaignId, claimRows.map((c) => c.campaignId)));
    const titleBy = new Map<string, string>();
    for (const l of locales) {
      // locale id menang; simpan locale pertama apa pun sebagai fallback.
      if (!titleBy.has(l.campaignId) || l.locale === "id") titleBy.set(l.campaignId, l.title);
    }
    for (const c of claimRows) {
      claims.push({
        claimId: c.claimId,
        campaignId: c.campaignId,
        campaignSlug: c.campaignSlug,
        campaignTitle: titleBy.get(c.campaignId) ?? c.campaignSlug,
        claimStatus: c.claimStatus,
        firstClaimedAt: c.firstClaimedAt,
      });
    }
  }

  // Riwayat email (semua tipe: broadcast, broadcast_test, transaksional) —
  // 20 terbaru, createdAt desc.
  const deliveries = await db
    .select({
      emailType: emailDeliveries.emailType,
      status: emailDeliveries.status,
      sentAt: emailDeliveries.sentAt,
      deliveredAt: emailDeliveries.deliveredAt,
      bouncedAt: emailDeliveries.bouncedAt,
    })
    .from(emailDeliveries)
    .where(eq(emailDeliveries.contactId, contactId))
    .orderBy(desc(emailDeliveries.createdAt))
    .limit(20);

  return { contact, subscription: subscription ?? null, consents, claims, deliveries };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvField(value: string | null | undefined): string {
  return csvEscape(value ?? "");
}

function isoOrNull(d: Date | null): string {
  return d ? d.toISOString() : "";
}

/**
 * CSV ekspor kontak. Tidak memuat token, hash IP, atau kolom rahasia lain —
 * hanya data yang boleh dilihat operasi. Setiap ekspor ter-audit sebagai
 * `contacts_exported` dengan filter yang dipakai.
 */
export async function buildContactsCsv(filter: ContactsFilter, auditOpts?: AuditOpts): Promise<string> {
  const { rows } = await listContacts(filter);
  const lines = [
    "email,locale,confirmation_status,marketing_status,subscribed_at,unsubscribed_at,created_at,reward_claims",
    ...rows.map((r) =>
      [
        csvField(r.emailNormalized),
        csvField(r.locale),
        csvField(r.confirmationStatus),
        csvField(r.marketingStatus),
        csvField(isoOrNull(r.subscribedAt)),
        csvField(isoOrNull(r.unsubscribedAt)),
        csvField(isoOrNull(r.createdAt)),
        csvField(r.claimSlugs || null),
      ].join(","),
    ),
  ];
  await audit("contacts_exported", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { filter: { status: filter.status ?? null, campaignId: filter.campaignId ?? null, search: filter.search ?? null, limit: filter.limit, offset: filter.offset } },
  });
  return lines.join("\n");
}

/**
 * Anonimisasi destruktif: email diganti `deleted-<id>@invalid.local`, locale
 * direset "id", semua access_token milik claim kontak ini dihapus. Riwayat
 * claim dan consent DIPERTAHANKAN (agregat/analytics tetap valid). Ter-audit
 * sebagai `contact_anonymized`.
 */
export async function anonymizeContact(contactId: string, auditOpts?: AuditOpts): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return { ok: false, reason: "not-found" };

  const claimIds = (
    await db.select({ id: rewardClaims.id }).from(rewardClaims).where(eq(rewardClaims.contactId, contactId))
  ).map((r) => r.id);

  let tokensDeleted = 0;
  await db.transaction(async (tx) => {
    if (claimIds.length > 0) {
      const deleted = await tx
        .delete(accessTokens)
        .where(inArray(accessTokens.claimId, claimIds))
        .returning({ id: accessTokens.id });
      tokensDeleted = deleted.length;
    }
    await tx
      .update(contacts)
      .set({ emailNormalized: `deleted-${contactId}@invalid.local`, locale: "id" })
      .where(eq(contacts.id, contactId));
  });

  await audit("contact_anonymized", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { contactId, claimsCount: claimIds.length, tokensDeleted },
  });
  return { ok: true };
}
