import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  contacts,
  marketingSubscriptions,
  consentEvents,
  emailSuppressions,
  emailCampaigns,
  emailCampaignRecipients,
  emailDomains,
  emailOutbox,
  rewardCampaignLocales,
  rewardCampaigns,
  rewardClaims,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";
import { hashToken, generateOpaqueToken } from "../../src/lib/crypto";
import {
  resolveUnsubscribeToken,
  unsubscribeByToken,
  resubscribeByToken,
} from "../../src/lib/broadcast/unsubscribe";
import { processSubscribe } from "../../src/lib/subscribe";
import { issueTimerToken } from "../../src/lib/timer";
import { issueClaimToken } from "../../src/lib/access";

/** Seed contact + campaign + recipient; return raw click token. */
async function seedRecipient(opts: {
  subscriptionStatus?: "active" | "unsubscribed" | null;
  suppressions?: Array<"unsubscribe" | "hard_bounce">;
} = {}) {
  const [contact] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
  const [camp] = await db.insert(emailCampaigns).values({
    subjectId: "Halo", preheaderId: "p", bodyHtmlId: "<p>hai</p>",
    audienceFilter: { all: true }, maxPerMinute: 60, maxPerHour: 600,
  }).returning();
  const token = generateOpaqueToken();
  const [recipient] = await db.insert(emailCampaignRecipients).values({
    campaignId: camp.id,
    contactId: contact.id,
    localeSelected: "id",
    clickTokenHash: hashToken(token),
  }).returning();
  if (opts.subscriptionStatus) {
    await db.insert(marketingSubscriptions).values({ contactId: contact.id, status: opts.subscriptionStatus, subscribedAt: new Date() });
  }
  for (const reason of opts.suppressions ?? []) {
    await db.insert(emailSuppressions).values({ emailNormalized: contact.emailNormalized, reason }).onConflictDoNothing();
  }
  return { contact, camp, recipient, token };
}

const agedToken = (campaignId: string) => issueTimerToken(campaignId, Date.now() - 31_000);

beforeEach(resetDb);

describe("resolveUnsubscribeToken", () => {
  it("resolves a valid token to recipientId + contactId", async () => {
    const { recipient, contact, token } = await seedRecipient();
    expect(await resolveUnsubscribeToken(token)).toEqual({ recipientId: recipient.id, contactId: contact.id });
  });

  it("returns null for an unknown or empty token", async () => {
    await seedRecipient();
    expect(await resolveUnsubscribeToken(generateOpaqueToken())).toBeNull();
    expect(await resolveUnsubscribeToken("")).toBeNull();
  });
});

describe("unsubscribeByToken", () => {
  it("sets subscription unsubscribed + unsubscribedAt, inserts suppression and consent event", async () => {
    const { contact, token } = await seedRecipient({ subscriptionStatus: "active" });

    expect(await unsubscribeByToken(token)).toEqual({ ok: true });

    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("unsubscribed");
    expect(sub.unsubscribedAt).not.toBeNull();

    const [sup] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.emailNormalized, contact.emailNormalized));
    expect(sup.reason).toBe("unsubscribe");

    const events = await db.select().from(consentEvents).where(eq(consentEvents.contactId, contact.id));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("unsubscribed");
  });

  it("is idempotent: second call is ok without a duplicate consent event or timestamp change", async () => {
    const { contact, token } = await seedRecipient({ subscriptionStatus: "active" });
    await unsubscribeByToken(token);
    const [first] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    const firstAt = first.unsubscribedAt!;

    expect(await unsubscribeByToken(token)).toEqual({ ok: true });

    const events = await db.select().from(consentEvents).where(eq(consentEvents.contactId, contact.id));
    expect(events).toHaveLength(1); // tidak ada consent kedua
    const suppressions = await db.select().from(emailSuppressions);
    expect(suppressions).toHaveLength(1); // onConflictDoNothing, tidak duplikat
    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.unsubscribedAt!.getTime()).toBe(firstAt.getTime());
  });

  it("works for a second campaign token of the same contact without duplicate consent", async () => {
    // Kontakt punya recipient di dua campaign (dua token berbeda) — unsubscribe
    // lewat token kedua tetap idempoten karena cek status subscription.
    const { contact, token } = await seedRecipient({ subscriptionStatus: "active" });
    await unsubscribeByToken(token);

    const [camp2] = await db.insert(emailCampaigns).values({
      subjectId: "H2", preheaderId: "p", bodyHtmlId: "<p>hai</p>",
      audienceFilter: { all: true }, maxPerMinute: 60, maxPerHour: 600,
    }).returning();
    const token2 = generateOpaqueToken();
    await db.insert(emailCampaignRecipients).values({
      campaignId: camp2.id, contactId: contact.id, localeSelected: "id", clickTokenHash: hashToken(token2),
    });

    expect(await unsubscribeByToken(token2)).toEqual({ ok: true });
    expect(await db.select().from(consentEvents).where(eq(consentEvents.contactId, contact.id))).toHaveLength(1);
  });

  it("creates an unsubscribed subscription row when none exists yet", async () => {
    const { contact, token } = await seedRecipient(); // tanpa subscription
    expect(await unsubscribeByToken(token)).toEqual({ ok: true });
    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("unsubscribed");
    expect(sub.unsubscribedAt).not.toBeNull();
  });

  it("rejects an invalid token", async () => {
    expect(await unsubscribeByToken(generateOpaqueToken())).toEqual({ ok: false });
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    expect(await db.select().from(consentEvents)).toHaveLength(0);
  });
});

describe("resubscribeByToken", () => {
  it("removes the unsubscribe suppression, reactivates subscription, records resubscribed consent", async () => {
    // Catatan skema: emailSuppressions PK = emailNormalized (satu baris per
    // email), jadi fixture hanya memakai satu reason. Penghapusan yang
    // terbatas pada reason 'unsubscribe' diuji di kasus berikutnya.
    const { contact, token } = await seedRecipient({
      subscriptionStatus: "unsubscribed",
      suppressions: ["unsubscribe"],
    });

    expect(await resubscribeByToken(token)).toEqual({ ok: true });

    const sups = await db.select().from(emailSuppressions).where(eq(emailSuppressions.emailNormalized, contact.emailNormalized));
    expect(sups).toHaveLength(0); // suppression unsubscribe dihapus

    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("active");
    expect(sub.subscribedAt).not.toBeNull();
    expect(sub.unsubscribedAt).toBeNull();

    const events = await db.select().from(consentEvents).where(eq(consentEvents.contactId, contact.id));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("resubscribed");
  });

  it("does not touch suppressions with other reasons (hard_bounce stays)", async () => {
    const { contact, token } = await seedRecipient({ subscriptionStatus: "unsubscribed" });
    await db.insert(emailSuppressions).values({ emailNormalized: contact.emailNormalized, reason: "hard_bounce" });

    expect(await resubscribeByToken(token)).toEqual({ ok: true });

    const sups = await db.select().from(emailSuppressions).where(eq(emailSuppressions.emailNormalized, contact.emailNormalized));
    expect(sups.map((s) => s.reason)).toEqual(["hard_bounce"]);
  });

  it("works when no subscription row exists (upsert path)", async () => {
    const { contact, token } = await seedRecipient({ suppressions: ["unsubscribe"] });
    expect(await resubscribeByToken(token)).toEqual({ ok: true });
    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("active");
  });

  it("rejects an invalid token", async () => {
    expect(await resubscribeByToken(generateOpaqueToken())).toEqual({ ok: false });
    expect(await db.select().from(consentEvents)).toHaveLength(0);
  });
});

describe("unsubscribed contact claims a reward", () => {
  // Kompromi (ruling brief): persetujuan ulang HANYA terjadi lewat halaman
  // eksplisit /subscribe-again/<token>. Flow reward (subscribe & konfirmasi)
  // tetap jalan untuk email transaksional tapi TIDAK PERNAH menyentuh status
  // marketing — suppress/unsubscribed hanya bisa dibuka via resubscribeByToken.

  it("processSubscribe: claim + access email tetap dibuat, marketing tetap unsubscribed", async () => {
    setEnv({ MOCK_EMAILIT: "true" });
    await db.insert(emailDomains).values({ domain: "gmail.com" });
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "starter", status: "published" }).returning();
    await db.insert(rewardCampaignLocales).values({
      campaignId: camp.id, locale: "id", title: "KelasWFA", description: "Deskripsi.",
    });
    const [contact] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    await db.insert(marketingSubscriptions).values({ contactId: contact.id, status: "unsubscribed", unsubscribedAt: new Date() });

    const r = await processSubscribe({
      email: "budi@gmail.com",
      timerToken: agedToken(camp.id),
      honeypot: "",
      ip: "1.2.3.4",
      campaignId: camp.id,
      siteUrl: "http://localhost:4321",
      locale: "id",
    });
    expect(r).toEqual({ ok: true, alreadyConfirmed: true }); // respons tetap generik

    const claims = await db.select().from(rewardClaims).where(eq(rewardClaims.contactId, contact.id));
    expect(claims).toHaveLength(1); // claim tetap dibuat
    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0].emailType).toBe("reward_access"); // email transaksional tetap terkirim

    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("unsubscribed"); // marketing TIDAK disentuh
  });

  it("confirmContactByToken does NOT reactivate an unsubscribed subscription", async () => {
    const { contact } = await seedRecipient({ subscriptionStatus: "unsubscribed" });
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "c2" }).returning();
    const claimId = await db.insert(rewardClaims).values({ contactId: contact.id, campaignId: camp.id }).returning().then((r) => r[0].id);
    const raw = await issueClaimToken(claimId, "confirm");

    expect(await (await import("../../src/lib/access")).confirmContactByToken(raw)).toMatchObject({ ok: true });

    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("unsubscribed"); // consent tetap dihormati
    const events = await db.select().from(consentEvents).where(eq(consentEvents.contactId, contact.id));
    expect(events).toHaveLength(0); // tanpa event 'subscribed' otomatis
  });

  it("full round trip: unsubscribe → resubscribe via token reactivates consent only", async () => {
    const { contact, token } = await seedRecipient({ subscriptionStatus: "active" });
    await unsubscribeByToken(token);
    expect((await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id)))[0].status).toBe("unsubscribed");
    await resubscribeByToken(token);
    const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, contact.id));
    expect(sub.status).toBe("active");
    const events = await db.select().from(consentEvents).where(and(eq(consentEvents.contactId, contact.id)));
    expect(events.map((e) => e.event).sort()).toEqual(["resubscribed", "unsubscribed"]);
  });
});
