import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/lib/db";
import { emailOutbox } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { enqueueTransactionalEmail, processOutbox } from "../src/lib/mailworker-for-test";
import { resetDb, setEnv } from "./helpers";

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
}
function failFetch() {
  return vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
}

describe("outbox", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_EMAILIT: "false", EMAILIT_API_KEY: "k" }); });

  it("enqueue is idempotent by key", async () => {
    const msg = { emailType: "confirmation", to: "a@b.com", subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "k1" };
    await enqueueTransactionalEmail(msg);
    await enqueueTransactionalEmail(msg);
    const rows = await db.select().from(emailOutbox);
    expect(rows).toHaveLength(1);
  });

  it("processOutbox sends pending email and marks sent", async () => {
    const f = okFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k2" });
    const r = await processOutbox({ fetchImpl: f as any });
    expect(r).toEqual({ sent: 1, failed: 0 });
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k2"));
    expect(row.status).toBe("sent");
    expect(f.mock.calls[0][0]).toBe("https://api.emailit.com/v1/emails");
  });

  it("failed send retries with backoff, then fails permanently", async () => {
    const f = failFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k3" });
    // attempts 1-4: backoff; force scheduledAt back to now() before each retry so the test is deterministic
    for (let i = 0; i < 4; i++) {
      await db.update(emailOutbox).set({ scheduledAt: new Date() }).where(eq(emailOutbox.idempotencyKey, "k3"));
      const r = await processOutbox({ fetchImpl: f as any });
      expect(r.sent).toBe(0);
      expect(r.failed).toBe(0); // backoff: belum gagal permanen
    }
    // tanpa memaksa scheduledAt, worker tidak mengambil baris (backoff dihormati)
    const skipped = await processOutbox({ fetchImpl: f as any });
    expect(skipped).toEqual({ sent: 0, failed: 0 });
    // attempt ke-5: gagal permanen
    await db.update(emailOutbox).set({ scheduledAt: new Date() }).where(eq(emailOutbox.idempotencyKey, "k3"));
    const r5 = await processOutbox({ fetchImpl: f as any });
    expect(r5.failed).toBe(1);
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k3"));
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
  });

  it("MOCK_EMAILIT marks sent without calling provider", async () => {
    setEnv({ MOCK_EMAILIT: "true" });
    const f = okFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k4" });
    const r = await processOutbox({ fetchImpl: f as any });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});
