import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/lib/db";
import {
  accessTokens,
  contacts,
  emailOutbox,
  marketingSubscriptions,
  rewardCampaigns,
  rewardClaims,
} from "../src/lib/schema";
import { getFunnelStats } from "../src/lib/funnel";
import { resetDb } from "./helpers";

async function seedMinimal() {
  const [campaign] = await db
    .insert(rewardCampaigns)
    .values({ slug: "hadiah-uji", status: "published", indexable: true })
    .returning();

  // c1: confirmed hari ini + subscriber aktif; c2: confirmed 40 hari lalu +
  // berhenti; c3: pending tanpa subscription.
  const [c1] = await db
    .insert(contacts)
    .values({ emailNormalized: "aktif@gmail.com", confirmationStatus: "confirmed", confirmedAt: new Date() })
    .returning();
  const [c2] = await db
    .insert(contacts)
    .values({
      emailNormalized: "berhenti@gmail.com",
      confirmationStatus: "confirmed",
      confirmedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
    })
    .returning();
  await db.insert(contacts).values({ emailNormalized: "baru@gmail.com" });

  await db.insert(marketingSubscriptions).values({ contactId: c1.id, status: "active", subscribedAt: new Date() });
  await db.insert(marketingSubscriptions).values({
    contactId: c2.id,
    status: "unsubscribed",
    unsubscribedAt: new Date(),
  });

  const [claim] = await db
    .insert(rewardClaims)
    .values({ contactId: c1.id, campaignId: campaign.id })
    .returning();

  await db.insert(emailOutbox).values([
    {
      emailType: "confirmation",
      toEmail: "aktif@gmail.com",
      subject: "Konfirmasi",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "conf-1",
    },
    {
      emailType: "confirmation",
      toEmail: "berhenti@gmail.com",
      subject: "Konfirmasi",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "conf-2",
    },
    {
      emailType: "reward_access",
      toEmail: "aktif@gmail.com",
      subject: "Hadiah",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "acc-1",
    },
  ]);

  await db.insert(accessTokens).values({
    claimId: claim.id,
    type: "session",
    tokenHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });
}

describe("getFunnelStats", () => {
  beforeEach(resetDb);

  it("menghitung 8 angka funnel dari tabel existing", async () => {
    await seedMinimal();
    const s = await getFunnelStats();
    expect(s).toEqual({
      contactsTotal: 3,
      contactsConfirmed30d: 1,
      activeSubscribers: 1,
      claimsTotal: 1,
      confirmationsSent: 2,
      rewardAccessSent: 1,
      downloadsIssued: 1,
      unsubscribedTotal: 1,
    });
  });

  it("nol semua saat DB kosong", async () => {
    const s = await getFunnelStats();
    expect(s).toEqual({
      contactsTotal: 0,
      contactsConfirmed30d: 0,
      activeSubscribers: 0,
      claimsTotal: 0,
      confirmationsSent: 0,
      rewardAccessSent: 0,
      downloadsIssued: 0,
      unsubscribedTotal: 0,
    });
  });
});
