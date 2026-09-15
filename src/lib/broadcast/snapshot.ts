import { eq, inArray } from "drizzle-orm";
import { generateOpaqueToken, hashToken } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { contacts, emailCampaignRecipients, emailCampaigns, emailLinks } from "../schema";
import { type AudienceFilter, type AudienceLocale, resolveAudience } from "./audience";
import { type CampaignContent, decodeEntities, renderForRecipient } from "./content";

const HTTPS_HREF_RE = /href="(https:\/\/[^"]+)"/g;

/**
 * Ekstrak semua href https unik dari kedua body kampanye, upsert ke
 * emailLinks (hash = hashToken(url)), dan kembalikan Map url → linkId
 * untuk dipakai saat render click-tracking.
 */
export async function prepareLinks(
  campaignId: string,
  bodyHtmlId: string,
  bodyHtmlEn?: string | null,
): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const body of [bodyHtmlId, bodyHtmlEn]) {
    if (!body) continue;
    for (const m of body.matchAll(HTTPS_HREF_RE)) {
      // href di atribut html di-escape oleh sanitize-html (&amp;) —
      // simpan URL asli (decoded) supaya redirect click tidak rusak.
      urls.add(decodeEntities(m[1]));
    }
  }

  const map = new Map<string, string>();
  for (const url of urls) {
    const [row] = await db
      .insert(emailLinks)
      .values({ campaignId, urlHash: hashToken(url), url })
      .onConflictDoUpdate({
        target: emailLinks.urlHash,
        set: { campaignId, url },
      })
      .returning({ id: emailLinks.id });
    map.set(url, row.id);
  }
  return map;
}

export interface SnapshotRecipient {
  recipientId: string;
  contactId: string;
  clickToken: string;
  locale: AudienceLocale;
}

/**
 * Snapshot audience kampanye (render-at-snapshot):
 * - resolveAudience dari filter tersimpan
 * - prepareLinks untuk body tersimpan
 * - per contact baru: generate raw clickToken (disimpan HANYA sebagai hash
 *   di clickTokenHash), insert row recipient idempoten
 *   (onConflictDoNothing — baris lama mempertahankan token & html),
 * - render final email langsung saat snapshot (locale dari audience,
 *   link click + unsubscribe memakai raw token) ke lastRenderedHtml.
 * - set snapshotAt kampanye.
 *
 * Return hanya recipient yang BARU dibuat; raw token tidak pernah
 * disimpan di database (hanya ada di return value ini, tertanam di
 * lastRenderedHtml yang sudah dirender, dan URL email saat dikirim).
 */
export async function snapshotRecipients(campaignId: string): Promise<{ recipients: SnapshotRecipient[] }> {
  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const siteUrl = env("PUBLIC_SITE_URL", "http://localhost:4321");
  const audience = await resolveAudience(campaign.audienceFilter as AudienceFilter);
  const links = await prepareLinks(campaignId, campaign.bodyHtmlId, campaign.bodyHtmlEn);

  // Email per contact untuk variabel {{email}} (contact hanya punya emailNormalized).
  const contactIds = audience.map((a) => a.contactId);
  const emailById = new Map<string, string>();
  if (contactIds.length > 0) {
    const rows = await db
      .select({ id: contacts.id, email: contacts.emailNormalized })
      .from(contacts)
      .where(inArray(contacts.id, contactIds));
    for (const r of rows) emailById.set(r.id, r.email);
  }

  const content: CampaignContent = {
    subjectId: campaign.subjectId,
    preheaderId: campaign.preheaderId ?? "",
    bodyHtmlId: campaign.bodyHtmlId,
    subjectEn: campaign.subjectEn,
    preheaderEn: campaign.preheaderEn,
    bodyHtmlEn: campaign.bodyHtmlEn,
  };

  const recipients: SnapshotRecipient[] = [];
  for (const { contactId, locale } of audience) {
    const rawToken = generateOpaqueToken();

    // Render SEKALIGUS sebelum insert supaya INSERT bersifat atomik
    // (row tidak mungkin tersimpan tanpa lastRenderedHtml — crash di
    // tengah snapshot tidak meninggalkan baris yang tak pernah
    // di-render ulang oleh snapshot berikutnya).
    const rendered = renderForRecipient({
      campaign: content,
      locale,
      email: emailById.get(contactId) ?? "",
      unsubscribeUrl: `${siteUrl}/api/unsubscribe/${rawToken}`,
      linkRewrite: (url) => `${siteUrl}/api/click/${links.get(url)}/${rawToken}`,
    });

    const inserted = await db
      .insert(emailCampaignRecipients)
      .values({
        campaignId,
        contactId,
        localeSelected: locale,
        clickTokenHash: hashToken(rawToken),
        lastRenderedHtml: rendered.html,
      })
      .onConflictDoNothing({
        target: [emailCampaignRecipients.campaignId, emailCampaignRecipients.contactId],
      })
      .returning({ id: emailCampaignRecipients.id });
    if (inserted.length === 0) continue; // sudah di-snapshot: token & html lama dipertahankan

    recipients.push({ recipientId: inserted[0].id, contactId, clickToken: rawToken, locale });
  }

  await db.update(emailCampaigns).set({ snapshotAt: new Date() }).where(eq(emailCampaigns.id, campaignId));

  return { recipients };
}
