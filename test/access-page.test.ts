import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { contacts, rewardAssets, rewardCampaignLocales, rewardCampaigns } from "../src/lib/schema";
import { upsertClaim, issueClaimToken, issueSessionToken } from "../src/lib/access";
import { resolveAccess } from "../src/lib/access-page";
import { resolveDownload } from "../src/lib/download";
import { resetDb, setEnv } from "./helpers";

beforeEach(async () => {
  await resetDb();
  setEnv({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
});

async function seed(status: "published" | "paused" = "published") {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "s", status }).returning();
  await db.insert(rewardCampaignLocales).values({
    campaignId: camp.id, locale: "id", title: "KelasWFA", description: "Deskripsi.",
  });
  const [asset] = await db.insert(rewardAssets).values({
    campaignId: camp.id, storageKey: "rewards/a.pdf", nameId: "File A", mimeType: "application/pdf",
    sizeBytes: 1024, checksum: "x",
  }).returning();
  const claimId = await upsertClaim(c.id, camp.id);
  return { camp, asset, claimId };
}

describe("resolveAccess (halaman /akses)", () => {
  it("exchanges a one-time access token for a working session and download", async () => {
    const { camp, asset, claimId } = await seed();
    const accessRaw = await issueClaimToken(claimId, "access");

    const r = await resolveAccess(accessRaw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Session baru dibuat (berbeda dari token access, tipe "session" di DB)
    expect(r.sessionToken).not.toBe(accessRaw);
    expect(r.campaignId).toBe(camp.id);

    // Session hasil penukaran bisa dipakai untuk unduhan
    const dl = await resolveDownload(r.sessionToken, asset.id);
    expect(dl.ok).toBe(true);

    // Token access sekali pakai: pemakaian ulang gagal
    expect(await resolveAccess(accessRaw)).toEqual({ ok: false });
  });

  it("accepts a session token as-is (reusable)", async () => {
    const { claimId } = await seed();
    const raw = await issueSessionToken(claimId);
    const r = await resolveAccess(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sessionToken).toBe(raw);
    // masih reusable
    expect(await resolveAccess(raw)).toMatchObject({ ok: true });
  });

  it("still resolves for a paused campaign (old claims keep working)", async () => {
    const { claimId, asset } = await seed("paused");
    const raw = await issueClaimToken(claimId, "access");
    const r = await resolveAccess(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await resolveDownload(r.sessionToken, asset.id)).toMatchObject({ ok: true });
  });

  it("rejects invalid token and foreign asset", async () => {
    const { asset, claimId } = await seed();
    expect(await resolveAccess("badtoken")).toEqual({ ok: false });

    const raw = await issueClaimToken(claimId, "access");
    const r = await resolveAccess(raw);
    if (!r.ok) return expect.unreachable();
    expect((await resolveDownload(r.sessionToken, "00000000-0000-0000-0000-000000000000")).ok).toBe(false);
    void asset;
  });
});
