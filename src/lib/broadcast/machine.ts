import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../admin/audit";
import { db } from "../db";
import { env } from "../env";
import { type EmailCampaign, emailCampaignRecipients, emailCampaigns } from "../schema";
import { isValidUuid } from "../uuid";
import { validateContent } from "./content";
import { snapshotRecipients } from "./snapshot";

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

export type AuditOpts = { adminUserId?: string | null; ip?: string };
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
  if (!Number.isInteger(maxPerMinute) || !Number.isInteger(maxPerHour) || maxPerMinute <= 0 || maxPerHour <= 0) {
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
  // Guard 1.9: id non-UUID → null, bukan error 22P02 dari Postgres.
  if (!isValidUuid(id)) return null;
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
  await db
    .update(emailCampaigns)
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
 * UPDATE ... SET status='sending' WHERE id AND status='queued'
 * AND NOT EXISTS (campaign LAIN berstatus 'sending') RETURNING.
 * Dua worker yang berebut hanya satu yang berhasil, dan tidak pernah ada dua
 * campaign berbeda berstatus sending bersamaan (PRD §7.4). Campaign sendiri
 * dikecualikan agar retry klaim idempoten (klaim ulang campaign yang sudah
 * sending → false via status='queued', bukan via guard ini).
 *
 * Invariant single-sending juga ditegakkan di level DB lewat partial unique
 * index `email_campaigns_single_sending_uq` (lihat schema.ts): di isolasi
 * READ COMMITTED, klausa NOT EXISTS saja masih bisa dilewati dua runner yang
 * benar-benar paralel. Klaim yang kalah oleh index tersebut melempar
 * PostgresError code 23505 (unique_violation) — kita terjemahkan menjadi
 * `false`, sama seperti kalah lewat WHERE clause. Catatan: drizzle-orm 0.45
 * membungkus PostgresError dalam DrizzleQueryError (code ada di `.cause`),
 * sedangkan postgres-js telanjang menyimpannya langsung di error.
 */
export async function claimForSending(campaignId: string): Promise<boolean> {
  try {
    const rows = await db
      .update(emailCampaigns)
      .set({ status: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(emailCampaigns.id, campaignId),
          eq(emailCampaigns.status, "queued"),
          sql`not exists (select 1 from email_campaigns ec where ec.status = 'sending' and ec.id <> ${campaignId})`,
        ),
      )
      .returning({ id: emailCampaigns.id });
    return rows.length > 0;
  } catch (err) {
    // 23505 = unique_violation: campaign lain menang klaim lebih dulu.
    if (pgErrorCode(err) === "23505") return false;
    throw err;
  }
}

/** Ambil SQLSTATE dari error postgres-js, termasuk yang dibungkus drizzle. */
function pgErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = err as { code?: string; cause?: unknown } | null | undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string") return current.code;
    current = current.cause as { code?: string; cause?: unknown } | undefined;
  }
  return undefined;
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
  // Guard 1.9: id non-UUID = tidak mungkin ada barisnya; jangan sampai
  // UPDATE menyentuh kolom uuid dengan nilai ilegal (22P02 → 500).
  if (!isValidUuid(id)) return { ok: false, reason: "not-found" };
  const rows = await db
    .update(emailCampaigns)
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
  const [existing] = await db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.id, id));
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
    await db
      .update(emailCampaignRecipients)
      .set({ status: "cancelled" })
      .where(and(eq(emailCampaignRecipients.campaignId, id), eq(emailCampaignRecipients.status, "pending")));
  }
  return res;
}
