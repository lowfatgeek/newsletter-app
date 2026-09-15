import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../admin/audit";
import { db } from "../db";
import { env } from "../env";
import { enqueueTransactionalEmail } from "../outbox";
import { consumeRateLimit } from "../ratelimit";
import { consentEvents, contacts, emailCampaignRecipients, emailCampaigns, emailDeliveries } from "../schema";
import { type CampaignContent, renderForRecipient } from "./content";

/**
 * Statistik kampanye broadcast (angka tabular).
 *
 * TIDAK ADA open rate (DESIGN.md: jangan buat kartu Open Rate — pixel open
 * tidak andal). Metrik:
 * - recipients  : jumlah baris recipient kampanye
 * - sent        : recipient berstatus 'sent'
 * - delivered / failed / bounced : emailDeliveries (email_type broadcast)
 *                 milik recipient kampanye ini, dikelompokkan per status
 * - clicks      : recipient dengan clickedAt tidak null
 * - unsubscribed: recipient yang kontaknya punya consent event
 *                 "unsubscribed" SETELAH email dikirim (per-recipient
 *                 sentAt; fallback snapshotAt kampanye bila delivery hilang)
 */

export type CampaignStats = {
  recipients: number;
  sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  unsubscribed: number;
  clicks: number;
};

export type AuditOpts = { adminUserId?: string | null; ip?: string };

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const [recip] = await db
    .select({
      recipients: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${emailCampaignRecipients.status} = 'sent')::int`,
      clicks: sql<number>`count(*) filter (where ${emailCampaignRecipients.clickedAt} is not null)::int`,
    })
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.campaignId, campaignId));

  const delRows = await db
    .select({ status: emailDeliveries.status, n: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .innerJoin(emailCampaignRecipients, eq(emailDeliveries.campaignRecipientId, emailCampaignRecipients.id))
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailDeliveries.emailType, "broadcast")))
    .groupBy(emailDeliveries.status);
  const delBy = new Map(delRows.map((d) => [d.status, d.n]));

  // Unsubscribe pasca-kirim: consent event "unsubscribed" kontak dengan
  // createdAt >= coalesce(delivery.sentAt, snapshotAt kampanye). distinct
  // karena satu kontak bisa punya beberapa event unsubscribe.
  const [camp] = await db
    .select({ snapshotAt: emailCampaigns.snapshotAt })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId));
  const fallbackAt = camp?.snapshotAt ?? null;

  const [unsub] = await db
    .select({ n: sql<number>`count(distinct ${emailCampaignRecipients.id})::int` })
    .from(emailCampaignRecipients)
    .leftJoin(
      emailDeliveries,
      and(
        eq(emailDeliveries.campaignRecipientId, emailCampaignRecipients.id),
        eq(emailDeliveries.emailType, "broadcast"),
      ),
    )
    .innerJoin(
      consentEvents,
      and(eq(consentEvents.contactId, emailCampaignRecipients.contactId), eq(consentEvents.event, "unsubscribed")),
    )
    .where(
      and(
        eq(emailCampaignRecipients.campaignId, campaignId),
        sql`${consentEvents.createdAt} >= coalesce(${emailDeliveries.sentAt}, ${fallbackAt ? fallbackAt.toISOString() : null})`,
      ),
    );

  return {
    recipients: recip?.recipients ?? 0,
    sent: recip?.sent ?? 0,
    delivered: delBy.get("delivered") ?? 0,
    failed: delBy.get("failed") ?? 0,
    bounced: delBy.get("bounced") ?? 0,
    unsubscribed: unsub?.n ?? 0,
    clicks: recip?.clicks ?? 0,
  };
}

/** Progres pengiriman untuk baris "Mengirim X dari Y". */
export async function progressOf(campaignId: string): Promise<{ total: number; sentSoFar: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sentSoFar: sql<number>`count(*) filter (where ${emailCampaignRecipients.status} = 'sent')::int`,
    })
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.campaignId, campaignId));
  return { total: row?.total ?? 0, sentSoFar: row?.sentSoFar ?? 0 };
}

// ===== Laporan: tabel recipient + resend yang gagal (Task 12) =====

export type RecipientStatusFilter = "pending" | "sent" | "failed" | "cancelled";

export type RecipientRow = {
  id: string;
  email: string;
  locale: string;
  status: string;
  deliveryStatus: string | null;
  clickedAt: Date | null;
  error: string | null;
};

/**
 * Daftar recipient kampanye untuk tabel laporan:
 * - join contacts untuk email
 * - left join emailDeliveries (email_type broadcast) untuk status kirim +
 *   error — deliveryStatus/error null bila belum ada baris delivery
 * - error dikembalikan UTUH (halaman yang memotong tampilan, tooltip penuh)
 * - urutan deterministik berdasar email agar pagination stabil
 * - filter status (query param laporan) + limit/offset
 */
export async function listRecipients(
  campaignId: string,
  opts: { status?: RecipientStatusFilter; limit: number; offset: number },
): Promise<{ rows: RecipientRow[]; total: number }> {
  const conds = [eq(emailCampaignRecipients.campaignId, campaignId)];
  if (opts.status) conds.push(eq(emailCampaignRecipients.status, opts.status));
  const where = and(...conds);

  const rows: RecipientRow[] = await db
    .select({
      id: emailCampaignRecipients.id,
      email: contacts.emailNormalized,
      locale: emailCampaignRecipients.localeSelected,
      status: emailCampaignRecipients.status,
      deliveryStatus: emailDeliveries.status,
      clickedAt: emailCampaignRecipients.clickedAt,
      error: emailDeliveries.error,
    })
    .from(emailCampaignRecipients)
    .innerJoin(contacts, eq(contacts.id, emailCampaignRecipients.contactId))
    .leftJoin(
      emailDeliveries,
      and(
        eq(emailDeliveries.campaignRecipientId, emailCampaignRecipients.id),
        eq(emailDeliveries.emailType, "broadcast"),
      ),
    )
    .where(where)
    .orderBy(asc(contacts.emailNormalized))
    .limit(opts.limit)
    .offset(opts.offset);

  const [tot] = await db.select({ n: sql<number>`count(*)::int` }).from(emailCampaignRecipients).where(where);

  return { rows, total: tot?.n ?? 0 };
}

export type RetryFailedResult =
  | { ok: true; reset: number }
  | { ok: false; reason: "not-found" | "invalid-state" | "rate-limited" };

/**
 * Status kampanye yang boleh di-retry (PRD §10: admin dapat resend sesuai
 * throttle). draft/scheduled belum punya snapshot pengiriman; paused/cancelled
 * adalah keputusan admin yang tidak boleh dibatalkan diam-diam.
 */
const RETRYABLE_STATUSES = new Set(["sending", "queued", "completed", "failed"]);

/**
 * Kirim ulang recipient gagal:
 * - throttle 3/jam per campaign SEBELUM guard status (tanpa audit saat kena
 *   throttle — konsisten dengan guard invalid-state yang tidak menulis audit)
 * - UPDATE status 'failed' → 'pending' (sent/pending/cancelled disentuh tidak)
 * - kampanye completed/failed dikembalikan ke 'queued' agar worker tick
 *   berikutnya mengirim ulang lewat limit yang sama (maxPerMinute/maxPerHour)
 * - audit "campaign_retry_failed" detail {reset, requeued}
 * - tolak draft/scheduled/paused/cancelled → invalid-state
 */
export async function retryFailedRecipients(campaignId: string, auditOpts?: AuditOpts): Promise<RetryFailedResult> {
  if (!(await consumeRateLimit("broadcast_retry", campaignId, 3))) {
    return { ok: false, reason: "rate-limited" };
  }
  const [campaign] = await db
    .select({ id: emailCampaigns.id, status: emailCampaigns.status })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId));
  if (!campaign) return { ok: false, reason: "not-found" };
  if (!RETRYABLE_STATUSES.has(campaign.status)) return { ok: false, reason: "invalid-state" };

  const resetRows = await db
    .update(emailCampaignRecipients)
    .set({ status: "pending" })
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, "failed")))
    .returning({ id: emailCampaignRecipients.id });
  const reset = resetRows.length;

  // completed/failed tidak pernah diproses worker lagi — kembalikan ke
  // 'queued' secara atomic agar resend benar-benar terjadi.
  let requeued = false;
  if (campaign.status === "completed" || campaign.status === "failed") {
    const upd = await db
      .update(emailCampaigns)
      .set({ status: "queued", updatedAt: new Date() })
      .where(and(eq(emailCampaigns.id, campaignId), inArray(emailCampaigns.status, ["completed", "failed"])))
      .returning({ id: emailCampaigns.id });
    requeued = upd.length > 0;
  }

  await audit("campaign_retry_failed", {
    adminUserId: auditOpts?.adminUserId,
    ip: auditOpts?.ip,
    detail: { reset, requeued },
  });

  return { ok: true, reset };
}

export type SendTestResult = { ok: true } | { ok: false; reason: "not-allowed" | "no-content" };

/** URL unsubscribe test-send: tidak tertaut ke kontak mana pun. */
export function testUnsubscribeUrl(): string {
  const siteUrl = env("PUBLIC_SITE_URL", "http://localhost:4321");
  return `${siteUrl}/api/unsubscribe/test-not-linked`;
}

/**
 * Kirim email uji kampanye ke alamat allowlist (env TEST_SEND_ADDRESSES,
 * comma-separated, default "kelaswfa@gmail.com", case-insensitive):
 * - render locale id + en via renderForRecipient (linkRewrite identitas —
 *   tanpa click tracking; unsubscribeUrl test-not-linked)
 * - subject di-prefix "[TEST] "
 * - enqueue via outbox emailType "broadcast_test" dengan idempotencyKey
 *   unik per call (`test-<campaignId>-<locale>-<Date.now()>`)
 * - TIDAK membuat baris recipients/deliveries — statistik tak tersentuh
 * - audit "campaign_test_sent" dengan detail {address}
 */
export async function sendTestEmail(
  campaignId: string,
  address: string,
  auditOpts?: AuditOpts,
): Promise<SendTestResult> {
  const allow = env("TEST_SEND_ADDRESSES", "kelaswfa@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");
  if (!allow.includes(address.trim().toLowerCase())) {
    return { ok: false, reason: "not-allowed" };
  }

  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  const hasIdContent =
    !!campaign &&
    campaign.subjectId.trim() !== "" &&
    (campaign.preheaderId ?? "").trim() !== "" &&
    campaign.bodyHtmlId.trim() !== "";
  if (!campaign || !hasIdContent) {
    return { ok: false, reason: "no-content" };
  }

  const content: CampaignContent = {
    subjectId: campaign.subjectId,
    preheaderId: campaign.preheaderId ?? "",
    bodyHtmlId: campaign.bodyHtmlId,
    subjectEn: campaign.subjectEn,
    preheaderEn: campaign.preheaderEn,
    bodyHtmlEn: campaign.bodyHtmlEn,
  };
  const unsubscribeUrl = testUnsubscribeUrl();

  for (const locale of ["id", "en"] as const) {
    const rendered = renderForRecipient({
      campaign: content,
      locale,
      email: address,
      unsubscribeUrl,
      linkRewrite: (url) => url,
    });
    await enqueueTransactionalEmail({
      emailType: "broadcast_test",
      to: address,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `test-${campaignId}-${locale}-${Date.now()}`,
    });
  }

  await audit("campaign_test_sent", {
    adminUserId: auditOpts?.adminUserId,
    ip: auditOpts?.ip,
    detail: { address },
  });

  return { ok: true };
}
