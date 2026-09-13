import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import {
  contacts, emailCampaignRecipients, emailCampaigns, emailDeliveries,
  emailLinks, emailProviderEvents, emailSuppressions,
} from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers";

describe("broadcast schema", () => {
  beforeEach(resetDb);
  it("creates campaign, recipients, deliveries, suppression, events, links", async () => {
    const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
    const [camp] = await db.insert(emailCampaigns).values({
      subjectId: "Halo", bodyHtmlId: "<p>Hai</p>",
      audienceFilter: { all: true }, maxPerMinute: 60, maxPerHour: 600,
    }).returning();
    const [r] = await db.insert(emailCampaignRecipients).values({
      campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "h1",
    }).returning();
    const [d] = await db.insert(emailDeliveries).values({
      contactId: c.id, campaignRecipientId: r.id, emailType: "broadcast", status: "accepted",
    }).returning();
    await db.insert(emailSuppressions).values({ emailNormalized: "x@gmail.com", reason: "hard_bounce" });
    await db.insert(emailProviderEvents).values({ providerMessageId: "m1", eventType: "delivered", payload: {} });
    await db.insert(emailLinks).values({ campaignId: camp.id, urlHash: "u1", url: "https://a.b" });
    expect(r.status).toBe("pending");
    expect(d.status).toBe("accepted");
    expect(camp.status).toBe("draft");
  });
  it("rejects duplicate recipient per campaign and duplicate click token", async () => {
    const [c] = await db.insert(contacts).values({ emailNormalized: "d@gmail.com" }).returning();
    const [camp] = await db.insert(emailCampaigns).values({ subjectId: "s", bodyHtmlId: "b", audienceFilter: {}, maxPerMinute: 1, maxPerHour: 1 }).returning();
    await db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t1" });
    await expect(db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t2" })).rejects.toThrow();
    await expect(db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t1" })).rejects.toThrow();
  });
  it("round-trips snapshot render and first click columns on recipients", async () => {
    const [c] = await db.insert(contacts).values({ emailNormalized: "e@gmail.com" }).returning();
    const [camp] = await db.insert(emailCampaigns).values({ subjectId: "s", bodyHtmlId: "b", audienceFilter: { all: true }, maxPerMinute: 1, maxPerHour: 1 }).returning();
    const clickedAt = new Date("2026-09-14T08:00:00Z");
    const [r] = await db.insert(emailCampaignRecipients).values({
      campaignId: camp.id, contactId: c.id, localeSelected: "en", clickTokenHash: "t3",
      lastRenderedHtml: "<p>Rendered</p>", clickedAt,
    }).returning();
    expect(r.lastRenderedHtml).toBe("<p>Rendered</p>");
    expect(r.clickedAt).not.toBeNull();
    const [row] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, r.id));
    expect(row.lastRenderedHtml).toBe("<p>Rendered</p>");
    expect(row.clickedAt!.toISOString()).toBe(clickedAt.toISOString());
    const [r2] = await db.insert(emailCampaignRecipients).values({
      campaignId: camp.id, contactId: (await db.insert(contacts).values({ emailNormalized: "f@gmail.com" }).returning())[0].id,
      localeSelected: "id", clickTokenHash: "t4",
    }).returning();
    expect(r2.lastRenderedHtml).toBeNull();
    expect(r2.clickedAt).toBeNull();
  });
});
