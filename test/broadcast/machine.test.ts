import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelCampaign,
  claimForSending,
  getCampaignForBroadcast,
  markCompleted,
  markFailed,
  pauseCampaign,
  resumeCampaign,
  scheduleCampaign,
  validateLimits,
} from "../../src/lib/broadcast/machine";
import { db } from "../../src/lib/db";
import {
  adminAuditLog,
  adminUsers,
  contacts,
  emailCampaignRecipients,
  emailCampaigns,
  marketingSubscriptions,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

const AUDIT = { adminUserId: "00000000-0000-0000-0000-000000000000", ip: "10.0.0.1" };

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "admin@kado.test", passwordHash: "h" }).returning();
  AUDIT.adminUserId = u.id;
  return u;
}

async function seedAudience(n = 2) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [c] = await db
      .insert(contacts)
      .values({
        emailNormalized: `u${i}@gmail.com`,
        locale: "id",
        confirmationStatus: "confirmed",
      })
      .returning();
    await db.insert(marketingSubscriptions).values({ contactId: c.id, status: "active" });
    out.push(c);
  }
  return out;
}

async function seedCampaign(overrides: Partial<typeof emailCampaigns.$inferInsert> = {}) {
  const [c] = await db
    .insert(emailCampaigns)
    .values({
      subjectId: "Halo",
      preheaderId: "pratinjau",
      bodyHtmlId: '<p>Hai <a href="https://a.b/x">satu</a></p>',
      audienceFilter: { all: true },
      maxPerMinute: 60,
      maxPerHour: 600,
      ...overrides,
    })
    .returning();
  return c;
}

beforeEach(() => {
  setEnv({ PUBLIC_SITE_URL: "https://kado.test" });
  delete process.env.EMAILIT_MAX_PER_DAY;
  delete process.env.EMAILIT_MAX_PER_SECOND;
  return resetDb().then(seedAdmin);
});

describe("validateLimits", () => {
  it("rejects non-positive values", () => {
    expect(validateLimits(0, 100)).toEqual({ ok: false, reason: "non-positive" });
    expect(validateLimits(-1, 100)).toEqual({ ok: false, reason: "non-positive" });
    expect(validateLimits(10, 0)).toEqual({ ok: false, reason: "non-positive" });
    expect(validateLimits(-5, -5)).toEqual({ ok: false, reason: "non-positive" });
  });

  it("rejects maxPerMinute > maxPerHour as exceeding provider capacity", () => {
    expect(validateLimits(100, 50)).toEqual({ ok: false, reason: "exceeds-provider" });
  });

  it("rejects rates above the provider daily cap", () => {
    setEnv({ EMAILIT_MAX_PER_DAY: "1000" });
    // 30 * 60 = 1800 > 1000
    expect(validateLimits(30, 500)).toEqual({ ok: false, reason: "exceeds-provider" });
    // 1200 > 1000
    expect(validateLimits(10, 1200)).toEqual({ ok: false, reason: "exceeds-provider" });
  });

  it("accepts rates within provider capacity", () => {
    setEnv({ EMAILIT_MAX_PER_DAY: "5000" });
    expect(validateLimits(2, 100)).toEqual({ ok: true });
    // maxPerMinute * 60 = 3000 <= 5000, maxPerHour <= 5000
    expect(validateLimits(50, 5000)).toEqual({ ok: true });
    expect(validateLimits(1, 1)).toEqual({ ok: true });
  });
});

describe("getCampaignForBroadcast", () => {
  it("returns the full campaign row", async () => {
    const seeded = await seedCampaign();
    const c = await getCampaignForBroadcast(seeded.id);
    expect(c?.id).toBe(seeded.id);
    expect(c?.status).toBe("draft");
    expect(c?.subjectId).toBe("Halo");
  });

  it("returns null for unknown id", async () => {
    expect(await getCampaignForBroadcast("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("scheduleCampaign", () => {
  it("schedules a complete draft: status scheduled, scheduledAt + snapshotAt set, recipients snapshotted, audited", async () => {
    await seedAudience(2);
    const c = await seedCampaign();
    const at = new Date(Date.now() + 60 * 60 * 1000);
    const res = await scheduleCampaign(c.id, { scheduledAt: at }, AUDIT);
    expect(res).toEqual({ ok: true, status: "scheduled" });

    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("scheduled");
    expect(row.scheduledAt?.getTime()).toBe(at.getTime());
    expect(row.snapshotAt).not.toBeNull();

    const recipients = await db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, c.id));
    expect(recipients).toHaveLength(2);

    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_scheduled"));
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ campaignId: c.id, recipients: 2 });
    expect(new Date((audits[0]!.detail as Record<string, unknown>).scheduledAt as string).getTime()).toBe(at.getTime());
  });

  it("send-now (scheduledAt null) goes straight to queued with snapshot", async () => {
    await seedAudience(1);
    const c = await seedCampaign();
    const res = await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(res).toEqual({ ok: true, status: "queued" });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("queued");
    expect(row.scheduledAt).toBeNull();
    expect(row.snapshotAt).not.toBeNull();
    const recipients = await db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, c.id));
    expect(recipients).toHaveLength(1);
  });

  it("rejects with missing-id when ID content fields are absent", async () => {
    const c = await seedCampaign({ preheaderId: "" });
    const res = await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(res).toEqual({ ok: false, reason: "missing-id" });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("draft");
    expect(row.snapshotAt).toBeNull();
  });

  it("rejects with limits when configured rates exceed provider capacity", async () => {
    setEnv({ EMAILIT_MAX_PER_DAY: "1000" });
    const c = await seedCampaign({ maxPerMinute: 60, maxPerHour: 2000 });
    const res = await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(res).toEqual({ ok: false, reason: "limits", detail: { maxPerMinute: 60, maxPerHour: 2000 } });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("draft");
  });

  it("rejects re-scheduling a non-draft campaign (not-draft) without duplicating snapshot", async () => {
    await seedAudience(2);
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: new Date(Date.now() + 60000) }, AUDIT);
    const res = await scheduleCampaign(c.id, { scheduledAt: new Date(Date.now() + 120000) }, AUDIT);
    expect(res).toEqual({ ok: false, reason: "not-draft" });
    const recipients = await db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, c.id));
    expect(recipients).toHaveLength(2);
  });

  it("rejects a scheduledAt in the past (in-past) without snapshotting", async () => {
    await seedAudience(1);
    const c = await seedCampaign();
    const res = await scheduleCampaign(c.id, { scheduledAt: new Date(Date.now() - 1000) }, AUDIT);
    expect(res).toEqual({ ok: false, reason: "in-past" });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("draft");
    expect(row.snapshotAt).toBeNull();
    const recipients = await db.select().from(emailCampaignRecipients);
    expect(recipients).toHaveLength(0);
  });
});

describe("claimForSending", () => {
  it("claims a queued campaign atomically: second claim returns false", async () => {
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(await claimForSending(c.id)).toBe(true);
    expect(await claimForSending(c.id)).toBe(false);
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("sending");
  });

  it("refuses to claim a campaign that is not queued", async () => {
    const c = await seedCampaign();
    expect(await claimForSending(c.id)).toBe(false); // draft
  });

  it("refuses to claim while ANOTHER campaign is sending (single-sending guard)", async () => {
    const a = await seedCampaign();
    const b = await seedCampaign();
    await scheduleCampaign(a.id, { scheduledAt: null }, AUDIT);
    await scheduleCampaign(b.id, { scheduledAt: null }, AUDIT);
    expect(await claimForSending(a.id)).toBe(true);
    // B tetap queued — klaim ditolak karena A sending
    expect(await claimForSending(b.id)).toBe(false);
    const [rowB] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, b.id));
    expect(rowB.status).toBe("queued");
  });

  it("allows claiming B after A leaves sending", async () => {
    const a = await seedCampaign();
    const b = await seedCampaign();
    await scheduleCampaign(a.id, { scheduledAt: null }, AUDIT);
    await scheduleCampaign(b.id, { scheduledAt: null }, AUDIT);
    expect(await claimForSending(a.id)).toBe(true);
    expect(await markCompleted(a.id, AUDIT)).toEqual({ ok: true });
    expect(await claimForSending(b.id)).toBe(true);
  });

  it("two concurrent claims on different queued campaigns: exactly one wins, no rejection", async () => {
    const a = await seedCampaign();
    const b = await seedCampaign();
    await scheduleCampaign(a.id, { scheduledAt: null }, AUDIT);
    await scheduleCampaign(b.id, { scheduledAt: null }, AUDIT);

    // Klaim dilempar paralel — kalah oleh WHERE NOT EXISTS maupun partial
    // unique index `email_campaigns_single_sending_uq` (23505) harus sama-sama
    // menghasilkan `false`, bukan rejected promise.
    const results = await Promise.all([claimForSending(a.id), claimForSending(b.id)]);
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(results.filter((r) => r === false)).toHaveLength(1);

    const rows = await db.select({ id: emailCampaigns.id, status: emailCampaigns.status }).from(emailCampaigns);
    expect(rows).toHaveLength(2);
    const sending = rows.filter((r) => r.status === "sending");
    const queued = rows.filter((r) => r.status === "queued");
    expect(sending).toHaveLength(1);
    expect(queued).toHaveLength(1);
    // Invariant PRD §7.4: tidak pernah ada dua campaign berstatus sending.
    const [stillSending] = await db
      .select({ id: emailCampaigns.id })
      .from(emailCampaigns)
      .where(eq(emailCampaigns.status, "sending"));
    expect(stillSending.id).toBe(sending[0].id);
  });
});

describe("markCompleted / markFailed", () => {
  it("marks sending campaign completed and audits campaign_sent", async () => {
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    await claimForSending(c.id);
    expect(await markCompleted(c.id, AUDIT)).toEqual({ ok: true });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("completed");
    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_sent"));
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ campaignId: c.id });
  });

  it("refuses to complete from a non-sending status", async () => {
    const c = await seedCampaign();
    expect(await markCompleted(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
  });

  it("marks failed from sending or queued without storing the error on the campaign", async () => {
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(await markFailed(c.id, "provider 500", AUDIT)).toEqual({ ok: true });
    let [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("failed");
    // no error column on campaign — verify schema has none by checking status only
    await db.update(emailCampaigns).set({ status: "queued" }).where(eq(emailCampaigns.id, c.id));
    expect(await markFailed(c.id, "again", AUDIT)).toEqual({ ok: true });
    [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("failed");
    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "broadcast_failed"));
    expect(audits).toHaveLength(2);
    expect(audits[0].detail).toMatchObject({ campaignId: c.id, error: "provider 500" });
  });

  it("refuses to fail a draft campaign", async () => {
    const c = await seedCampaign();
    expect(await markFailed(c.id, "x", AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
  });

  it("returns not-found for unknown campaign ids", async () => {
    expect(await markCompleted("00000000-0000-0000-0000-000000000000", AUDIT)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await markFailed("00000000-0000-0000-0000-000000000000", "x", AUDIT)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("pause / resume", () => {
  it("pauses a sending campaign and resumes back to queued, with audits", async () => {
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    await claimForSending(c.id);

    expect(await pauseCampaign(c.id, AUDIT)).toEqual({ ok: true });
    let [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("paused");

    expect(await resumeCampaign(c.id, AUDIT)).toEqual({ ok: true });
    [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("queued");

    const paused = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_paused"));
    const resumed = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_resumed"));
    expect(paused).toHaveLength(1);
    expect(resumed).toHaveLength(1);
  });

  it("only pauses from sending and only resumes from paused", async () => {
    const c = await seedCampaign();
    expect(await pauseCampaign(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
    expect(await resumeCampaign(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(await resumeCampaign(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
  });
});

describe("cancelCampaign", () => {
  it("cancels a scheduled campaign and cancels its pending recipients", async () => {
    await seedAudience(2);
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: new Date(Date.now() + 60000) }, AUDIT);
    expect(await cancelCampaign(c.id, AUDIT)).toEqual({ ok: true });
    const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id));
    expect(row.status).toBe("cancelled");
    const recipients = await db
      .select()
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, c.id));
    expect(recipients).toHaveLength(2);
    expect(recipients.every((r) => r.status === "cancelled")).toBe(true);
    const audits = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "campaign_cancelled"));
    expect(audits).toHaveLength(1);
  });

  it("cancels from queued and paused too", async () => {
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null }, AUDIT);
    expect(await cancelCampaign(c.id, AUDIT)).toEqual({ ok: true });

    const c2 = await seedCampaign({ subjectId: "dua" });
    await scheduleCampaign(c2.id, { scheduledAt: null }, AUDIT);
    await claimForSending(c2.id);
    await pauseCampaign(c2.id, AUDIT);
    expect(await cancelCampaign(c2.id, AUDIT)).toEqual({ ok: true });
  });

  it("refuses to cancel a draft or completed campaign", async () => {
    const c = await seedCampaign();
    expect(await cancelCampaign(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
    await db.update(emailCampaigns).set({ status: "completed" }).where(eq(emailCampaigns.id, c.id));
    expect(await cancelCampaign(c.id, AUDIT)).toEqual({ ok: false, reason: "invalid-transition" });
  });
});
