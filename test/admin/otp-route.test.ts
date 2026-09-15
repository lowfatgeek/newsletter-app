import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../src/pages/admin/api/otp";
import { db } from "../../src/lib/db";
import { adminOtpChallenges } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

async function post(body: unknown): Promise<Response> {
  return POST({
    request: new Request("http://localhost:4321/admin/api/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
    },
  } as never);
}

describe("POST /admin/api/otp — malformed challengeId", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_EMAILIT: "true" });
  });

  it("non-UUID challengeId → 401 generic tanpa menyentuh DB (tidak 500)", async () => {
    const res = await post({ challengeId: "bukan-uuid'", code: "123456", trustDevice: true });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("challengeId UUID tapi tidak ada di DB → 401 generic", async () => {
    const res = await post({
      challengeId: "00000000-0000-4000-8000-000000000000",
      code: "123456",
      trustDevice: false,
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("body tanpa challengeId/code → 400 invalid", async () => {
    const res = await post({ challengeId: "", code: "" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("tidak meninggalkan baris challenge tersentuh", async () => {
    await post({ challengeId: "xxx", code: "000000" });
    expect(await db.select().from(adminOtpChallenges)).toHaveLength(0);
  });
});
