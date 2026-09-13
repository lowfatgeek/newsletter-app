import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { emailCampaignRecipients, emailLinks } from "../schema";
import { hashToken } from "../crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve klik link broadcast dengan aman:
 * - linkId dan token wajib terisi, linkId wajib berformat uuid (query dengan
 *   string non-uuid akan melempar error postgres → guard dulu di sini).
 * - url di emailLinks tersimpan sudah decoded (lihat prepareLinks), token raw
 *   dicocokkan ke emailCampaignRecipients.clickTokenHash.
 * - recipient wajib milik campaign yang sama dengan link (mismatch → gagal,
 *   jangan bocorkan url lintas campaign).
 * - Klik pertama dicatat idempoten: coalesce(clicked_at, now()) — klik
 *   berikutnya tidak mengubah timestamp pertama.
 */
export async function resolveClick(
  linkId: string,
  rawToken: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  if (!rawToken || !UUID_RE.test(linkId)) return { ok: false };

  const [link] = await db.select().from(emailLinks).where(eq(emailLinks.id, linkId));
  if (!link) return { ok: false };

  const [recipient] = await db
    .select()
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.clickTokenHash, hashToken(rawToken)));
  if (!recipient || recipient.campaignId !== link.campaignId) return { ok: false };

  await db
    .update(emailCampaignRecipients)
    .set({ clickedAt: sql`coalesce(${emailCampaignRecipients.clickedAt}, now())` })
    .where(eq(emailCampaignRecipients.id, recipient.id));

  return { ok: true, url: link.url };
}
