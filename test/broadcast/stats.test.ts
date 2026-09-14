import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  contacts, marketingSubscriptions, consentEvents, emailCampaigns,
  emailCampaignRecipients, emailDeliveries, emailOutbox, adminAuditLog, adminUsers,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";
import { campaignStats, progressOf, sendTestEmail } from "../../src/lib/broadcast/stats";

/**
 * Statistik kampanye broadcast (Task 10).
 *
 * Angka tabular tanpa open rate: recipients/sent dari emailCampaignRecipients,
 * delivered/failed/bounced dari emailDeliveries (email_type broadcast),
 * clicks dari clickedAt, unsubscribed dari consent event "unsubscribed"
 * kontak SETELAH email dikirim (per-recipient sentAt, fallback snapshotAt).
 */

async function seedContact(email: string) {
  const [c] = await db.insert(contacts).values({
    emailNormalized: email, confirmationStatus: "confirmed",
  }).returning();
  await db.insert(marketingSubscriptions).values({ contactId: c.id, status: "active", subscribedAt: new Date() });
  return c;
}

async function seedCampaign() {
  const [c] = await db.insert(emailCampaigns).values({
    status: "completed",
    subjectId: "Halo {{email}}",
    subjectEn: "Hello {{email}}",
    preheaderId: "pratinjau",
    preheaderEn: "preview",
    bodyHtmlId: '<p>Hai <a href="https://a.b/x">satu</a></p>',
    bodyHtmlEn: '<p>Hi <a href="https://a.b/x">one</a></p>',
    audienceFilter: { all: true },
    maxPerMinute: 60,
    maxPerHour: 600,
    snapshotAt: new Date(Date.now() - 60_000),
  }).returning();
  return c;
}

type RecipFixture = {
  contactId: string;
  status: "sent" | "failed";
  clicked?: boolean;
  delivery: { status: string; sentAt: Date } | null;
};

async function seedRecipient(campaignId: string, f: RecipFixture) {
  const [r] = await db.insert(emailCampaignRecipients).values({
    campaignId,
    contactId: f.contactId,
    localeSelected: "id",
    status: f.status,
    clickTokenHash: `tok-${Math.random().toString(36).slice(2)}${Date.now()}`,
    clickedAt: f.clicked ? new Date() : null,
    lastRenderedHtml: "<p>html</p>",
  }).returning();
  if (f.delivery) {
    await db.insert(emailDeliveries).values({
      contactId: f.contactId,
      campaignRecipientId: r.id,
      emailType: "broadcast",
      status: f.delivery.status,
      sentAt: f.delivery.sentAt,
    });
  }
  return r;
}

beforeEach(() => {
  setEnv({ PUBLIC_SITE_URL: "https://kado.test" });
  delete process.env.TEST_SEND_ADDRESSES;
  return resetDb();
});

describe("campaignStats", () => {
  it("counts all seven KPIs from the fixture (no open rate)", async () => {
    const camp = await seedCampaign();
    const sentAt = new Date(Date.now() - 30_000);

    const a = await seedContact("a@gmail.com"); // sent + delivered + click, unsub sebelum kirim (tidak dihitung)
    const b = await seedContact("b@gmail.com"); // sent + accepted
    const c = await seedContact("c@gmail.com"); // failed, unsub setelah kirim (dihitung)

    await seedRecipient(camp.id, {
      contactId: a.id, status: "sent", clicked: true,
      delivery: { status: "delivered", sentAt },
    });
    await seedRecipient(camp.id, {
      contactId: b.id, status: "sent",
      delivery: { status: "accepted", sentAt },
    });
    await seedRecipient(camp.id, {
      contactId: c.id, status: "failed",
      delivery: { status: "failed", sentAt },
    });

    // consent events: a unsub SEBELUM kirim (tidak dihitung), c unsub SETELAH kirim (dihitung)
    await db.insert(consentEvents).values([
      { contactId: a.id, event: "subscribed", createdAt: new Date(sentAt.getTime() - 60_000) },
      { contactId: a.id, event: "unsubscribed", createdAt: new Date(sentAt.getTime() - 30_000) },
      { contactId: c.id, event: "unsubscribed", createdAt: new Date(sentAt.getTime() + 30_000) },
    ]);

    const stats = await campaignStats(camp.id);
    expect(stats).toEqual({
      recipients: 3,
      sent: 2,
      delivered: 1,
      failed: 1,
      bounced: 0,
      unsubscribed: 1,
      clicks: 1,
    });
  });

  it("counts bounced deliveries and ignores other campaigns' rows", async () => {
    const camp = await seedCampaign();
    const other = await seedCampaign();
    const sentAt = new Date(Date.now() - 30_000);

    const a = await seedContact("a2@gmail.com");
    const b = await seedContact("b2@gmail.com");
    await seedRecipient(camp.id, { contactId: a.id, status: "sent", delivery: { status: "bounced", sentAt } });
    const rOther = await seedRecipient(other.id, { contactId: b.id, status: "sent", delivery: { status: "delivered", sentAt } });

    const stats = await campaignStats(camp.id);
    expect(stats).toEqual({
      recipients: 1, sent: 1, delivered: 0, failed: 0, bounced: 1, unsubscribed: 0, clicks: 0,
    });

    // delivery milik kampanye lain tidak bocor
    expect(rOther.campaignId).toBe(other.id);
    const statsOther = await campaignStats(other.id);
    expect(statsOther.delivered).toBe(1);
    expect(statsOther.recipients).toBe(1);
  });
});

describe("progressOf", () => {
  it("reports total and sentSoFar", async () => {
    const camp = await seedCampaign();
    const sentAt = new Date(Date.now() - 30_000);
    const a = await seedContact("p1@gmail.com");
    const b = await seedContact("p2@gmail.com");
    const c = await seedContact("p3@gmail.com");
    await seedRecipient(camp.id, { contactId: a.id, status: "sent", delivery: { status: "delivered", sentAt } });
    await seedRecipient(camp.id, { contactId: b.id, status: "sent", delivery: { status: "accepted", sentAt } });
    await seedRecipient(camp.id, { contactId: c.id, status: "pending", delivery: null });

    expect(await progressOf(camp.id)).toEqual({ total: 3, sentSoFar: 2 });
  });
});

describe("sendTestEmail", () => {
  it("rejects addresses outside TEST_SEND_ADDRESSES (default allowlist)", async () => {
    const camp = await seedCampaign();
    const res = await sendTestEmail(camp.id, "attacker@evil.com", { adminUserId: null, ip: "1.1.1.1" });
    expect(res).toEqual({ ok: false, reason: "not-allowed" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_test_sent"))).toHaveLength(0);
  });

  it("allowlist is case-insensitive and supports multiple addresses", async () => {
    const camp = await seedCampaign();
    setEnv({ TEST_SEND_ADDRESSES: "Ops@Example.com, kelaswfa@gmail.com" });
    const res = await sendTestEmail(camp.id, "ops@example.com", { adminUserId: null, ip: "1.1.1.1" });
    expect(res).toEqual({ ok: true });
    const outbox = await db.select().from(emailOutbox);
    expect(outbox).toHaveLength(2); // id + en
  });

  it("returns no-content when campaign lacks ID content", async () => {
    const [camp] = await db.insert(emailCampaigns).values({
      subjectId: "", preheaderId: "", bodyHtmlId: "", maxPerMinute: 60, maxPerHour: 600,
    }).returning();
    const res = await sendTestEmail(camp.id, "kelaswfa@gmail.com", { adminUserId: null, ip: "1.1.1.1" });
    expect(res).toEqual({ ok: false, reason: "no-content" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("enqueues 2 broadcast_test rows ([TEST] prefixed, id+en), no recipients/deliveries, audits", async () => {
    const camp = await seedCampaign();
    const [admin] = await db.insert(adminUsers).values({
      email: "admin@test.dev", passwordHash: "x",
    }).returning();
    const res = await sendTestEmail(camp.id, "kelaswfa@gmail.com", { adminUserId: admin.id, ip: "1.1.1.1" });
    expect(res).toEqual({ ok: true });

    const outbox = await db.select().from(emailOutbox).orderBy(emailOutbox.subject);
    expect(outbox).toHaveLength(2);
    expect(outbox.every((m) => m.emailType === "broadcast_test")).toBe(true);
    expect(outbox.every((m) => m.toEmail === "kelaswfa@gmail.com")).toBe(true);
    expect(outbox.every((m) => m.subject.startsWith("[TEST] "))).toBe(true);
    expect(outbox.map((m) => m.subject)).toEqual(
      expect.arrayContaining(["[TEST] Halo kelaswfa@gmail.com", "[TEST] Hello kelaswfa@gmail.com"]),
    );
    // idempotencyKey bentuk test-<campaignId>-<locale>-<ts>, unik per locale
    const keys = outbox.map((m) => m.idempotencyKey).sort();
    expect(keys[0]).toMatch(new RegExp(`^test-${camp.id}-en-\\d+$`));
    expect(keys[1]).toMatch(new RegExp(`^test-${camp.id}-id-\\d+$`));
    expect(new Set(keys).size).toBe(2);

    // test send TIDAK menyentuh recipients/stats
    expect(await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, camp.id))).toHaveLength(0);
    expect(await db.select().from(emailDeliveries)).toHaveLength(0);

    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_test_sent"));
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toEqual({ address: "kelaswfa@gmail.com" });
    expect(audits[0].adminUserId).toBe(admin.id);
  });
});
