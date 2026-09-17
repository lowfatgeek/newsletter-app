import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createCampaign, setDoaSelections } from "../../src/lib/admin/campaigns";
import {
  deleteDoaTemplateGroup,
  ensureDefaultDoaTemplates,
  listGroupedDoaTemplates,
  upsertDoaTemplate,
} from "../../src/lib/admin/doa";
import { db } from "../../src/lib/db";
import { adminAuditLog, doaTemplates } from "../../src/lib/schema";
import { resetDb } from "../helpers";

const AUDIT = { adminUserId: null, ip: "127.0.0.1" };

describe("doa admin lib", () => {
  beforeEach(resetDb);

  it("ensureDefaultDoaTemplates seeds 4 defaults and is idempotent", async () => {
    const first = await ensureDefaultDoaTemplates(AUDIT);
    expect(first.inserted).toBe(4);

    const rows = await db.select().from(doaTemplates);
    expect(rows).toHaveLength(4);

    // Idempotent: panggilan kedua tidak menambah apa-apa
    const second = await ensureDefaultDoaTemplates(AUDIT);
    expect(second.inserted).toBe(0);

    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "doa_templates_seeded"));
    expect(audits).toHaveLength(1);
  });

  it("listGroupedDoaTemplates groups by variant and name correctly", async () => {
    expect(await listGroupedDoaTemplates()).toHaveLength(0);

    await ensureDefaultDoaTemplates();
    const groups = await listGroupedDoaTemplates();
    expect(groups).toHaveLength(2); // Doa Muslim v1 & Harapan Baik v1

    const muslimGroup = groups.find((g) => g.variant === "muslim");
    expect(muslimGroup).toBeDefined();
    expect(muslimGroup?.name).toBe("Doa Muslim v1");
    expect(muslimGroup?.idTemplate?.content).toContain("Ya Allah");
    expect(muslimGroup?.enTemplate?.content).toContain("O Allah");

    const uniGroup = groups.find((g) => g.variant === "universal");
    expect(uniGroup).toBeDefined();
    expect(uniGroup?.name).toBe("Harapan Baik v1");
    expect(uniGroup?.idTemplate?.content).toContain("Semoga");
    expect(uniGroup?.enTemplate?.content).toContain("May every small step");
  });

  it("upsertDoaTemplate creates, updates, and validates", async () => {
    // Validasi penolakan
    expect(
      await upsertDoaTemplate({
        variant: "muslim",
        name: "",
        contentId: "Isi",
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    expect(
      await upsertDoaTemplate({
        variant: "muslim",
        name: "Doa Baru",
        contentId: "",
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    // Tambah baru dengan ID & EN
    const addRes = await upsertDoaTemplate(
      {
        variant: "muslim",
        name: "Doa Khusus v1",
        contentId: "Teks Indonesia",
        contentEn: "English Text",
      },
      AUDIT,
    );
    expect(addRes.ok).toBe(true);

    let groups = await listGroupedDoaTemplates();
    const created = groups.find((g) => g.name === "Doa Khusus v1");
    expect(created?.idTemplate?.content).toBe("Teks Indonesia");
    expect(created?.enTemplate?.content).toBe("English Text");

    // Perbarui teks ID dan hilangkan teks EN
    const updateRes = await upsertDoaTemplate(
      {
        variant: "muslim",
        name: "Doa Khusus v1",
        contentId: "Teks Indonesia Diperbarui",
        contentEn: "",
      },
      AUDIT,
    );
    expect(updateRes.ok).toBe(true);

    groups = await listGroupedDoaTemplates();
    const updated = groups.find((g) => g.name === "Doa Khusus v1");
    expect(updated?.idTemplate?.content).toBe("Teks Indonesia Diperbarui");
    expect(updated?.enTemplate).toBeUndefined(); // EN dihapus jika kosong

    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "doa_template_saved"));
    expect(audits).toHaveLength(2);
  });

  it("deleteDoaTemplateGroup removes template or blocks if in use", async () => {
    await ensureDefaultDoaTemplates(AUDIT);

    // Hapus yang tidak ada
    expect(await deleteDoaTemplateGroup("muslim", "Non Existent")).toEqual({
      ok: false,
      reason: "not-found",
    });

    // Buat campaign yang memakai template "Doa Muslim v1"
    const { id: campaignId } = (await createCampaign({ slug: "test-doa-camp" })) as {
      ok: true;
      id: string;
    };
    const all = await db.select().from(doaTemplates);
    const muslimTpl = all.find((t) => t.variant === "muslim" && t.locale === "id")!;
    const uniTpl = all.find((t) => t.variant === "universal" && t.locale === "id")!;

    await setDoaSelections(campaignId, {
      muslim: muslimTpl.id,
      universal: uniTpl.id,
    });

    // Hapus template yang sedang in-use harus ditolak
    const inUseRes = await deleteDoaTemplateGroup("muslim", "Doa Muslim v1", AUDIT);
    expect(inUseRes).toEqual({ ok: false, reason: "in-use" });

    // Tambah template baru yang tidak dipakai lalu hapus
    await upsertDoaTemplate({
      variant: "universal",
      name: "Harapan Sementara",
      contentId: "Semoga berkah",
    });
    const delRes = await deleteDoaTemplateGroup("universal", "Harapan Sementara", AUDIT);
    expect(delRes).toEqual({ ok: true });

    const groups = await listGroupedDoaTemplates();
    expect(groups.find((g) => g.name === "Harapan Sementara")).toBeUndefined();

    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "doa_template_deleted"));
    expect(audits).toHaveLength(1);
  });
});
