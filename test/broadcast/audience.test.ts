import { beforeEach, describe, expect, it } from "vitest";
import { countAudience, resolveAudience, validateFilter } from "../../src/lib/broadcast/audience";
import { db } from "../../src/lib/db";
import {
  contacts,
  emailSuppressions,
  marketingSubscriptions,
  rewardCampaigns,
  rewardClaims,
} from "../../src/lib/schema";
import { resetDb } from "../helpers";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

async function seedContacts() {
  // [confirmed+active, confirmed+unsubscribed, pending, confirmed+active+suppressed, confirmed+active en]
  const defs = [
    { emailNormalized: "a@gmail.com", locale: "id", confirmationStatus: "confirmed" },
    { emailNormalized: "b@gmail.com", locale: "id", confirmationStatus: "confirmed" },
    { emailNormalized: "c@gmail.com", locale: "id", confirmationStatus: "pending" },
    { emailNormalized: "d@gmail.com", locale: "id", confirmationStatus: "confirmed" },
    { emailNormalized: "e@gmail.com", locale: "en", confirmationStatus: "confirmed" },
  ];
  const mkt = ["active", "unsubscribed", "active", "active", "active"];
  const inserted = [];
  for (let i = 0; i < defs.length; i++) {
    const [c] = await db.insert(contacts).values(defs[i]).returning();
    await db.insert(marketingSubscriptions).values({ contactId: c.id, status: mkt[i] });
    inserted.push(c);
  }
  await db.insert(emailSuppressions).values({ emailNormalized: "d@gmail.com", reason: "hard_bounce" });
  return inserted; // [a(in), b(out), c(out), d(out), e(in)]
}

async function seedCampaignsAndClaims(inserted: { id: string }[]) {
  const [a] = await db.insert(rewardCampaigns).values({ slug: "camp-a" }).returning();
  const [b] = await db.insert(rewardCampaigns).values({ slug: "camp-b" }).returning();
  // e (in audience) claims both; a (in audience) claims b only
  await db.insert(rewardClaims).values({ contactId: inserted[4].id, campaignId: a.id });
  await db.insert(rewardClaims).values({ contactId: inserted[4].id, campaignId: b.id });
  await db.insert(rewardClaims).values({ contactId: inserted[0].id, campaignId: b.id });
  return { a: a.id, b: b.id };
}

describe("validateFilter", () => {
  it("accepts filters with at least one criterion", () => {
    expect(validateFilter({ all: true })).toEqual({ ok: true, filter: { all: true } });
    expect(validateFilter({ locales: ["en"] })).toEqual({ ok: true, filter: { locales: ["en"] } });
    expect(validateFilter({ claimCampaignIds: [UUID_A], claimMode: "ANY" })).toEqual({
      ok: true,
      filter: { claimCampaignIds: [UUID_A], claimMode: "ANY" },
    });
    expect(validateFilter({ claimCampaignIds: [UUID_A, UUID_B], claimMode: "ALL" })).toEqual({
      ok: true,
      filter: { claimCampaignIds: [UUID_A, UUID_B], claimMode: "ALL" },
    });
  });
  it("rejects empty, malformed, or incomplete filters", () => {
    expect(validateFilter({}).ok).toBe(false);
    expect(validateFilter(null).ok).toBe(false);
    expect(validateFilter("x").ok).toBe(false);
    expect(validateFilter({ all: false }).ok).toBe(false);
    expect(validateFilter({ locales: [] }).ok).toBe(false);
    expect(validateFilter({ locales: ["fr"] }).ok).toBe(false);
    expect(validateFilter({ claimCampaignIds: [] }).ok).toBe(false);
    expect(validateFilter({ claimCampaignIds: [UUID_A] }).ok).toBe(false); // claimMode required
    expect(validateFilter({ claimCampaignIds: ["not-a-uuid"], claimMode: "ANY" }).ok).toBe(false);
  });
});

describe("audience resolution", () => {
  beforeEach(resetDb);

  it("counts only confirmed + active contacts for {all:true}", async () => {
    const inserted = await seedContacts();
    expect((await resolveAudience({ all: true })).map((r) => r.contactId).sort()).toEqual(
      [inserted[0].id, inserted[4].id].sort(),
    );
    expect(await countAudience({ all: true })).toBe(2);
  });

  it("resolves locale per contact with {all:true}", async () => {
    const inserted = await seedContacts();
    const rows = await resolveAudience({ all: true });
    const byId = new Map(rows.map((r) => [r.contactId, r.locale]));
    expect(byId.get(inserted[0].id)).toBe("id");
    expect(byId.get(inserted[4].id)).toBe("en");
  });

  it("filters by locales and keeps locale selection", async () => {
    const inserted = await seedContacts();
    expect(await countAudience({ locales: ["en"] })).toBe(1);
    const rows = await resolveAudience({ locales: ["en"] });
    expect(rows).toEqual([{ contactId: inserted[4].id, locale: "en" }]);
  });

  it("falls back to id locale when contact locale is not offered by the filter", async () => {
    const [c] = await db
      .insert(contacts)
      .values({ emailNormalized: "weird@gmail.com", locale: "xx", confirmationStatus: "confirmed" })
      .returning();
    await db.insert(marketingSubscriptions).values({ contactId: c.id, status: "active" });
    const rows = await resolveAudience({ all: true });
    expect(rows).toEqual([{ contactId: c.id, locale: "id" }]);
  });

  it("claimMode ANY matches contacts with a claim on any selected campaign", async () => {
    const inserted = await seedContacts();
    const { a, b } = await seedCampaignsAndClaims(inserted);
    const rows = await resolveAudience({ claimCampaignIds: [a], claimMode: "ANY" });
    expect(rows).toEqual([{ contactId: inserted[4].id, locale: "en" }]);
    const rowsB = await resolveAudience({ claimCampaignIds: [b], claimMode: "ANY" });
    expect(rowsB.map((r) => r.contactId).sort()).toEqual([inserted[0].id, inserted[4].id].sort());
  });

  it("claimMode ALL only matches contacts claiming every selected campaign", async () => {
    const inserted = await seedContacts();
    const { a, b } = await seedCampaignsAndClaims(inserted);
    const rows = await resolveAudience({ claimCampaignIds: [a, b], claimMode: "ALL" });
    expect(rows).toEqual([{ contactId: inserted[4].id, locale: "en" }]);
  });

  it("always excludes unsubscribed, pending, and suppressed contacts", async () => {
    const inserted = await seedContacts();
    const all = await resolveAudience({ all: true });
    const ids = all.map((r) => r.contactId);
    expect(ids).not.toContain(inserted[1].id);
    expect(ids).not.toContain(inserted[2].id);
    expect(ids).not.toContain(inserted[3].id);
  });
});
