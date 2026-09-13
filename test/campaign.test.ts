import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  doaSelections,
  doaTemplates,
  rewardCampaignLocales,
  rewardCampaigns,
} from "../src/lib/schema";
import { getPublishedCampaign } from "../src/lib/campaign";
import { resetDb } from "./helpers";

type CampaignOverrides = Partial<typeof rewardCampaigns.$inferInsert>;

async function insertCampaign(overrides: CampaignOverrides = {}) {
  const [camp] = await db
    .insert(rewardCampaigns)
    .values({ slug: "test-campaign", status: "published", ...overrides })
    .returning();
  return camp;
}

type LocaleRowOverrides = Partial<typeof rewardCampaignLocales.$inferInsert>;

async function insertLocaleRow(campaignId: string, locale: "id" | "en", overrides: LocaleRowOverrides = {}) {
  const [row] = await db
    .insert(rewardCampaignLocales)
    .values({
      campaignId,
      locale,
      title: locale === "id" ? "Hadiah Spesial" : "Special Gift",
      description: locale === "id" ? "Deskripsi hadiah." : "Gift description.",
      rewardItems: [{ name: "E-book", benefit: "Panduan lengkap", format: "PDF", size: "2 MB" }],
      ...overrides,
    })
    .returning();
  return row;
}

type TemplateOverrides = Partial<typeof doaTemplates.$inferInsert>;

async function insertDoaTemplate(overrides: TemplateOverrides) {
  const [tpl] = await db.insert(doaTemplates).values(overrides).returning();
  return tpl;
}

async function selectDoa(campaignId: string, variant: "muslim" | "universal", templateId: string) {
  await db.insert(doaSelections).values({ campaignId, variant, templateId });
}

describe("getPublishedCampaign", () => {
  beforeEach(resetDb);

  it("returns campaign, locale rows and doa text for a published campaign", async () => {
    const camp = await insertCampaign();
    await insertLocaleRow(camp.id, "id");
    await insertLocaleRow(camp.id, "en");
    const muslimId = await insertDoaTemplate({
      variant: "muslim",
      locale: "id",
      name: "doa-ramadan",
      content: "Ya Allah, berkahilah...",
    });
    await selectDoa(camp.id, "muslim", muslimId.id);
    const universalId = await insertDoaTemplate({
      variant: "universal",
      locale: "id",
      name: "harapan-baik",
      content: "Semoga harapan baikmu terkabul.",
    });
    await selectDoa(camp.id, "universal", universalId.id);

    const data = await getPublishedCampaign("test-campaign");
    expect(data).not.toBeNull();
    expect(data!.campaign.id).toBe(camp.id);
    expect(data!.campaign.status).toBe("published");

    const { row, fallbackToId } = data!.localeRow("id");
    expect(fallbackToId).toBe(false);
    expect(row.title).toBe("Hadiah Spesial");
    expect(row.rewardItems).toEqual([
      { name: "E-book", benefit: "Panduan lengkap", format: "PDF", size: "2 MB" },
    ]);

    expect(await data!.doaText("muslim", "id")).toBe("Ya Allah, berkahilah...");
    expect(await data!.doaText("universal", "id")).toBe("Semoga harapan baikmu terkabul.");
  });

  it("returns null for a draft campaign", async () => {
    await insertCampaign({ status: "draft" });
    await insertLocaleRow((await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, "test-campaign")))[0].id, "id");
    expect(await getPublishedCampaign("test-campaign")).toBeNull();
  });

  it("returns null for unknown slug", async () => {
    expect(await getPublishedCampaign("tidak-ada")).toBeNull();
  });

  it("falls back to the id locale row with fallbackToId when en row is missing", async () => {
    const camp = await insertCampaign();
    await insertLocaleRow(camp.id, "id");

    const data = await getPublishedCampaign("test-campaign");
    expect(data).not.toBeNull();
    const { row, fallbackToId } = data!.localeRow("en");
    expect(fallbackToId).toBe(true);
    expect(row.locale).toBe("id");
    expect(row.title).toBe("Hadiah Spesial");

    // id row tetap tanpa fallback
    const idRow = data!.localeRow("id");
    expect(idRow.fallbackToId).toBe(false);
  });

  it("doaText falls back to the same-name template in the requested locale", async () => {
    const camp = await insertCampaign();
    const muslimId = await insertDoaTemplate({
      variant: "muslim",
      locale: "id",
      name: "doa-ramadan",
      content: "Teks doa bahasa Indonesia.",
    });
    await selectDoa(camp.id, "muslim", muslimId.id);
    await insertDoaTemplate({
      variant: "muslim",
      locale: "en",
      name: "doa-ramadan",
      content: "English prayer text.",
    });

    const data = await getPublishedCampaign("test-campaign");
    expect(await data!.doaText("muslim", "en")).toBe("English prayer text.");
  });

  it("doaText returns the original content when no same-name template exists in the requested locale", async () => {
    const camp = await insertCampaign();
    const universalId = await insertDoaTemplate({
      variant: "universal",
      locale: "id",
      name: "harapan-baik",
      content: "Hanya tersedia dalam bahasa Indonesia.",
    });
    await selectDoa(camp.id, "universal", universalId.id);

    const data = await getPublishedCampaign("test-campaign");
    expect(await data!.doaText("universal", "en")).toBe("Hanya tersedia dalam bahasa Indonesia.");
  });

  it("doaText returns empty string when the variant is not selected", async () => {
    const camp = await insertCampaign();
    await insertLocaleRow(camp.id, "id");
    const data = await getPublishedCampaign("test-campaign");
    expect(await data!.doaText("muslim", "id")).toBe("");
  });
});
