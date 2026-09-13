import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import {
  emailCampaigns, emailCampaignRecipients, type EmailCampaign,
} from "../schema";
import { validateContent } from "./content";
import { snapshotRecipients } from "./snapshot";
import { audit } from "../admin/audit";

/**
 * Status machine kampanye broadcast.
 *
 * draft ──schedule──> scheduled ──(worker, waktunya tiba)──> queued
 * draft ──send-now──> queued
 * queued ──claim (atomic)──> sending ──> completed | failed
 * sending ──pause──> paused ──resume──> queued
 * scheduled | queued | paused ──cancel──> cancelled (+ recipient pending → cancelled)
 *
 * Error kampanye TIDAK disimpan di baris kampanye — lihat emailDeliveries.
 */

export type AuditOpts = { adminUserId?: string; ip?: string };
type TransitionResult = { ok: true } | { ok: false; reason: "not-found" | "invalid-transition" };

/** Kapasitas provider dari env (dipakai validateLimits & worker Task 6). */
export function providerCaps(): { maxPerSecond: number; maxPerDay: number } {
  const parse = (name: string, fallback: number): number => {
    const n = Number.parseInt(env(name, String(fallback)), 10);
    return Number.isNaN(n) ? fallback : n;
  };
  return {
    maxPerSecond: parse("EMAILIT_MAX_PER_SECOND", 2),
    maxPerDay: parse("EMAILIT_MAX_PER_DAY", 5000),
  };
}

/**
 * Validasi rate limit kampanye terhadap kapasitas provider:
 * - keduanya integer positif
 * - maxPerMinute <= maxPerHour
 * - maxPerMinute * 60 <= cap harian (throughput jam tidak melebihi kapasitas hari)
 * - maxPerHour <= cap harian
 */
export function validateLimits(
  maxPerMinute: number,
  maxPerHour: number,
): { ok: true } | { ok: false; reason: "non-positive" | "exceeds-provider" } {
  if (
    !Number.isInteger(maxPerMinute) || !Number.isInteger(maxPerHour) ||
    maxPerMinute <= 0 || maxPerHour <= 0
  ) {
    return { ok: false, reason: "non-positive" };
  }
  const { maxPerDay } = providerCaps();
  if (maxPerMinute > maxPerHour || maxPerMinute * 60 > maxPerDay || maxPerHour > maxPerDay) {
    return { ok: false, reason: "exceeds-provider" };
  }
  return { ok: true };
}

/** Baca baris kampanye untuk machine/worker; null bila tidak ada. */
export async function getCampaignForBroadcast(id: string): Promise<EmailCampaign | null> {
  const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
  return row ?? null;
}

export type ScheduleResult =
  | { ok: true; status: "scheduled" | "queued" }
  | { ok: false; reason: "missing-id" | "not-draft" | "in-past" }
  | { ok: false; reason: "limits"; detail: { maxPerMinute: number; maxPerHour: number } };

/**
 * Jadwalkan kampanye atau kirim sekarang:
 * - hanya dari draft (idempoten — schedule kedua → not-draft)
 * - validasi konten tersimpan (kolom ID wajib lengkap)
 * - validasi limits terhadap kapasitas provider
 * - scheduledAt di masa lalu → in-past
 * - snapshot recipients (render-at-snapshot) + snapshotAt
 * - status: scheduled (scheduledAt masa depan) | queued (send-now, scheduledAt null)
 * - audit campaign_scheduled {recipients, scheduledAt}
 */
export async function scheduleCampaign(
  id: string,
  opts: { scheduledAt: Date | null },
  auditOpts?: AuditOpts,
): Promise<ScheduleResult> {
  const campaign = await getCampaignForBroadcast(id);
  if (!campaign || campaign.status !== "draft") {
    return { ok: false, reason: "not-draft" };
  }

  const content = validateContent({
    subjectId: campaign.subjectId,
    preheaderId: campaign.preheaderId ?? "",
    bodyHtmlId: campaign.bodyHtmlId,
    subjectEn: campaign.subjectEn,
    preheaderEn: campaign.preheaderEn,
    bodyHtmlEn: campaign.bodyHtmlEn,
  });
  if (!content.ok) return { ok: false, reason: "missing-id" };

  const limits = validateLimits(campaign.maxPerMinute, campaign.maxPerHour);
  if (!limits.ok) {
    return {
      ok: false,
      reason: "limits",
      detail: { maxPerMinute: campaign.maxPerMinute, maxPerHour: campaign.maxPerHour },
    };
  }

  if (opts.scheduledAt && opts.scheduledAt.getTime() <= Date.now()) {
    return { ok: false, reason: "in-past" };
  }

  const { recipients } = await snapshotRecipients(id);
  const status = opts.scheduledAt ? "scheduled" : "queued";
  await db.update(emailCampaigns)
    .set({ status, scheduledAt: opts.scheduledAt, snapshotAt: new Date(), updatedAt: new Date() })
    .where(eq(emailCampaigns.id, id));

  await audit("campaign_scheduled", {
    adminUserId: auditOpts?.adminUserId,
    ip: auditOpts?.ip,
    detail: {
      campaignId: id,
      recipients: recipients.length,
      scheduledAt: opts.scheduledAt ? opts.scheduledAt.toISOString() : null,
    },
  });

  return { ok: true, status };
}

/**
 * Klaim kampanye queued untuk dikirim worker — atomic:
 * UPDATE ... SET status='sending' WHERE id AND status='queued' RETURNING.
 * Dua worker yang berebut hanya satu yang berhasil.
 */
export async function claimForSending(campaignId: string): Promise<boolean> {
  const rows = await db.update(emailCampaigns)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "queued")))
    .returning({ id: emailCampaigns.id });
  return rows.length > 0;
}

/** Transisi status atomic dengan audit; membedakan not-found vs invalid-transition. */
async function transition(
  id: string,
  from: string[],
  to: string,
  auditAction: string,
  detail: Record<string, unknown>,
  auditOpts?: AuditOpts,
): Promise<TransitionResult> {
  const rows = await db.update(emailCampaigns)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, id), inArray(emailCampaigns.status, from)))
    .returning({ id: emailCampaigns.id });
  if (rows.length > 0) {
    await audit(auditAction, {
      adminUserId: auditOpts?.adminUserId,
      ip: auditOpts?.ip,
      detail: { campaignId: id, ...detail },
    });
    return { ok: true };
  }
  const [existing] = await db.select({ id: emailCampaigns.id })
    .from(emailCampaigns).where(eq(emailCampaigns.id, id));
  return existing ? { ok: false, reason: "invalid-transition" } : { ok: false, reason: "not-found" };
}

/** sending → completed. */
export async function markCompleted(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
  return transition(id, ["sending"], "completed", "campaign_sent", {}, auditOpts);
}

/**
 * sending | queued → failed. Error TIDAK disimpan di kampanye —
 * kegagalan per-penerima terlihat via emailDeliveries.
 */
export async function markFailed(id: string, error: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
  return transition(id, ["sending", "queued"], "failed", "broadcast_failed", { error }, auditOpts);
}

/** sending → paused. */
export async function pauseCampaign(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
  return transition(id, ["sending"], "paused", "campaign_paused", {}, auditOpts);
}

/** paused → queued (diproses ulang worker). */
export async function resumeCampaign(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
  return transition(id, ["paused"], "queued", "campaign_resumed", {}, auditOpts);
}

/**
 * scheduled | queued | paused → cancelled, dan semua recipient berstatus
 * pending ikut dibatalkan (yang sudah sent/failed tidak disentuh).
 */
export async function cancelCampaign(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
  const res = await transition(id, ["scheduled", "queued", "paused"], "cancelled", "campaign_cancelled", {}, auditOpts);
  if (res.ok) {
    await db.update(emailCampaignRecipients)
      .set({ status: "cancelled" })
      .where(and(
        eq(emailCampaignRecipients.campaignId, id),
        eq(emailCampaignRecipients.status, "pending"),
      ));
  }
  return res;
}
