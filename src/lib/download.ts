import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { rewardAssets, rewardCampaigns, rewardClaims } from "./schema";
import { consumeToken } from "./access";
import { presignDownloadUrl, assertAssetDownloadable } from "./storage";
import { isValidUuid } from "./uuid";

export const DOWNLOAD_URL_TTL_SEC = 3600;

export async function resolveDownload(
  sessionToken: string,
  assetId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  // Guard 1.9: assetId non-UUID → tolak sebelum query (hindari 22P02 → 500).
  if (!isValidUuid(assetId)) return { ok: false };
  const sess = await consumeToken(sessionToken, "session");
  if (!sess.ok) return { ok: false };
  const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, sess.claimId));
  if (!claim) return { ok: false };
  // Asset harus milik claim ini — asset dari campaign lain tidak boleh diunduh.
  const [asset] = await db.select().from(rewardAssets)
    .where(and(eq(rewardAssets.id, assetId), eq(rewardAssets.campaignId, claim.campaignId)));
  if (!asset) return { ok: false };
  try {
    assertAssetDownloadable({ mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
    return { ok: true, url: await presignDownloadUrl(asset.storageKey, DOWNLOAD_URL_TTL_SEC) };
  } catch {
    return { ok: false };
  }
}

export async function resolveFeaturedImage(
  key: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  // Hanya featured_image_key milik campaign published yang boleh disajikan.
  const [camp] = await db.select().from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.featuredImageKey, key), eq(rewardCampaigns.status, "published")));
  if (!camp) return { ok: false };
  return { ok: true, url: await presignDownloadUrl(key, DOWNLOAD_URL_TTL_SEC) };
}
