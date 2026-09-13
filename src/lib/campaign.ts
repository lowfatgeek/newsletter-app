import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { doaSelections, doaTemplates, rewardCampaignLocales, rewardCampaigns } from "./schema";
import type { Locale } from "./i18n";

export type PublishedCampaign = NonNullable<Awaited<ReturnType<typeof getPublishedCampaign>>>;

export async function getPublishedCampaign(slug: string) {
  const [campaign] = await db
    .select()
    .from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.slug, slug), eq(rewardCampaigns.status, "published")));
  if (!campaign) return null;

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
