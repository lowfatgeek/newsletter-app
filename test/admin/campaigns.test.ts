import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  changeSlug,
  checkPublishReadiness,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaignById,
  setCampaignStatus,
  setDoaSelections,
  updateCampaignMeta,
  upsertCampaignLocale,
  validateSlug,
} from "../../src/lib/admin/campaigns";
import { db } from "../../src/lib/db";
import {
  adminAuditLog,
  campaignRedirects,
  contacts,
  doaTemplates,
  rewardAssets,
  rewardCampaigns,
  rewardClaims,
} from "../../src/lib/schema";
import { resetDb } from "../helpers";

const AUDIT = { adminUserId: null, ip: "127.0.0.1" };

describe("campaigns lib", () => {
  beforeEach(resetDb);

  it("validateSlug rules", () => {
    expect(validateSlug("starter-kit")).toBe(true);
    expect(validateSlug("starter--kit")).toBe(false);
    expect(validateSlug("Starter")).toBe(false);
    expect(validateSlug("-x")).toBe(false);
  });
  it("create rejects invalid and duplicate slug", async () => {
    expect((await createCampaign({ slug: "Bad Slug" })).ok).toBe(false);
    await createCampaign({ slug: "a" });
    expect(await createCampaign({ slug: "a" })).toEqual({ ok: false, reason: "slug-taken" });
  });
  it("locale upsert", async () => {
    const { id } = (await createCampaign({ slug: "c1" })) as { ok: true; id: string };
    await upsertCampaignLocale(id, "id", { title: "T", description: "D", rewardItems: [] });
    await upsertCampaignLocale(id, "id", { title: "T2", description: "D2", rewardItems: [] });
    const got = await getCampaignById(id);
    expect(got!.locales).toHaveLength(1);
    expect(got!.locales[0].title).toBe("T2");
  });
  it("draft slug change is free; published needs confirmation + writes redirect", async () => {
    const { id } = (await createCampaign({ slug: "draft-camp" })) as { ok: true; id: string };
    expect((await changeSlug(id, "draft-renamed", false)).ok).toBe(true);
    await setCampaignStatus(id, "publish");
    expect(await changeSlug(id, "published-renamed", false)).toEqual({
      ok: false,
      reason: "published-requires-confirmation",
    });
    expect((await changeSlug(id, "published-renamed", true)).ok).toBe(true);
    const redirects = await db.select().from(campaignRedirects);
    expect(redirects.map((r) => r.oldSlug)).toContain("draft-renamed");
  });
  it("status transitions enforce legality", async () => {
    const { id } = (await createCampaign({ slug: "t1" })) as { ok: true; id: string };
    expect(await setCampaignStatus(id, "pause")).toMatchObject({ ok: false });
    // Archive dari draft tetap ditolak (hanya published|paused → archived).
    expect(await setCampaignStatus(id, "archive")).toEqual({ ok: false, reason: "invalid-transition" });
    await setCampaignStatus(id, "publish");
    expect(await setCampaignStatus(id, "pause")).toMatchObject({ ok: true });
    expect(await setCampaignStatus(id, "unpause")).toMatchObject({ ok: true });
    expect(await setCampaignStatus(id, "archive")).toMatchObject({ ok: true });
    const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    expect(camp.status).toBe("archived");
  });
  it("paused campaign can be archived (matches editor UI)", async () => {
    const { id } = (await createCampaign({ slug: "t2" })) as { ok: true; id: string };
    await setCampaignStatus(id, "publish");
    await setCampaignStatus(id, "pause");
    expect(await setCampaignStatus(id, "archive")).toMatchObject({ ok: true });
    const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    expect(camp.status).toBe("archived");
  });
  it("duplicate copies locales/assets/doa as draft with unique slug", async () => {
    const { id } = (await createCampaign({ slug: "orig" })) as { ok: true; id: string };
    await upsertCampaignLocale(id, "id", { title: "T", description: "D", rewardItems: [{ name: "A", benefit: "B" }] });
    const copyId = await duplicateCampaign(id);
    const copy = await getCampaignById(copyId);
    expect(copy!.campaign.status).toBe("draft");
    expect(copy!.locales[0].title).toBe("T");
    expect(copy!.campaign.slug).toBe("orig-copy");
  });

  it("checkPublishReadiness requires ID title/desc and at least one asset", async () => {
    const { id } = (await createCampaign({ slug: "ready-test" })) as { ok: true; id: string };
    // 1. No locales yet
    expect(await checkPublishReadiness(id)).toEqual({ ok: false, reason: "missing-content" });

    // 2. Empty title or description
    await upsertCampaignLocale(id, "id", { title: "   ", description: "Desc", rewardItems: [] });
    expect(await checkPublishReadiness(id)).toEqual({ ok: false, reason: "missing-content" });

    // 3. Has ID locale but no assets
    await upsertCampaignLocale(id, "id", { title: "Title", description: "Description", rewardItems: [] });
    expect(await checkPublishReadiness(id)).toEqual({ ok: false, reason: "missing-assets" });

    // 4. Has ID locale and 1 asset
    await db.insert(rewardAssets).values({
      campaignId: id,
      storageKey: `rewards/${id}/test.pdf`,
      nameId: "Test PDF",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      checksum: "dummy-checksum",
    });
    expect(await checkPublishReadiness(id)).toEqual({ ok: true });
  });

  it("create writes audit row", async () => {
    await createCampaign({ slug: "audited" }, AUDIT);
    const rows = await db.select().from(adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("campaign_created");
  });

  it("changeSlug rejects slug equal to another campaign's current slug", async () => {
    await createCampaign({ slug: "occupied" });
    const { id } = (await createCampaign({ slug: "mover" })) as { ok: true; id: string };
    expect(await changeSlug(id, "occupied", true)).toEqual({ ok: false, reason: "slug-taken" });
  });

  it("publish sets publishedAt once and does not overwrite", async () => {
    const { id } = (await createCampaign({ slug: "pub-once" })) as { ok: true; id: string };
    await setCampaignStatus(id, "publish");
    const [first] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    expect(first.publishedAt).not.toBeNull();
    expect(first.status).toBe("published");
    await setCampaignStatus(id, "pause");
    await setCampaignStatus(id, "unpause");
    const [second] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    expect(second.publishedAt!.getTime()).toBe(first.publishedAt!.getTime());
  });

  it("duplicate falls back to -copy-2 when -copy is taken", async () => {
    const { id } = (await createCampaign({ slug: "src" })) as { ok: true; id: string };
    const firstCopy = await duplicateCampaign(id);
    const secondCopy = await duplicateCampaign(id);
    const one = await getCampaignById(firstCopy);
    const two = await getCampaignById(secondCopy);
    expect(one!.campaign.slug).toBe("src-copy");
    expect(two!.campaign.slug).toBe("src-copy-2");
  });

  it("getCampaignById returns assets ordered by sortOrder and null for missing", async () => {
    expect(await getCampaignById("00000000-0000-0000-0000-000000000000")).toBeNull();
    const { id } = (await createCampaign({ slug: "ordered" })) as { ok: true; id: string };
    await db.insert(rewardAssets).values([
      {
        campaignId: id,
        storageKey: "a/second.pdf",
        nameId: "B",
        mimeType: "application/pdf",
        sizeBytes: 2,
        checksum: "c2",
        sortOrder: 2,
      },
      {
        campaignId: id,
        storageKey: "a/first.pdf",
        nameId: "A",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: "c1",
        sortOrder: 1,
      },
    ]);
    const got = await getCampaignById(id);
    expect(got!.assets.map((a) => a.nameId)).toEqual(["A", "B"]);
    expect(got!.doaSelections).toEqual([]);
  });

  it("updateCampaignMeta patches featuredImageKey/order/indexable and audits", async () => {
    const { id } = (await createCampaign({ slug: "meta-camp" })) as { ok: true; id: string };
    await updateCampaignMeta(id, { featuredImageKey: "k/1.png", order: 7, indexable: true }, AUDIT);
    const got = await getCampaignById(id);
    expect(got!.campaign.featuredImageKey).toBe("k/1.png");
    expect(got!.campaign.sortOrder).toBe(7);
    expect(got!.campaign.indexable).toBe(true);
    const rows = await db.select().from(adminAuditLog);
    expect(rows.map((r) => r.action)).toContain("campaign_updated");
  });

  it("status machine writes audit actions", async () => {
    const { id } = (await createCampaign({ slug: "audit-status" })) as { ok: true; id: string };
    await setCampaignStatus(id, "publish", AUDIT);
    await setCampaignStatus(id, "pause", AUDIT);
    await setCampaignStatus(id, "unpause", AUDIT);
    await setCampaignStatus(id, "archive", AUDIT);
    const actions = (await db.select().from(adminAuditLog)).map((r) => r.action);
    expect(actions).toContain("campaign_published");
    expect(actions).toContain("campaign_paused");
    expect(actions).toContain("campaign_archived");
  });

  it("rename-back to own former slug removes the self-redirect", async () => {
    const { id } = (await createCampaign({ slug: "a" })) as { ok: true; id: string };
    await setCampaignStatus(id, "publish");
    expect((await changeSlug(id, "b", true)).ok).toBe(true);
    expect((await changeSlug(id, "a", true)).ok).toBe(true);
    const redirects = await db.select().from(campaignRedirects);
    expect(redirects.map((r) => r.oldSlug)).not.toContain("a"); // tidak ada self-redirect → tidak loop
    expect(redirects.map((r) => r.oldSlug)).toContain("b");
  });

  it("duplicate copy slug trims trailing dashes left by truncation", async () => {
    // Slug valid 120 char; slice(0, 115) memotong tepat setelah dash.
    const longSlug = "a".repeat(114) + "-bcd";
    const { id } = (await createCampaign({ slug: longSlug })) as { ok: true; id: string };
    const copyId = await duplicateCampaign(id);
    const copy = await getCampaignById(copyId);
    expect(copy!.campaign.slug).toBe("a".repeat(114) + "-copy"); // bukan "aaa...--copy"
  });

  it("setDoaSelections upserts and validates variant", async () => {
    const { id } = (await createCampaign({ slug: "doa-c" })) as { ok: true; id: string };
    const [m] = await db
      .insert(doaTemplates)
      .values({ variant: "muslim", locale: "id", name: "M", content: "c" })
      .returning();
    const [uni] = await db
      .insert(doaTemplates)
      .values({ variant: "universal", locale: "id", name: "U", content: "c" })
      .returning();
    expect((await setDoaSelections(id, { muslim: m.id, universal: uni.id })).ok).toBe(true);
    expect((await setDoaSelections(id, { muslim: uni.id, universal: uni.id })).ok).toBe(false); // mismatch
    expect((await setDoaSelections(id, { muslim: m.id, universal: uni.id })).ok).toBe(true); // re-set upsert
    const got = await getCampaignById(id);
    expect(got!.doaSelections).toHaveLength(2);
  });

  it("updateCampaignMeta with empty patch writes no audit row", async () => {
    const { id } = (await createCampaign({ slug: "no-op" })) as { ok: true; id: string };
    const updatedRows = () => db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_updated"));
    await updateCampaignMeta(id, {}, AUDIT);
    expect(await updatedRows()).toHaveLength(0);
    await updateCampaignMeta(id, { order: 3 }, AUDIT);
    expect(await updatedRows()).toHaveLength(1);
  });

  it("deleteCampaign rejects invalid uuid and missing campaign", async () => {
    expect(await deleteCampaign("not-a-uuid")).toEqual({ ok: false, reason: "not-found" });
    expect(await deleteCampaign("00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("deleteCampaign deletes draft campaign and cascade records", async () => {
    const { id } = (await createCampaign({ slug: "del-draft" })) as { ok: true; id: string };
    await upsertCampaignLocale(id, "id", { title: "Title ID", description: "Desc", rewardItems: [] });
    await db.insert(rewardAssets).values({
      campaignId: id,
      storageKey: "test-key",
      nameId: "Asset 1",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      checksum: "abc",
    });

    const res = await deleteCampaign(id, {}, AUDIT);
    expect(res).toEqual({ ok: true });

    const exists = await getCampaignById(id);
    expect(exists).toBeNull();

    // Verify audit log
    const deletedLogs = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_deleted"));
    expect(deletedLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteCampaign handles campaign with claims: blocks when force=false, deletes when force=true", async () => {
    const { id } = (await createCampaign({ slug: "del-claims" })) as { ok: true; id: string };
    const [c] = await db.insert(contacts).values({ emailNormalized: "user@example.com" }).returning();
    await db.insert(rewardClaims).values({
      contactId: c.id,
      campaignId: id,
    });

    // 1. Without force -> blocked
    const blocked = await deleteCampaign(id, { force: false });
    expect(blocked).toEqual({ ok: false, reason: "has-claims", claimsCount: 1 });

    // Campaign still exists
    expect(await getCampaignById(id)).not.toBeNull();

    // 2. With force -> deleted along with claim
    const deleted = await deleteCampaign(id, { force: true }, AUDIT);
    expect(deleted).toEqual({ ok: true });
    expect(await getCampaignById(id)).toBeNull();

    const remainingClaims = await db.select().from(rewardClaims).where(eq(rewardClaims.campaignId, id));
    expect(remainingClaims).toHaveLength(0);
  });
});
