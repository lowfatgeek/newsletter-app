import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { sendViaEmailit } from "../emailit";
import { env } from "../env";
import { contacts, emailCampaignRecipients, emailCampaigns, emailDeliveries } from "../schema";
import { EMAIL_FROM_CAMPAIGN, EMAIL_REPLY_TO_CAMPAIGN } from "../templates";
import { htmlToText } from "./content";
import { claimForSending, getCampaignForBroadcast, markCompleted, providerCaps } from "./machine";

/**
 * Worker broadcast (Task 6).
 *
 * SINGLE-FLIGHT: `claimForSending` (UPDATE ... SET status='sending'
 * WHERE id AND status='queued') adalah satu-satunya mekanisme mutual
 * exclusion — transisi status atomic menjamin hanya satu worker yang
 * berhasil mengklaim satu kampanye, sehingga advisory lock tidak
 * diperlukan. Claim gagal → tick ini berhenti.
 *
 * RENDER-AT-SNAPSHOT: worker TIDAK merender ulang. Baris recipient sudah
 * membawa email final di `lastRenderedHtml` (dirender saat snapshot,
 * berisi link click + unsubscribe dengan token raw per recipient).
 * Subject TIDAK ikut di-render ke html — worker melakukan substitusi
 * `{{email}}`/`{{locale}}` per-recipient dengan pilihan locale
 * (fallback ID bila EN kosong). Preheader sudah tertanam di html snapshot.
 *
 * PRIORITAS TRANSAKSIONAL: worker broadcast TIDAK menyentuh `email_outbox`
 * — jalur transaksional Plan 1 tetap berdiri sendiri. Worker mengalah
 * dengan berhenti setelah satu batch per tick (cron interval 1 menit,
 * budget = maxPerMinute kampanye).
 */

export type BroadcastStopReason =
  | "idle"
  | "claim-failed"
  | "minute-limit"
  | "hour-limit"
  | "day-limit"
  | "completed"
  | "completed-partial";

export interface BroadcastResult {
  campaignId: string | null;
  sent: number;
  skipped: number;
  stopped: BroadcastStopReason;
}

/** Ganti semua kemunculan `{{key}}` (pola sama dengan content.ts). */
function replaceVar(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

async function countDeliveriesForCampaign(campaignId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .innerJoin(emailCampaignRecipients, eq(emailDeliveries.campaignRecipientId, emailCampaignRecipients.id))
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), gte(emailDeliveries.sentAt, since)));
  return row?.n ?? 0;
}

async function countDeliveriesProvider(since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .where(gte(emailDeliveries.sentAt, since));
  return row?.n ?? 0;
}

/** Kembalikan klaim: sending → queued (tick berikutnya melanjutkan). */
async function releaseClaim(campaignId: string): Promise<void> {
  await db
    .update(emailCampaigns)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "sending")));
}

/**
 * Satu tick worker broadcast:
 * 1. promosikan scheduled yang jatuh tempo → queued
 * 2. klaim kampanye queued terlama (atomic via claimForSending)
 * 3. hitung pemakaian (menit/jam per kampanye, harian global provider)
 * 4. kirim batch sebesar budget; satu gagal tidak menghentikan batch
 * 5. habis → completed; masih ada pending → kembali queued
 */
export async function processBroadcast(opts?: { fetchImpl?: typeof fetch; now?: Date }): Promise<BroadcastResult> {
  const now = opts?.now ?? new Date();

  // Promosikan scheduled yang jatuh tempo.
  await db
    .update(emailCampaigns)
    .set({ status: "queued", updatedAt: now })
    .where(and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.scheduledAt, now)));

  // Pulihkan kampanye 'sending' yang menggantung akibat interupsi/crash server (> 5 menit).
  // Mengembalikan ke 'queued' agar tidak mengunci partial unique index email_campaigns_single_sending_uq.
  const STALE_SENDING_MS = 5 * 60_000;
  const staleThreshold = new Date(now.getTime() - STALE_SENDING_MS);
  await db
    .update(emailCampaigns)
    .set({ status: "queued", updatedAt: now })
    .where(and(eq(emailCampaigns.status, "sending"), lte(emailCampaigns.updatedAt, staleThreshold)));

  // Kampanye queued terlama. Baris 'cancelled'/'completed'/etc tidak
  // lolos filter status — pembatalan otomatis dihormati.
  const [next] = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, "queued"))
    .orderBy(asc(emailCampaigns.createdAt), asc(emailCampaigns.updatedAt))
    .limit(1);
  if (!next) return { campaignId: null, sent: 0, skipped: 0, stopped: "idle" };

  if (!(await claimForSending(next.id))) {
    return { campaignId: next.id, sent: 0, skipped: 0, stopped: "claim-failed" };
  }

  const campaign = await getCampaignForBroadcast(next.id);
  if (!campaign) {
    return { campaignId: next.id, sent: 0, skipped: 0, stopped: "claim-failed" };
  }

  const stopWith = async (reason: "minute-limit" | "hour-limit" | "day-limit"): Promise<BroadcastResult> => {
    await releaseClaim(campaign.id);
    return { campaignId: campaign.id, sent: 0, skipped: 0, stopped: reason };
  };

  // Batas pemakaian. Kapasitas harian provider GLOBAL: semua baris
  // emailDeliveries hari ini (semua kampanye, semua email_type).
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sentTodayProvider = await countDeliveriesProvider(startOfTodayUtc);
  if (sentTodayProvider >= providerCaps().maxPerDay) return stopWith("day-limit");

  const sentThisMinute = await countDeliveriesForCampaign(campaign.id, new Date(now.getTime() - 60_000));
  const minuteBudget = campaign.maxPerMinute - sentThisMinute;
  if (minuteBudget <= 0) return stopWith("minute-limit");

  const sentThisHour = await countDeliveriesForCampaign(campaign.id, new Date(now.getTime() - 3_600_000));
  const hourBudget = campaign.maxPerHour - sentThisHour;
  if (hourBudget <= 0) return stopWith("hour-limit");

  const budget = Math.min(minuteBudget, hourBudget);

  const rows = await db
    .select({
      id: emailCampaignRecipients.id,
      contactId: emailCampaignRecipients.contactId,
      email: contacts.emailNormalized,
      locale: emailCampaignRecipients.localeSelected,
      html: emailCampaignRecipients.lastRenderedHtml,
    })
    .from(emailCampaignRecipients)
    .innerJoin(contacts, eq(emailCampaignRecipients.contactId, contacts.id))
    .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.status, "pending")))
    .orderBy(asc(emailCampaignRecipients.createdAt))
    .limit(budget);

  const mockMode = env("MO_BROADCAST", "false") === "true";
  let sent = 0;
  let skipped = 0;

  for (const row of rows) {
    const locale = row.locale === "en" ? "en" : "id";

    if (!row.html) {
      // Snapshot rusak/tidak lengkap: gagal per-recipient, batch lanjut.
      await db.update(emailCampaignRecipients).set({ status: "failed" }).where(eq(emailCampaignRecipients.id, row.id));
      await db.insert(emailDeliveries).values({
        contactId: row.contactId,
        campaignRecipientId: row.id,
        emailType: "broadcast",
        status: "failed",
        error: "missing-render",
        sentAt: now,
      });
      skipped++;
      continue;
    }

    // Pilihan locale subject dengan fallback ID per field.
    const pick = (idVal: string, enVal?: string | null): string => (locale === "en" && enVal?.trim() ? enVal : idVal);
    const subject = replaceVar(
      replaceVar(pick(campaign.subjectId, campaign.subjectEn), "email", row.email),
      "locale",
      locale,
    );

    try {
      const providerMessageId = mockMode
        ? `mo-${row.id}`
        : await sendViaEmailit(
            {
              from: EMAIL_FROM_CAMPAIGN,
              replyTo: EMAIL_REPLY_TO_CAMPAIGN,
              to: row.email,
              subject,
              html: row.html,
              text: htmlToText(row.html),
              idempotencyKey: `bc-${campaign.id}-${row.id}`,
            },
            opts?.fetchImpl,
          );

      await db.insert(emailDeliveries).values({
        contactId: row.contactId,
        campaignRecipientId: row.id,
        providerMessageId,
        emailType: "broadcast",
        status: "accepted",
        sentAt: now,
      });
      await db.update(emailCampaignRecipients).set({ status: "sent" }).where(eq(emailCampaignRecipients.id, row.id));
      sent++;
    } catch (err) {
      await db.insert(emailDeliveries).values({
        contactId: row.contactId,
        campaignRecipientId: row.id,
        emailType: "broadcast",
        status: "failed",
        error: String(err).slice(0, 500),
        sentAt: now,
      });
      await db.update(emailCampaignRecipients).set({ status: "failed" }).where(eq(emailCampaignRecipients.id, row.id));
      skipped++;
    }
  }

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.status, "pending")));

  if ((remaining?.n ?? 0) === 0) {
    await markCompleted(campaign.id);
    return { campaignId: campaign.id, sent, skipped, stopped: "completed" };
  }

  // Masih ada pending (budget habis / sebagian gagal): kembali queued —
  // tick berikutnya melanjutkan.
  await releaseClaim(campaign.id);
  return { campaignId: campaign.id, sent, skipped, stopped: "completed-partial" };
}
