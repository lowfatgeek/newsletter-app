import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { removeAsset, reorderAssets, storeAsset, validateUpload } from "../../src/lib/admin/assets";
import { createCampaign } from "../../src/lib/admin/campaigns";
import { db } from "../../src/lib/db";
import { adminAuditLog, rewardAssets } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

describe("asset upload", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_R2: "true" });
  });

  afterAll(async () => {
    setEnv({ MOCK_R2: "false" });
  });

  it("validates mime and size", () => {
    expect(validateUpload({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1024 }).ok).toBe(true);
    expect(validateUpload({ filename: "a.zip", mimeType: "application/x-zip-compressed", sizeBytes: 1024 }).ok).toBe(true);
    expect(validateUpload({ filename: "a.zip", mimeType: "application/zip", sizeBytes: 1024 }).ok).toBe(true);
    expect(validateUpload({ filename: "a.exe", mimeType: "application/x-msdownload", sizeBytes: 1 })).toEqual({
      ok: false,
      reason: "mime-not-allowed",
    });
    expect(validateUpload({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 101 * 1024 * 1024 })).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(validateUpload({ filename: "b.png", mimeType: "application/pdf", sizeBytes: 1 })).toEqual({
      ok: false,
      reason: "mime-not-allowed",
    }); // ekstensi vs mime mismatch
  });

  it("storeAsset writes row with checksum and key, removeAsset deletes row", async () => {
    const { id: campaignId } = (await createCampaign({ slug: "assets-c" })) as { ok: true; id: string };
    const res = await storeAsset(
      {
        campaignId,
        filename: "guide.pdf",
        mimeType: "application/pdf",
        body: new TextEncoder().encode("hello pdf").buffer as ArrayBuffer,
        nameId: "Panduan",
        sortOrder: 0,
      },
      { adminUserId: null, ip: "1.1.1.1" },
    );
    expect(res.ok).toBe(true);
    const key = (res as any).storageKey as string;
    expect(key.startsWith(`rewards/${campaignId}/`)).toBe(true);
    const [row] = await db.select().from(rewardAssets).where(eq(rewardAssets.campaignId, campaignId));
    expect(row.sizeBytes).toBe(9);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    await removeAsset(row.id);
    expect(await db.select().from(rewardAssets).where(eq(rewardAssets.id, row.id))).toHaveLength(0);
  });

  it("storeAsset rejects invalid upload without writing", async () => {
    const { id: campaignId } = (await createCampaign({ slug: "assets-d" })) as { ok: true; id: string };
    const res = await storeAsset({
      campaignId,
      filename: "virus.exe",
      mimeType: "application/x-msdownload",
      body: new ArrayBuffer(4),
      nameId: "X",
      sortOrder: 0,
    });
    expect(res).toEqual({ ok: false, reason: "mime-not-allowed" });
    expect(await db.select().from(rewardAssets).where(eq(rewardAssets.campaignId, campaignId))).toHaveLength(0);
  });

  it("storeAsset writes asset_uploaded audit; removeAsset writes asset_removed", async () => {
    const { id: campaignId } = (await createCampaign({ slug: "assets-audit" })) as { ok: true; id: string };
    const res = (await storeAsset(
      {
        campaignId,
        filename: "Modul 2026.zip",
        mimeType: "application/x-zip-compressed",
        body: new TextEncoder().encode("zipbytes").buffer as ArrayBuffer,
        nameId: "Modul 2026",
        sortOrder: 0,
      },
      { adminUserId: null, ip: "1.1.1.1" },
    )) as { ok: true; id: string };
    const [row] = await db.select().from(rewardAssets).where(eq(rewardAssets.id, res.id));
    expect(row.mimeType).toBe("application/zip");
    await removeAsset(res.id, { adminUserId: null, ip: "1.1.1.1" });
    const audits = await db.select().from(adminAuditLog).orderBy(asc(adminAuditLog.createdAt));
    expect(audits.map((a) => a.action)).toContain("asset_uploaded");
    expect(audits.map((a) => a.action)).toContain("asset_removed");
  });

  it("reorderAssets persists sortOrder by index", async () => {
    const { id: campaignId } = (await createCampaign({ slug: "assets-order" })) as { ok: true; id: string };
    const a = (await storeAsset({
      campaignId,
      filename: "a.pdf",
      mimeType: "application/pdf",
      body: new ArrayBuffer(2),
      nameId: "A",
      sortOrder: 0,
    })) as { ok: true; id: string };
    const b = (await storeAsset({
      campaignId,
      filename: "b.pdf",
      mimeType: "application/pdf",
      body: new ArrayBuffer(2),
      nameId: "B",
      sortOrder: 1,
    })) as { ok: true; id: string };
    await reorderAssets(campaignId, [b.id, a.id]);
    const rows = await db
      .select()
      .from(rewardAssets)
      .where(eq(rewardAssets.campaignId, campaignId))
      .orderBy(asc(rewardAssets.sortOrder));
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
