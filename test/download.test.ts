import { beforeEach, describe, expect, it } from "vitest";
import { issueSessionToken, upsertClaim } from "../src/lib/access";
import { db } from "../src/lib/db";
import { resolveDownload, resolveFeaturedImage } from "../src/lib/download";
import { contacts, rewardAssets, rewardCampaigns, rewardClaims } from "../src/lib/schema";
import { resetDb, setEnv } from "./helpers";

beforeEach(async () => {
  await resetDb();
  setEnv({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
});

async function seed() {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db
    .insert(rewardCampaigns)
    .values({ slug: "s", status: "published", featuredImageKey: "img/cover.png" })
    .returning();
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
  return { camp, asset, claimId };
}

describe("resolveDownload", () => {
  it("returns presigned url for valid session+asset", async () => {
    const { asset, claimId } = await seed();
    const session = await issueSessionToken(claimId);
    const r = await resolveDownload(session, asset.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new URL(r.url).searchParams.get("X-Amz-Expires")).toBe("3600");
  });
  it("rejects foreign asset and bad session", async () => {
    const { asset, claimId } = await seed();
    const session = await issueSessionToken(claimId);
    expect((await resolveDownload(session, "00000000-0000-0000-0000-000000000000")).ok).toBe(false);
    expect((await resolveDownload("badtoken", asset.id)).ok).toBe(false);
  });
});

describe("resolveFeaturedImage", () => {
  it("allows only published campaign featured keys", async () => {
    await seed();
    expect((await resolveFeaturedImage("img/cover.png")).ok).toBe(true);
    expect((await resolveFeaturedImage("img/other.png")).ok).toBe(false);
  });
});
