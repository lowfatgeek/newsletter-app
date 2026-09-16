import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { issueSessionToken, upsertClaim } from "../src/lib/access";
import { getPublicCampaignState } from "../src/lib/campaign";
import { db } from "../src/lib/db";
import { resolveDownload } from "../src/lib/download";
import { contacts, rewardAssets, rewardCampaigns } from "../src/lib/schema";
import { resetDb, setEnv } from "./helpers";

beforeEach(async () => {
  await resetDb();
  setEnv({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "b",
    MOCK_R2: "false",
  });
});

describe("public lifecycle gating", () => {
  it("draft and archived are hidden", async () => {
    await db.insert(rewardCampaigns).values({ slug: "d1", status: "draft" });
    await db.insert(rewardCampaigns).values({ slug: "d2", status: "archived" });
    expect(await getPublicCampaignState("d1")).toEqual({ state: "hidden" });
    expect(await getPublicCampaignState("d2")).toEqual({ state: "hidden" });
  });
  it("paused is friendly-blocked", async () => {
    await db.insert(rewardCampaigns).values({ slug: "p1", status: "paused" });
    expect(await getPublicCampaignState("p1")).toEqual({ state: "paused" });
  });
  it("published is served", async () => {
    await db.insert(rewardCampaigns).values({ slug: "p2", status: "published" });
    expect((await getPublicCampaignState("p2")).state).toBe("published");
  });

  // Bukti Task 14: download tidak mengecek status campaign — klaim lama
  // dengan session valid tetap berfungsi walau campaign sudah dipause.
  it("old claim with valid session still downloads while campaign is paused", async () => {
    setEnv({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
    const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "old", status: "published" }).returning();
    const [asset] = await db
      .insert(rewardAssets)
      .values({
        campaignId: camp.id,
        storageKey: "rewards/a.pdf",
        nameId: "File A",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        checksum: "x",
      })
      .returning();
    const claimId = await upsertClaim(c.id, camp.id);
    const session = await issueSessionToken(claimId);

    // Campaign dipause SETELAH klaim dibuat.
    await db.update(rewardCampaigns).set({ status: "paused" }).where(eq(rewardCampaigns.id, camp.id));

    const r = await resolveDownload(session, asset.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new URL(r.url).searchParams.get("X-Amz-Expires")).toBe("3600");
  });
});
