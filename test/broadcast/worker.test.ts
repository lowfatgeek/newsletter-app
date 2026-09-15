import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCampaignForBroadcast, scheduleCampaign } from "../../src/lib/broadcast/machine";
import { snapshotRecipients } from "../../src/lib/broadcast/snapshot";
import { processBroadcast } from "../../src/lib/broadcast/worker";
import { db } from "../../src/lib/db";
import {
  contacts,
  emailCampaignRecipients,
  emailCampaigns,
  emailDeliveries,
  emailLinks,
  emailOutbox,
  marketingSubscriptions,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

/**
 * Worker broadcast (Task 6).
 *
 * Render-at-snapshot: worker TIDAK merender ulang — mengirim
 * lastRenderedHtml hasil snapshot (sudah berisi link click + unsubscribe
 * dengan token raw). Subject {{email}}/{{locale}} diganti per-recipient
 * di worker karena subject tidak ikut di-render ke html.
 *
 * Single-flight: claimForSending (UPDATE ... WHERE status='queued') adalah
 * satu-satunya mekanisme mutual exclusion — tidak ada advisory lock.
 */

interface CapturedSend {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}

/** Fetch mock yang merekam body request ke api.emailit.com. */
function makeFetch(
  handler?: (msg: { to: string; subject: string; html: string }) => { status: number; id?: string; text?: string },
) {
  const calls: CapturedSend[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
    const body = JSON.parse(init!.body!);
    const msg = {
      to: body.to[0],
      subject: body.subject,
      html: body.html,
      text: body.text,
      idempotencyKey: init!.headers?.["Idempotency-Key"],
    };
    calls.push(msg);
    const res = handler?.(msg) ?? { status: 200, id: `prov-${calls.length}` };
    if (res.status !== 200) {
      return { ok: false, status: res.status, text: async () => res.text ?? "boom" };
    }
    return { ok: true, status: 200, json: async () => ({ id: res.id ?? `prov-${calls.length}` }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function seedContact(email: string, locale: "id" | "en" = "id") {
  const [c] = await db
    .insert(contacts)
    .values({
      emailNormalized: email,
      locale,
      confirmationStatus: "confirmed",
    })
    .returning();
  await db.insert(marketingSubscriptions).values({ contactId: c.id, status: "active" });
  return c;
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

async function recipientsOf(campaignId: string) {
  return db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, campaignId));
}

beforeEach(() => {
  setEnv({ PUBLIC_SITE_URL: "https://kado.test", EMAILIT_API_KEY: "test", MO_BROADCAST: "false" });
  delete process.env.EMAILIT_MAX_PER_DAY;
  return resetDb();
});

describe("processBroadcast — idle & promotion", () => {
  it("is idle when there is no campaign", async () => {
    expect(await processBroadcast()).toEqual({ campaignId: null, sent: 0, skipped: 0, stopped: "idle" });
  });

  it("does not promote a scheduled campaign before its time", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign();
    const at = new Date(Date.now() + 60_000);
    await scheduleCampaign(c.id, { scheduledAt: at });
    const res = await processBroadcast({ now: new Date(at.getTime() - 1000) });
    expect(res.stopped).toBe("idle");
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("scheduled");
  });

  it("promotes a due scheduled campaign, sends all recipients via MO_BROADCAST, completes", async () => {
    await seedContact("u0@gmail.com");
    await seedContact("u1@gmail.com");
    const c = await seedCampaign();
    const at = new Date(Date.now() + 60_000);
    await scheduleCampaign(c.id, { scheduledAt: at });
    const now = new Date(at.getTime() + 1000);

    setEnv({ MO_BROADCAST: "true" });
    const res = await processBroadcast({ now });
    expect(res).toMatchObject({ campaignId: c.id, sent: 2, skipped: 0, stopped: "completed" });
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("completed");

    const recips = await recipientsOf(c.id);
    expect(recips.every((r) => r.status === "sent")).toBe(true);

    // MO_BROADCAST: id pesanan palsu mo-<recipientId>, delivery accepted
    const deliveries = await db.select().from(emailDeliveries);
    expect(deliveries).toHaveLength(2);
    for (const d of deliveries) {
      expect(d.emailType).toBe("broadcast");
      expect(d.status).toBe("accepted");
      expect(d.sentAt?.getTime()).toBe(now.getTime());
      expect(d.providerMessageId).toBe(`mo-${d.campaignRecipientId}`);
    }
  });
});

describe("processBroadcast — rate limits", () => {
  it("stops at the minute limit, requeues, and finishes on the next tick", async () => {
    for (let i = 0; i < 3; i++) await seedContact(`u${i}@gmail.com`);
    const c = await seedCampaign({ maxPerMinute: 2, maxPerHour: 600 });
    await scheduleCampaign(c.id, { scheduledAt: null });
    const { calls, fetchImpl } = makeFetch();
    const now = new Date();

    const res1 = await processBroadcast({ now, fetchImpl });
    expect(res1).toMatchObject({ campaignId: c.id, sent: 2, skipped: 0, stopped: "completed-partial" });
    expect(calls).toHaveLength(2);
    // batch berhenti — status kembali queued untuk tick berikutnya
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("queued");

    // tick kedua: jendela menit sudah lewat (61s > 60s) → sisa terkirim
    const res2 = await processBroadcast({ now: new Date(now.getTime() + 61_000), fetchImpl });
    expect(res2).toMatchObject({ sent: 1, skipped: 0, stopped: "completed" });
    expect(calls).toHaveLength(3);
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("completed");
  });

  it("stops with minute-limit when deliveries in the last 60s reach maxPerMinute", async () => {
    await seedContact("u0@gmail.com");
    await seedContact("u1@gmail.com");
    const c = await seedCampaign({ maxPerMinute: 2, maxPerHour: 600 });
    await scheduleCampaign(c.id, { scheduledAt: null });
    const recips = await recipientsOf(c.id);
    const now = new Date();
    for (const r of recips) {
      await db.insert(emailDeliveries).values({
        contactId: r.contactId,
        campaignRecipientId: r.id,
        emailType: "broadcast",
        status: "accepted",
        sentAt: new Date(now.getTime() - 10_000),
      });
    }
    const res = await processBroadcast({ now, fetchImpl: makeFetch().fetchImpl });
    expect(res).toMatchObject({ campaignId: c.id, sent: 0, skipped: 0, stopped: "minute-limit" });
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("queued");
  });

  it("stops with hour-limit when deliveries in the last hour reach maxPerHour", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign({ maxPerMinute: 1, maxPerHour: 1 });
    await scheduleCampaign(c.id, { scheduledAt: null });
    const recips = await recipientsOf(c.id);
    const now = new Date();
    await db.insert(emailDeliveries).values({
      contactId: recips[0].contactId,
      campaignRecipientId: recips[0].id,
      emailType: "broadcast",
      status: "accepted",
      sentAt: new Date(now.getTime() - 30 * 60_000),
    });
    const res = await processBroadcast({ now, fetchImpl: makeFetch().fetchImpl });
    expect(res).toMatchObject({ campaignId: c.id, sent: 0, skipped: 0, stopped: "hour-limit" });
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("queued");
  });

  it("stops with day-limit when ALL deliveries today reach the provider daily cap", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign({ maxPerMinute: 60, maxPerHour: 600 });
    await scheduleCampaign(c.id, { scheduledAt: null });
    // 5 delivery hari ini dari campaign LAIN (global provider capacity)
    const contact = await seedContact("other@gmail.com");
    for (let i = 0; i < 5; i++) {
      await db.insert(emailDeliveries).values({
        contactId: contact.id,
        campaignRecipientId: null,
        emailType: "broadcast_test",
        status: "accepted",
        sentAt: new Date(),
        providerMessageId: `hist-${i}`,
      });
    }
    // cap dibaca worker saat proses — turunkan SETELAH schedule (validateLimits
    // saat schedule butuh default agar kampanye valid)
    setEnv({ EMAILIT_MAX_PER_DAY: "5" });
    const res = await processBroadcast({ fetchImpl: makeFetch().fetchImpl });
    expect(res).toMatchObject({ campaignId: c.id, sent: 0, skipped: 0, stopped: "day-limit" });
    expect((await getCampaignForBroadcast(c.id))?.status).toBe("queued");
  });
});

describe("processBroadcast — per-recipient failures", () => {
  it("continues after one provider failure: failed recipient + delivery error, others sent", async () => {
    await seedContact("good1@gmail.com");
    await seedContact("bad@gmail.com");
    await seedContact("good2@gmail.com");
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null });

    const { calls, fetchImpl } = makeFetch((body) =>
      body.to === "bad@gmail.com" ? { status: 500 } : { status: 200, id: `prov-${body.to}` },
    );

    const res = await processBroadcast({ now: new Date(), fetchImpl });
    expect(res).toMatchObject({ campaignId: c.id, sent: 2, skipped: 1, stopped: "completed" });
    expect(calls).toHaveLength(3);

    const recips = await recipientsOf(c.id);
    const byEmail = new Map<string, string>();
    for (const r of recips) {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
      byEmail.set(contact.emailNormalized, r.status);
    }
    expect(byEmail.get("bad@gmail.com")).toBe("failed");
    expect(byEmail.get("good1@gmail.com")).toBe("sent");
    expect(byEmail.get("good2@gmail.com")).toBe("sent");

    const failed = await db.select().from(emailDeliveries).where(eq(emailDeliveries.status, "failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain("Emailit 500");
    const accepted = await db.select().from(emailDeliveries).where(eq(emailDeliveries.status, "accepted"));
    expect(accepted.map((d) => d.providerMessageId)).toEqual(["prov-good1@gmail.com", "prov-good2@gmail.com"]);
  });

  it("marks a missing-render recipient failed without aborting the batch", async () => {
    await seedContact("u0@gmail.com");
    await seedContact("u1@gmail.com");
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null });
    const recips = await recipientsOf(c.id);
    await db
      .update(emailCampaignRecipients)
      .set({ lastRenderedHtml: null })
      .where(eq(emailCampaignRecipients.id, recips[0].id));

    setEnv({ MO_BROADCAST: "true" });
    const res = await processBroadcast();
    expect(res).toMatchObject({ campaignId: c.id, sent: 1, skipped: 1, stopped: "completed" });

    const [corrupted] = recips;
    const [after] = await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, corrupted.id));
    expect(after.status).toBe("failed");
    const failed = await db.select().from(emailDeliveries).where(eq(emailDeliveries.status, "failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("missing-render");
  });
});

describe("processBroadcast — single sending", () => {
  it("processes only the oldest queued campaign per tick", async () => {
    await seedContact("u0@gmail.com");
    const first = await seedCampaign({ subjectId: "pertama" });
    await scheduleCampaign(first.id, { scheduledAt: null });
    const second = await seedCampaign({ subjectId: "kedua" });
    await scheduleCampaign(second.id, { scheduledAt: null });

    // pastikan urutan deterministik
    await db
      .update(emailCampaigns)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(emailCampaigns.id, first.id));
    await db
      .update(emailCampaigns)
      .set({ createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z") })
      .where(eq(emailCampaigns.id, second.id));

    setEnv({ MO_BROADCAST: "true" });
    const res1 = await processBroadcast();
    expect(res1.campaignId).toBe(first.id);
    expect(res1.stopped).toBe("completed");
    expect((await getCampaignForBroadcast(second.id))?.status).toBe("queued");

    const res2 = await processBroadcast();
    expect(res2.campaignId).toBe(second.id);
    expect(res2.stopped).toBe("completed");
  });

  it("never picks a cancelled campaign", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null });
    await db.update(emailCampaigns).set({ status: "cancelled" }).where(eq(emailCampaigns.id, c.id));
    expect(await processBroadcast()).toEqual({ campaignId: null, sent: 0, skipped: 0, stopped: "idle" });
  });
});

describe("processBroadcast — snapshot render & subject vars", () => {
  it("sends the snapshot html with raw clickToken links and substitutes {{email}}/{{locale}} per recipient locale", async () => {
    await seedContact("iduser@gmail.com", "id");
    await seedContact("enuser@gmail.com", "en");
    const c = await seedCampaign({
      subjectId: "Halo {{email}}",
      subjectEn: "Hi {{email}} {{locale}}",
      bodyHtmlId: '<p>Hai <a href="https://a.b/x">satu</a></p>',
    });

    // snapshot manual SEBELUM schedule supaya token raw tertangkap
    const snap = await snapshotRecipients(c.id);
    await scheduleCampaign(c.id, { scheduledAt: null });
    expect(snap.recipients).toHaveLength(2);

    const tokenByEmail = new Map<string, string>();
    for (const r of snap.recipients) {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, r.contactId));
      tokenByEmail.set(contact.emailNormalized, r.clickToken);
    }

    const { calls, fetchImpl } = makeFetch();
    const res = await processBroadcast({ now: new Date(), fetchImpl });
    expect(res).toMatchObject({ sent: 2, skipped: 0, stopped: "completed" });
    expect(calls).toHaveLength(2);

    const byEmail = new Map(calls.map((call) => [call.to, call]));
    const idCall = byEmail.get("iduser@gmail.com")!;
    const enCall = byEmail.get("enuser@gmail.com")!;

    // subject: locale pick + substitusi variabel
    expect(idCall.subject).toBe("Halo iduser@gmail.com");
    expect(enCall.subject).toBe("Hi enuser@gmail.com en");

    // html = lastRenderedHtml snapshot: link click + unsubscribe token raw
    const [link] = await db.select().from(emailLinks).where(eq(emailLinks.campaignId, c.id));
    const idToken = tokenByEmail.get("iduser@gmail.com")!;
    expect(idCall.html).toContain(`/api/click/${link.id}/${idToken}`);
    expect(idCall.html).toContain(`/api/unsubscribe/${idToken}`);
    const enToken = tokenByEmail.get("enuser@gmail.com")!;
    expect(enCall.html).toContain(`/api/click/${link.id}/${enToken}`);
    expect(enCall.html).toContain(`/api/unsubscribe/${enToken}`);

    // idempotencyKey & from
    expect(idCall.idempotencyKey).toMatch(new RegExp(`^bc-${c.id}-`));
    expect(enCall.idempotencyKey).toMatch(new RegExp(`^bc-${c.id}-`));

    // delivery rows terhubung contact + recipient
    const deliveries = await db.select().from(emailDeliveries);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.contactId && d.campaignRecipientId && d.providerMessageId)).toBe(true);
  });

  it("sends id-locale subject when the recipient locale has no EN subject stored (fallback)", async () => {
    await seedContact("solo@gmail.com", "en"); // locale en tapi subject EN kosong
    const c = await seedCampaign({ subjectEn: null, subjectId: "Halo {{email}}" });
    await snapshotRecipients(c.id);
    await scheduleCampaign(c.id, { scheduledAt: null });

    const { calls, fetchImpl } = makeFetch();
    await processBroadcast({ now: new Date(), fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toBe("Halo solo@gmail.com");
  });
});

describe("processBroadcast — text part", () => {
  it("derives the plain-text part from the snapshot html", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign({
      bodyHtmlId: '<p>Hai <a href="https://a.b/x">satu</a> &amp; dua</p>',
    });
    await scheduleCampaign(c.id, { scheduledAt: null });

    const { calls, fetchImpl } = makeFetch();
    await processBroadcast({ now: new Date(), fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("Hai satu & dua");
    // footer layout: anchor text unsubscribe tetap ada (href attribute hilang saat strip tag)
    expect(calls[0].text).toContain("Berhenti berlangganan");
    expect(calls[0].text).not.toContain("<p>");
  });
});

// guard: ekspor helper yang dipakai worker tidak merusak render
describe("worker module contract", () => {
  it("does not touch email_outbox (broadcast path is independent)", async () => {
    await seedContact("u0@gmail.com");
    const c = await seedCampaign();
    await scheduleCampaign(c.id, { scheduledAt: null });
    setEnv({ MO_BROADCAST: "true" });
    await processBroadcast();
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(emailOutbox);
    expect(rows[0].n).toBe(0);
  });
});
