import { eq } from "drizzle-orm";
import { audit } from "../admin/audit";
import { db } from "../db";
import { type EmailCampaign, emailCampaigns } from "../schema";
import { isValidUuid } from "../uuid";
import { type AudienceFilter, validateFilter } from "./audience";
import { sanitizeBody } from "./content";

/**
 * Persistence seam admin untuk email campaign (Task 11).
 *
 * KONTRAK PERSISTENCE (ruling Task 3-4): body HTML yang disimpan ke
 * database SELALU hasil `sanitizeBody(...)` — fungsi ini menerima HTML
 * mentah dari textarea editor dan menyimpan versi sanitized. HTML mentah
 * hanya pernah ada di editor, tidak pernah di database.
 *
 * Konten hanya bisa diubah saat draft — setelah schedule/send konten
 * terkunci (update → not-draft).
 */

export type AuditOpts = { adminUserId?: string | null; ip?: string };

/**
 * Default limit kampanye baru: 60/menit dan 600/jam — aman terhadap
 * kapasitas provider default (2 pesan/detik, 5.000/hari; lihat
 * validateLimits) dan bisa diubah admin di composer sebelum schedule.
 */
export const DEFAULT_MAX_PER_MINUTE = 60;
export const DEFAULT_MAX_PER_HOUR = 600;

export interface DraftPatch {
  subjectId: string;
  preheaderId: string;
  bodyHtmlId: string;
  subjectEn?: string | null;
  preheaderEn?: string | null;
  bodyHtmlEn?: string | null;
  /**
   * Filter audiens. `undefined` (kunci tidak dikirim client) → pertahankan
   * nilai tersimpan — server TIDAK PERNAH mensintesis `{all:true}` sebagai
   * fallback. Payload ada tapi tidak lolos `validateFilter` → invalid-filter.
   */
  audienceFilter?: unknown;
  maxPerMinute: number;
  maxPerHour: number;
}

/**
 * Buat campaign baru berstatus draft dengan konten kosong,
 * audienceFilter {all:true}, dan limit default. Return id.
 */
export async function createEmailCampaign(auditOpts?: AuditOpts): Promise<string> {
  const [row] = await db
    .insert(emailCampaigns)
    .values({
      status: "draft",
      subjectId: "",
      bodyHtmlId: "",
      audienceFilter: { all: true },
      maxPerMinute: DEFAULT_MAX_PER_MINUTE,
      maxPerHour: DEFAULT_MAX_PER_HOUR,
    })
    .returning({ id: emailCampaigns.id });

  await audit("campaign_created", {
    adminUserId: auditOpts?.adminUserId,
    ip: auditOpts?.ip,
    detail: { campaignId: row.id },
  });
  return row.id;
}

export type UpdateDraftResult = { ok: true } | { ok: false; reason: "not-found" | "not-draft" | "invalid-filter" };

/**
 * Simpan draft: subject/preheader/body ID+EN, audience filter (divalidasi),
 * dan rate limit. Body HTML disimpan sebagai hasil `sanitizeBody` —
 * Lihat kontrak persistence di atas. Kolom EN kosong → null (fallback ID).
 * Hanya dari draft; setelah schedule konten terkunci.
 */
export async function updateEmailCampaignDraft(
  id: string,
  patch: DraftPatch,
  auditOpts?: AuditOpts,
): Promise<UpdateDraftResult> {
  const [campaign] = await db
    .select({ status: emailCampaigns.status, audienceFilter: emailCampaigns.audienceFilter })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, id));
  if (!campaign) return { ok: false, reason: "not-found" };
  if (campaign.status !== "draft") return { ok: false, reason: "not-draft" };

  let filter: AudienceFilter;
  if (patch.audienceFilter === undefined) {
    // Kunci tidak dikirim → pertahankan filter tersimpan (bukan fallback
    // {all:true}) — defense in depth terhadap client yang gagal membangun
    // filter segmen.
    filter = (campaign.audienceFilter ?? {}) as AudienceFilter;
  } else {
    const validated = validateFilter(patch.audienceFilter);
    if (!validated.ok) return { ok: false, reason: "invalid-filter" };
    filter = validated.filter;
  }

  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };

  await db
    .update(emailCampaigns)
    .set({
      subjectId: patch.subjectId.trim(),
      preheaderId: patch.preheaderId.trim(),
      // Persistence seam: simpan hasil sanitizeBody, bukan HTML mentah admin.
      bodyHtmlId: sanitizeBody(patch.bodyHtmlId),
      subjectEn: trimOrNull(patch.subjectEn),
      preheaderEn: trimOrNull(patch.preheaderEn),
      bodyHtmlEn: patch.bodyHtmlEn?.trim() ? sanitizeBody(patch.bodyHtmlEn) : null,
      audienceFilter: filter,
      maxPerMinute: patch.maxPerMinute,
      maxPerHour: patch.maxPerHour,
      updatedAt: new Date(),
    })
    .where(eq(emailCampaigns.id, id));

  await audit("campaign_draft_saved", {
    adminUserId: auditOpts?.adminUserId,
    ip: auditOpts?.ip,
    detail: { campaignId: id },
  });
  return { ok: true };
}

/** Baris kampanye lengkap untuk composer; null bila tidak ada. */
export async function getEmailCampaignById(id: string): Promise<EmailCampaign | null> {
  // Guard 1.9: id non-UUID → null, hindari error 22P02 (500) dari Postgres.
  if (!isValidUuid(id)) return null;
  const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
  return row ?? null;
}
