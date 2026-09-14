import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { emailCampaigns, adminUsers } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";
import {
  createEmailCampaign,
  updateEmailCampaignDraft,
  getEmailCampaignById,
} from "../../src/lib/broadcast/crud";

/**
 * CRUD seam admin untuk email campaign (Task 11).
 *
 * KONTRAK PERSISTENCE (ruling Task 3-4): body yang disimpan HARUS hasil
 * sanitizeBody — updateEmailCampaignDraft menerima HTML mentah dari editor
 * dan menyimpan versi sanitized (script/http-link dibuang).
 */

const AUDIT = { adminUserId: "", ip: "10.0.0.1" };

beforeEach(async () => {
  setEnv({ PUBLIC_SITE_URL: "https://kado.test" });
  await resetDb();
  const [u] = await db.insert(adminUsers).values({ email: "admin@kado.test", passwordHash: "h" }).returning();
  AUDIT.adminUserId = u.id;
});

describe("createEmailCampaign", () => {
  it("creates a draft with empty content, filter {all:true}, and default limits", async () => {
    const id = await createEmailCampaign(AUDIT);
    expect(id).toBeTruthy();

    const row = await getEmailCampaignById(id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("draft");
    expect(row!.subjectId).toBe("");
    expect(row!.subjectEn).toBeNull();
    expect(row!.preheaderId).toBeNull();
    expect(row!.preheaderEn).toBeNull();
    expect(row!.bodyHtmlId).toBe("");
    expect(row!.bodyHtmlEn).toBeNull();
    expect(row!.audienceFilter).toEqual({ all: true });
    // Default limits: 60/menit (1/detik rata-rata) dan 600/jam — di bawah
    // kapasitas provider default (2/detik, 5.000/hari); admin bisa ubah.
    expect(row!.maxPerMinute).toBe(60);
    expect(row!.maxPerHour).toBe(600);
    expect(row!.scheduledAt).toBeNull();
    expect(row!.snapshotAt).toBeNull();
  });

  it("audits campaign_created", async () => {
    const { adminAuditLog } = await import("../../src/lib/schema");
    const id = await createEmailCampaign(AUDIT);
    const rows = await db.select().from(adminAuditLog);
    const entry = rows.find((r) => r.action === "campaign_created");
    expect(entry).toBeDefined();
    expect((entry!.detail as { campaignId?: string }).campaignId).toBe(id);
  });
});

describe("updateEmailCampaignDraft", () => {
  const RAW_BODY = '<p>Hai <a href="https://a.b/x">satu</a><script>alert(1)</script><a href="http://insecure.y">dua</a></p>';

  function patch(overrides: Partial<Parameters<typeof updateEmailCampaignDraft>[1]> = {}) {
    return {
      subjectId: "Halo subscriber",
      preheaderId: "pratinjau singkat",
      bodyHtmlId: RAW_BODY,
      subjectEn: "",
      preheaderEn: "",
      bodyHtmlEn: "",
      audienceFilter: { all: true },
      maxPerMinute: 30,
      maxPerHour: 300,
      ...overrides,
    };
  }

  it("persists sanitized bodies (script stripped, non-https href removed)", async () => {
    const id = await createEmailCampaign(AUDIT);
    const res = await updateEmailCampaignDraft(id, patch(), AUDIT);
    expect(res).toEqual({ ok: true });

    const row = await getEmailCampaignById(id);
    expect(row!.subjectId).toBe("Halo subscriber");
    // Persistence seam: versi tersimpan = hasil sanitizeBody, BUKAN input mentah.
    expect(row!.bodyHtmlId).not.toContain("script");
    expect(row!.bodyHtmlId).not.toContain("http://insecure.y");
    expect(row!.bodyHtmlId).toContain('href="https://a.b/x"');
    expect(row!.bodyHtmlEn).toBeNull();
    expect(row!.maxPerMinute).toBe(30);
    expect(row!.maxPerHour).toBe(300);
  });

  it("sanitizes EN body only when provided", async () => {
    const id = await createEmailCampaign(AUDIT);
    await updateEmailCampaignDraft(id, patch({
      subjectEn: "Hello subscriber",
      preheaderEn: "short preview",
      bodyHtmlEn: "<p>Hi <b onclick='x()'>one</b> <strong>two</strong></p>",
    }), AUDIT);
    const row = await getEmailCampaignById(id);
    expect(row!.subjectEn).toBe("Hello subscriber");
    // <b> bukan tag allowlist → dibuang; strong dipertahankan.
    expect(row!.bodyHtmlEn).toBe("<p>Hi one <strong>two</strong></p>");
  });

  it("stores a validated audience filter", async () => {
    const id = await createEmailCampaign(AUDIT);
    const filter = { locales: ["id", "en"] };
    const res = await updateEmailCampaignDraft(id, patch({ audienceFilter: filter }), AUDIT);
    expect(res).toEqual({ ok: true });
    const row = await getEmailCampaignById(id);
    expect(row!.audienceFilter).toEqual({ locales: ["id", "en"] });
  });

  it("rejects an invalid audience filter without touching the row", async () => {
    const id = await createEmailCampaign(AUDIT);
    const res = await updateEmailCampaignDraft(id, patch({ audienceFilter: {} }), AUDIT);
    expect(res).toEqual({ ok: false, reason: "invalid-filter" });
    const row = await getEmailCampaignById(id);
    expect(row!.subjectId).toBe("");
  });

  it("rejects updates after schedule (content frozen)", async () => {
    const id = await createEmailCampaign(AUDIT);
    await db.update(emailCampaigns).set({ status: "scheduled", snapshotAt: new Date() }).where(eq(emailCampaigns.id, id));
    const res = await updateEmailCampaignDraft(id, patch(), AUDIT);
    expect(res).toEqual({ ok: false, reason: "not-draft" });
    const row = await getEmailCampaignById(id);
    expect(row!.subjectId).toBe("");
  });

  it("rejects updates for queued status", async () => {
    const id = await createEmailCampaign(AUDIT);
    await db.update(emailCampaigns).set({ status: "queued" }).where(eq(emailCampaigns.id, id));
    const res = await updateEmailCampaignDraft(id, patch(), AUDIT);
    expect(res).toEqual({ ok: false, reason: "not-draft" });
    const row = await getEmailCampaignById(id);
    expect(row!.subjectId).toBe("");
  });

  it("returns not-found for unknown id", async () => {
    const res = await updateEmailCampaignDraft(
      "00000000-0000-0000-0000-000000000000", patch(), AUDIT,
    );
    expect(res).toEqual({ ok: false, reason: "not-found" });
  });

  it("audits campaign_draft_saved", async () => {
    const { adminAuditLog } = await import("../../src/lib/schema");
    const id = await createEmailCampaign(AUDIT);
    await updateEmailCampaignDraft(id, patch(), AUDIT);
    const rows = await db.select().from(adminAuditLog);
    const entry = rows.find((r) => r.action === "campaign_draft_saved");
    expect(entry).toBeDefined();
    expect((entry!.detail as { campaignId?: string }).campaignId).toBe(id);
  });
});

describe("getEmailCampaignById", () => {
  it("returns null for unknown id", async () => {
    expect(await getEmailCampaignById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
