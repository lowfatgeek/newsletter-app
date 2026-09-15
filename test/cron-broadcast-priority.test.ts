import { describe, it, expect, vi } from "vitest";

/**
 * Task 1.7 (04-N3): tick cron broadcast WAJIB menuntaskan drain outbox
 * transaksional sebelum worker broadcast mengambil batch berikutnya
 * (kriteria penerimaan PRD §12).
 *
 * Digambarkan dengan mock kedua modul agar urutan pemanggilan terlihat
 * deterministik tanpa menyentuh DB/provider.
 */
const callOrder: string[] = [];

vi.mock("../src/lib/mailworker", () => ({
  processOutbox: vi.fn(async () => {
    callOrder.push("outbox");
    return { sent: 0, failed: 0 };
  }),
}));

vi.mock("../src/lib/broadcast/worker", () => ({
  processBroadcast: vi.fn(async () => {
    callOrder.push("broadcast");
    return { campaignId: null, sent: 0, skipped: 0, stopped: "idle" };
  }),
}));

function cronRequest(): Request {
  return new Request("http://localhost/api/cron/broadcast", {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
}

describe("GET /api/cron/broadcast — transactional priority", () => {
  it("drains transactional outbox BEFORE the broadcast worker", async () => {
    const { GET } = await import("../src/pages/api/cron/broadcast");
    callOrder.length = 0;
    const res = await GET({ request: cronRequest() } as never);
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["outbox", "broadcast"]);
    const body = await res.json();
    expect(body).toMatchObject({ stopped: "idle", outbox: { sent: 0, failed: 0 } });
  });

  it("rejects unauthorized callers before doing any work", async () => {
    const { GET } = await import("../src/pages/api/cron/broadcast");
    callOrder.length = 0;
    const req = new Request("http://localhost/api/cron/broadcast", {
      headers: { "x-cron-secret": "wrong-secret" },
    });
    const res = await GET({ request: req } as never);
    expect(res.status).toBe(401);
    expect(callOrder).toEqual([]);
  });
});
