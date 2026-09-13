import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/lib/db";
import { contacts, rewardCampaigns, rewardClaims, accessTokens } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import {
  upsertClaim, issueClaimToken, issueSessionToken, consumeToken, confirmContactByToken,
} from "../src/lib/access";
import { resetDb } from "./helpers";

async function seedContact() {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "test-camp" }).returning();
  return { contact: c, campaign: camp };
}

describe("access tokens", () => {
  beforeEach(resetDb);

  it("upsertClaim returns same claim on repeat", async () => {
    const { contact, campaign } = await seedContact();
    const id1 = await upsertClaim(contact.id, campaign.id);
    const id2 = await upsertClaim(contact.id, campaign.id);
    expect(id1).toBe(id2);
  });

  it("confirm token: one-time, 7 days, confirms contact and activates subscription", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "confirm");
    const first = await confirmContactByToken(raw);
    expect(first).toMatchObject({ ok: true, claimId });
    expect(await confirmContactByToken(raw)).toEqual({ ok: false }); // dipakai dua kali
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c.confirmationStatus).toBe("confirmed");
    const claims = await db.select().from(rewardClaims).where(eq(rewardClaims.id, claimId));
    expect(claims[0].status).toBe("accessed");
  });

  it("expired token is rejected", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "access");
    await db.update(accessTokens).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.claimId, claimId));
    expect(await consumeToken(raw, "access")).toEqual({ ok: false });
  });

  it("session token is reusable within 1 hour", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueSessionToken(claimId);
    expect(await consumeToken(raw, "session")).toMatchObject({ ok: true, claimId });
    expect(await consumeToken(raw, "session")).toMatchObject({ ok: true, claimId });
  });

  it("wrong type is rejected", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "confirm");
    expect(await consumeToken(raw, "access")).toEqual({ ok: false });
  });
});
