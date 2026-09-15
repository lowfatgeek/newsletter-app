import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { doaSelections, doaTemplates, rewardCampaignLocales, rewardCampaigns } from "./schema";
import type { Locale } from "./i18n";

export type PublishedCampaign = NonNullable<Awaited<ReturnType<typeof getPublishedCampaign>>>;

// Status publik campaign untuk halaman funnel:
// - hidden    → draft/archived/slug tidak ada → 404
// - paused    → halaman ramah "campaign dijeda" (klaim baru ditolak, klaim lama tetap valid)
// - published → render normal
export async function getPublicCampaignState(
  slug: string,
): Promise<{ state: "hidden" | "paused" | "published" }> {
  const r = await getPublicCampaignWithContent(slug);
  return { state: r.state };
}

/**
 * Sumber tunggal lifecycle + konten halaman reward (task 2.4 / 07-P1):
 * dulu halaman r/[slug] memanggil getPublicCampaignState lalu
 * getPublishedCampaign — dua query reward_campaign untuk slug yang sama.
 * Sekarang satu query state; konten hanya dimuat bila perlu.
 * Domain status reward_campaign = draft | published | paused | archived,
 * sehingga "bukan published" ≡ hidden/published; published ⇒ konten non-null
 * (localeRow tetap bisa kosong → halaman 404 via pengecekan localeRow).
 */
export async function getPublicCampaignWithContent(slug: string): Promise<
  | { state: "hidden" }
  | { state: "paused" }
  | { state: "published"; data: PublishedCampaign }
> {
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp || camp.status === "draft" || camp.status === "archived") return { state: "hidden" };
  if (camp.status === "paused") return { state: "paused" };
  const data = await loadCampaignContent(camp);
  return { state: "published", data };
}

export async function getPublishedCampaign(slug: string) {
  const [campaign] = await db
    .select()
    .from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.slug, slug), eq(rewardCampaigns.status, "published")));
  if (!campaign) return null;
  return loadCampaignContent(campaign);
}

// Konten campaign tanpa cek status — dipakai halaman /akses: klaim lama
// tetap bisa diunduh walau campaign sudah paused/draft/archived (PRD 7.1).
export async function getCampaignContent(slug: string) {
  const [campaign] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!campaign) return null;
  return loadCampaignContent(campaign);
}

async function loadCampaignContent(campaign: typeof rewardCampaigns.$inferSelect) {
  const rows = await db
    .select()
    .from(rewardCampaignLocales)
    .where(eq(rewardCampaignLocales.campaignId, campaign.id));
  const picks = await db
    .select()
    .from(doaSelections)
    .where(eq(doaSelections.campaignId, campaign.id));

  const doaText = async (variant: "muslim" | "universal", locale: Locale): Promise<string> => {
    const sel = picks.find((p) => p.variant === variant);
    if (!sel) return "";
    const [tpl] = await db.select().from(doaTemplates).where(eq(doaTemplates.id, sel.templateId));
    if (!tpl) return "";
    if (tpl.locale === locale) return tpl.content;
    // Cari template bernama sama di locale yang diminta; kalau tidak ada,
    // pakai konten template yang dipilih apa adanya (fallback eksplisit).
    const [alt] = await db
      .select()
      .from(doaTemplates)
      .where(
        and(
          eq(doaTemplates.variant, variant),
          eq(doaTemplates.locale, locale),
          eq(doaTemplates.name, tpl.name),
        ),
      );
    return alt?.content ?? tpl.content;
  };

  return {
    campaign,
    localeRow: (
      locale: Locale,
    ): { row: (typeof rewardCampaignLocales.$inferSelect) | undefined; fallbackToId: boolean } => {
      const want = rows.find((r) => r.locale === locale);
      if (want) return { row: want, fallbackToId: false };
      const base = rows.find((r) => r.locale === "id");
      return { row: base, fallbackToId: locale === "en" };
    },
    doaText,
  };
}
