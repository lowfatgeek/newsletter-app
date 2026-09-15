import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  contacts, emailDeliveries, emailProviderEvents, emailSuppressions,
} from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";
import { verifyEmailitSignature, processEmailitEvent } from "../../src/lib/broadcast/webhooks";
import { POST, GET } from "../../src/pages/api/webhooks/emailit";

/**
 * Webhook Emailit (Task 9).
 *
 * Kontrak:
 * - Signature: HMAC-SHA256 hex dari RAW body dengan EMAILIT_WEBHOOK_SECRET,
 *   dibandingkan timing-safe.
 * - Event idempoten: unique (provider_message_id, event_type) — redelivery
 *   → "ignored", tidak menambah baris kedua.
 * - Event tetap tersimpan untuk audit walau message_id tidak dikenal
 *   ("unknown-message").
 * - Hard bounce / complaint → suppression (email dari recipient_email,
 *   dinormalisasi; email invalid → tanpa suppression, tanpa crash).
 */

const SECRET = "whsec-test-123";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function seedDelivery(providerMessageId: string, status = "accepted") {
  const [c] = await db.insert(contacts).values({
    emailNormalized: "bouncer@gmail.com", locale: "id", confirmationStatus: "confirmed",
  }).returning();
  const [d] = await db.insert(emailDeliveries).values({
    contactId: c.id, emailType: "broadcast", status, providerMessageId,
  }).returning();
  return d;
}

async function eventCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(emailProviderEvents);
  return row.n;
}

beforeEach(() => {
  setEnv({ EMAILIT_WEBHOOK_SECRET: SECRET });
  return resetDb();
});

describe("verifyEmailitSignature", () => {
  const body = '{"type":"email.delivered"}';

  it("valid signature → true", () => {
    expect(verifyEmailitSignature(body, sign(body))).toBe(true);
  });

  it("wrong signature → false", () => {
    expect(verifyEmailitSignature(body, sign("body-lain"))).toBe(false);
  });

  it("tampered body → false", () => {
    expect(verifyEmailitSignature(body + " ", sign(body))).toBe(false);
  });

  it("missing signature header (null) → false", () => {
    expect(verifyEmailitSignature(body, null)).toBe(false);
  });

  it("wrong secret → false", () => {
    expect(verifyEmailitSignature(body, sign(body, "secret-lain"))).toBe(false);
  });
});

describe("processEmailitEvent", () => {
  it("email.delivered → delivery updated (status + deliveredAt), event row saved, 'recorded'", async () => {
    const d = await seedDelivery("prov-1");

    const result = await processEmailitEvent({
      type: "email.delivered", message_id: "prov-1", recipient_email: "bouncer@gmail.com",
      raw: { type: "email.delivered", message_id: "prov-1" },
    });

    expect(result).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("delivered");
    expect(after.deliveredAt).not.toBeNull();
    expect(after.bouncedAt).toBeNull();
    expect(await eventCount()).toBe(1);
  });

  it("duplicate redelivery of the same event → 'ignored', still exactly 1 event row", async () => {
    await seedDelivery("prov-1");
    const event = {
      type: "email.delivered", message_id: "prov-1",
      raw: { type: "email.delivered", message_id: "prov-1" },
    };

    expect(await processEmailitEvent(event)).toBe("recorded");
    expect(await processEmailitEvent(event)).toBe("ignored");
    expect(await eventCount()).toBe(1);
  });

  it("same message_id but different event type → both rows saved (unique is per-type)", async () => {
    await seedDelivery("prov-1");
    expect(await processEmailitEvent({ type: "email.delivered", message_id: "prov-1", raw: {} })).toBe("recorded");
    expect(await processEmailitEvent({ type: "email.sent", message_id: "prov-1", raw: {} })).toBe("recorded");
    expect(await eventCount()).toBe(2);
  });

  it("email.bounced (hard) → delivery bounced + bouncedAt + suppression hard_bounce", async () => {
    const d = await seedDelivery("prov-b");

    const result = await processEmailitEvent({
      type: "email.bounced", message_id: "prov-b", recipient_email: "  Bouncer@Gmail.com ",
      raw: { type: "email.bounced", message_id: "prov-b" },
    });

    expect(result).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("bounced");
    expect(after.bouncedAt).not.toBeNull();

    const sup = await db.select().from(emailSuppressions);
    expect(sup).toHaveLength(1);
    expect(sup[0]).toMatchObject({ emailNormalized: "bouncer@gmail.com", reason: "hard_bounce" });
  });

  it("email.bounced with invalid recipient_email → bounced delivery, NO suppression row, no crash", async () => {
    const d = await seedDelivery("prov-b2");

    const result = await processEmailitEvent({
      type: "email.bounced", message_id: "prov-b2", recipient_email: "bukan-email",
      raw: { type: "email.bounced" },
    });

    expect(result).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("bounced");
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  });

  it("email.complaint → delivery suppressed + suppression reason complaint", async () => {
    const d = await seedDelivery("prov-c");

    const result = await processEmailitEvent({
      type: "email.complaint", message_id: "prov-c", recipient_email: "bouncer@gmail.com",
      raw: { type: "email.complaint", message_id: "prov-c" },
    });

    expect(result).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("suppressed");
    const sup = await db.select().from(emailSuppressions);
    expect(sup[0]).toMatchObject({ emailNormalized: "bouncer@gmail.com", reason: "complaint" });
  });

  it("email.failed → delivery status failed", async () => {
    const d = await seedDelivery("prov-f");

    expect(await processEmailitEvent({ type: "email.failed", message_id: "prov-f", raw: {} })).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("failed");
  });

  it("unknown event type → event saved, 'recorded', delivery untouched", async () => {
    const d = await seedDelivery("prov-u");

    expect(await processEmailitEvent({ type: "email.opened", message_id: "prov-u", raw: { opens: 1 } })).toBe("recorded");
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("accepted");
    expect(after.deliveredAt).toBeNull();
    expect(await eventCount()).toBe(1);
  });

  it("unknown message_id → 'unknown-message' but event row still saved (audit)", async () => {
    const result = await processEmailitEvent({
      type: "email.delivered", message_id: "no-such-message", raw: { type: "email.delivered" },
    });

    expect(result).toBe("unknown-message");
    expect(await eventCount()).toBe(1);
    expect(await db.select().from(emailDeliveries)).toHaveLength(0);
  });

  it("missing message_id → 'unknown-message', event saved under 'no-message-id'", async () => {
    const result = await processEmailitEvent({ type: "email.delivered", raw: { type: "email.delivered" } });

    expect(result).toBe("unknown-message");
    const rows = await db.select().from(emailProviderEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].providerMessageId).toBe("no-message-id");
  });

  it("does not downgrade terminal status: delivered delivery stays delivered on email.failed", async () => {
    const d = await seedDelivery("prov-term", "delivered");

    await processEmailitEvent({ type: "email.failed", message_id: "prov-term", raw: {} });
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.status).toBe("delivered");
  });

  it("does not set deliveredAt twice (coalesce semantics)", async () => {
    const first = new Date("2026-09-01T00:00:00Z");
    const d = await seedDelivery("prov-twice");
    await db.update(emailDeliveries)
      .set({ status: "delivered", deliveredAt: first })
      .where(eq(emailDeliveries.id, d.id));

    // redelivery dengan jenis event BARU (bukan duplicate) — deliveredAt tidak berubah
    await processEmailitEvent({
      type: "email.delivered", message_id: "prov-twice",
      raw: { note: "late duplicate via new event type" },
    });
    const [after] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, d.id));
    expect(after.deliveredAt?.toISOString()).toBe(first.toISOString());
  });
});

describe("POST /api/webhooks/emailit", () => {
  async function post(body: string, signature: string | null): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (signature !== null) headers["x-emailit-signature"] = signature;
    return POST({
      request: new Request("http://localhost:4321/api/webhooks/emailit", {
        method: "POST", headers, body,
      }),
      cookies: { get: () => undefined, set: () => {}, delete: () => {}, has: () => false },
    } as never);
  }

  it("valid signature + JSON → 200 {result} with Cache-Control no-store", async () => {
    await seedDelivery("prov-route");
    const body = JSON.stringify({ type: "email.delivered", message_id: "prov-route" });

    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ result: "recorded" });
    expect(await eventCount()).toBe(1);
  });

  it("missing/invalid signature → 401, event NOT saved", async () => {
    const res = await post("{}", null);
    expect(res.status).toBe(401);
    expect(await eventCount()).toBe(0);
  });

  it("signature over different body → 401", async () => {
    const res = await post("{}", sign("lain"));
    expect(res.status).toBe(401);
  });

  it("valid signature but invalid JSON → 400", async () => {
    const body = "{bukan-json";
    const res = await post(body, sign(body));
    expect(res.status).toBe(400);
  });

  it("GET → 405", async () => {
    const res = await GET({ request: new Request("http://localhost/api/webhooks/emailit") } as never);
    expect(res.status).toBe(405);
  });
});
