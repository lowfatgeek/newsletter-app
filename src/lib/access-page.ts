import { eq } from "drizzle-orm";
import { consumeToken, issueSessionToken } from "./access";
import { getCampaignContent } from "./campaign";
import { db } from "./db";
import { rewardCampaigns, rewardClaims } from "./schema";

type Content = NonNullable<Awaited<ReturnType<typeof getCampaignContent>>>;

export type ResolvedAccess =
  | {
      ok: true;
      // Session token untuk link unduhan: token session yang dibawa user,
      // atau session baru hasil penukaran token "access" sekali pakai.
      sessionToken: string;
      campaignId: string;
      content: Content;
    }
  | { ok: false };

/**
 * Resolver halaman /akses/<token>:
 * - Terima token "session" (reusable 1 jam) ATAU token "access" sekali pakai.
 *   Token "access" ditukar menjadi session baru supaya anchor unduhan di
 *   halaman memakai session yang masih valid.
 * - Campaign dimuat TANPA cek status: klaim lama tetap berfungsi walau
 *   campaign paused/draft/archived (PRD 7.1 — paused hanya memblok klaim baru).
 * - Gagal hanya bila token tidak valid, claim/campaign/locale hilang.
 */
export async function resolveAccess(rawToken: string): Promise<ResolvedAccess> {
  const sess = await consumeToken(rawToken, "session");
  let claimId: string;
  let sessionToken = rawToken;
  if (sess.ok) {
    claimId = sess.claimId;
  } else {
    const acc = await consumeToken(rawToken, "access");
    if (!acc.ok) return { ok: false };
    claimId = acc.claimId;
    sessionToken = await issueSessionToken(claimId);
  }

  const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, claimId));
  if (!claim) return { ok: false };

  const [campaign] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, claim.campaignId));
  if (!campaign) return { ok: false };

  const content = await getCampaignContent(campaign.slug);
  if (!content) return { ok: false };

  return { ok: true, sessionToken, campaignId: claim.campaignId, content };
}
