import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { rewardAssets, rewardCampaigns } from "./schema";

/**
 * Query halaman reward publik (task 3.8 / 04-N1 — dipindahkan dari
 * `src/pages/index.astro`, `src/pages/akses/[token].astro`, dan
 * `src/pages/en/akses/[token].astro` supaya file halaman tetap view/presentasi).
 */

/**
 * Slug campaign published dengan sortOrder terkecil (fallback: terlama).
 * Halaman "/" memakai ini untuk mengarahkan pengunjung ke campaign unggulan.
 */
export async function firstPublishedCampaignSlug(): Promise<string | null> {
  const [row] = await db
    .select({ slug: rewardCampaigns.slug })
    .from(rewardCampaigns)
    .where(eq(rewardCampaigns.status, "published"))
    .orderBy(asc(rewardCampaigns.sortOrder), asc(rewardCampaigns.createdAt))
    .limit(1);
  return row?.slug ?? null;
}

/** Semua aset unduhan milik campaign, urut sortOrder (dipakai halaman akses). */
export async function listCampaignAssets(campaignId: string) {
  return db
    .select()
    .from(rewardAssets)
    .where(eq(rewardAssets.campaignId, campaignId))
    .orderBy(asc(rewardAssets.sortOrder));
}
