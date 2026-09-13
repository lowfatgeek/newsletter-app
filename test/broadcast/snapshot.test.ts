import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  contacts, marketingSubscriptions, emailCampaigns, emailCampaignRecipients, emailLinks,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";
import { hashToken } from "../../src/lib/crypto";
import { snapshotRecipients, prepareLinks } from "../../src/lib/broadcast/snapshot";

const SITE = "https://kado.test";

async function seedAudience() {
  const [a] = await db.insert(contacts).values({ emailNormalized: "a@gmail.com", locale: "id", confirmationStatus: "confirmed" }).returning();
  const [b] = await db.insert(contacts).values({ emailNormalized: "b@gmail.com", locale: "en", confirmationStatus: "confirmed" }).returning();
  await db.insert(marketingSubscriptions).values({ contactId: a.id, status: "active" });
  await db.insert(marketingSubscriptions).values({ contactId: b.id, status: "active" });
  return [a, b];
}

async function seedCampaign() {
  const [c] = await db.insert(emailCampaigns).values({
    subjectId: "Halo {{email}}",
    subjectEn: "Hello {{email}}",
    preheaderId: "pratinjau",
    preheaderEn: "preview",
    bodyHtmlId: '<p>Hai <a href="https://a.b/x">satu</a> <a href="https://a.b/y">dua</a> <a href="https://a.b/x">ulang</a></p>',
    bodyHtmlEn: '<p>Hi <a href="https://a.b/z">three</a></p>',
    audienceFilter: { all: true },
    maxPerMinute: 60,
    maxPerHour: 600,
  }).returning();
  return c;
}

beforeEach(() => {
  setEnv({ PUBLIC_SITE_URL: SITE });
  return resetDb();
});

describe("prepareLinks", () => {
  it("extracts unique https hrefs from both bodies and upserts emailLinks", async () => {
    await seedAudience();
    const campaign = await seedCampaign();
    const map = await prepareLinks(campaign.id, campaign.bodyHtmlId, campaign.bodyHtmlEn);
    expect(map.size).toBe(3);
    const rows = await db.select().from(emailLinks).where(eq(emailLinks.campaignId, campaign.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(map.get(row.url)).toBe(row.id);
      expect(row.urlHash).toBe(hashToken(row.url));
    }
    expect(map.has("https://a.b/x")).toBe(true);
    expect(map.has("https://a.b/y")).toBe(true);
    expect(map.has("https://a.b/z")).toBe(true);
  });

  it("is idempotent: re-run returns the same link ids without new rows", async () => {
    await seedAudience();
    const campaign = await seedCampaign();
    const first = await prepareLinks(campaign.id, campaign.bodyHtmlId, campaign.bodyHtmlEn);
    const second = await prepareLinks(campaign.id, campaign.bodyHtmlId, campaign.bodyHtmlEn);
    expect(second.size).toBe(first.size);
    for (const [url, id] of first) expect(second.get(url)).toBe(id);
    const rows = await db.select().from(emailLinks).where(eq(emailLinks.campaignId, campaign.id));
    expect(rows).toHaveLength(3);
  });
});

describe("snapshotRecipients", () => {
  it("creates one recipient per audience contact with unique hashed tokens and rendered html", async () => {
    const [a, b] = await seedAudience();
    const campaign = await seedCampaign();
    const { recipients } = await snapshotRecipients(campaign.id);
    expect(recipients).toHaveLength(2);

    const tokens = recipients.map((r) => r.clickToken);
    expect(new Set(tokens).size).toBe(2);
    expect(tokens.every((t) => t.length >= 32)).toBe(true);

    const rows = await db.select().from(emailCampaignRecipients);
    expect(rows).toHaveLength(2);
    const byContact = new Map(rows.map((r) => [r.contactId, r]));
    for (const r of recipients) {
      const row = byContact.get(r.contactId)!;
      expect(row.clickTokenHash).toBe(hashToken(r.clickToken));
      expect(row.localeSelected).toBe(r.locale);
      expect(row.lastRenderedHtml).toBeTruthy();
      expect(row.lastRenderedHtml).toContain(`${SITE}/api/unsubscribe/${r.clickToken}`);
    }
    expect(byContact.get(a.id)!.localeSelected).toBe("id");
    expect(byContact.get(b.id)!.localeSelected).toBe("en");
  });

  it("renders per-recipient html: locale content, click links with linkId and raw token", async () => {
    const [, b] = await seedAudience();
    const campaign = await seedCampaign();
    const { recipients } = await snapshotRecipients(campaign.id);
    const enRecipient = recipients.find((r) => r.locale === "en")!;
    expect(enRecipient.contactId).toBe(b.id);

    const row = (await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.contactId, b.id)))[0];
    const html = row.lastRenderedHtml!;
    expect(html).toContain("preview"); // en preheader
    expect(html).not.toContain("{{email}}"); // all variables replaced
    const map = await prepareLinks(campaign.id, campaign.bodyHtmlId, campaign.bodyHtmlEn);
    const zId = map.get("https://a.b/z");
    expect(html).toContain(`${SITE}/api/click/${zId}/${enRecipient.clickToken}`);
    expect(html).not.toContain('href="https://a.b/z"'); // all links rewritten
    expect(html).toContain("Unsubscribe");
  });

  it("sets snapshotAt on the campaign", async () => {
    await seedAudience();
    const campaign = await seedCampaign();
    expect(campaign.snapshotAt).toBeNull();
    await snapshotRecipients(campaign.id);
    const [after] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaign.id));
    expect(after.snapshotAt).not.toBeNull();
  });

  it("is idempotent: re-snapshot keeps tokens/html, returns only new rows", async () => {
    await seedAudience();
    const campaign = await seedCampaign();
    const first = await snapshotRecipients(campaign.id);
    // tamper html to prove existing rows are not re-rendered
    await db.update(emailCampaignRecipients)
      .set({ lastRenderedHtml: "tampered" })
      .where(eq(emailCampaignRecipients.campaignId, campaign.id));

    const second = await snapshotRecipients(campaign.id);
    expect(second.recipients).toEqual([]);

    const rows = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaign.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.lastRenderedHtml === "tampered")).toBe(true);
    const hashes = new Set(rows.map((r) => r.clickTokenHash));
    const expected = new Set(first.recipients.map((r) => hashToken(r.clickToken)));
    expect(hashes).toEqual(expected);
  });
});
