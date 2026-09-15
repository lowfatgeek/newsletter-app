import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveClick } from "../../src/lib/broadcast/links";
import { generateOpaqueToken, hashToken } from "../../src/lib/crypto";
import { db } from "../../src/lib/db";
import { contacts, emailCampaignRecipients, emailCampaigns, emailLinks } from "../../src/lib/schema";
import { resetDb } from "../helpers";

async function seedCampaignAndRecipient() {
  const [contact] = await db
    .insert(contacts)
    .values({ emailNormalized: "a@gmail.com", confirmationStatus: "confirmed" })
    .returning();
  const [campA] = await db
    .insert(emailCampaigns)
    .values({
      subjectId: "A",
      preheaderId: "p",
      bodyHtmlId: "<p>a</p>",
      audienceFilter: { all: true },
      maxPerMinute: 60,
      maxPerHour: 600,
    })
    .returning();
  const [campB] = await db
    .insert(emailCampaigns)
    .values({
      subjectId: "B",
      preheaderId: "p",
      bodyHtmlId: "<p>b</p>",
      audienceFilter: { all: true },
      maxPerMinute: 60,
      maxPerHour: 600,
    })
    .returning();
  const [linkA] = await db
    .insert(emailLinks)
    .values({
      campaignId: campA.id,
      urlHash: hashToken("https://a.b/x"),
      url: "https://a.b/x",
    })
    .returning();
  const [linkB] = await db
    .insert(emailLinks)
    .values({
      campaignId: campB.id,
      urlHash: hashToken("https://b.b/y"),
      url: "https://b.b/y",
    })
    .returning();
  const token = generateOpaqueToken();
  const [recipient] = await db
    .insert(emailCampaignRecipients)
    .values({
      campaignId: campA.id,
      contactId: contact.id,
      localeSelected: "id",
      clickTokenHash: hashToken(token),
    })
    .returning();
  return { campA, campB, linkA, linkB, token, recipient };
}

beforeEach(resetDb);

describe("resolveClick", () => {
  it("resolves a valid link+token, records clickedAt once, and returns the original url", async () => {
    const { linkA, token, recipient } = await seedCampaignAndRecipient();
    expect(recipient.clickedAt).toBeNull();

    const r = await resolveClick(linkA.id, token);
    expect(r).toEqual({ ok: true, url: "https://a.b/x" });

    const [after] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id));
    expect(after.clickedAt).not.toBeNull();
  });

  it("is idempotent on first-click: second call keeps the original clickedAt", async () => {
    const { linkA, token, recipient } = await seedCampaignAndRecipient();
    await resolveClick(linkA.id, token);
    const [first] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, recipient.id));
    const firstAt = first.clickedAt!;

    // beri jarak waktu supaya now() kedua pasti berbeda
    await new Promise((res) => setTimeout(res, 30));
    const r2 = await resolveClick(linkA.id, token);
    expect(r2).toEqual({ ok: true, url: "https://a.b/x" });

    const [second] = await db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.id, recipient.id));
    expect(second.clickedAt!.getTime()).toBe(firstAt.getTime());
  });

  it("rejects a token that does not match any recipient", async () => {
    const { linkA } = await seedCampaignAndRecipient();
    expect(await resolveClick(linkA.id, generateOpaqueToken())).toEqual({ ok: false });
  });

  it("rejects an unknown linkId", async () => {
    const { token } = await seedCampaignAndRecipient();
    expect(await resolveClick("00000000-0000-0000-0000-000000000000", token)).toEqual({ ok: false });
  });

  it("rejects a malformed linkId without throwing", async () => {
    const { token } = await seedCampaignAndRecipient();
    expect(await resolveClick("not-a-uuid", token)).toEqual({ ok: false });
    expect(await resolveClick("", token)).toEqual({ ok: false });
    expect(await resolveClick("00000000-0000-0000-0000-000000000000", "")).toEqual({ ok: false });
  });

  it("rejects a link that belongs to another campaign than the recipient (mismatch)", async () => {
    const { linkB, token } = await seedCampaignAndRecipient();
    // linkB milik campaign B, token milik recipient campaign A → jangan bocorkan url
    expect(await resolveClick(linkB.id, token)).toEqual({ ok: false });
  });
});
