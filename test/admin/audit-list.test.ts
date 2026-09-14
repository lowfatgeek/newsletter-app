import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminUsers } from "../../src/lib/schema";
import { audit, listAuditEvents } from "../../src/lib/admin/audit";
import { resetDb } from "../helpers";

describe("listAuditEvents", () => {
  beforeEach(resetDb);

  it("membaca baris via audit() + total benar + join email admin", async () => {
    const [admin] = await db
      .insert(adminUsers)
      .values({ email: "ops@gmail.com", passwordHash: "x" })
      .returning();
    await audit("login_ok", { adminUserId: admin.id, detail: { a: 1 }, ip: "9.9.9.9" });
    await audit("campaign_publish", { detail: { slug: "hadiah" } });

    const { rows, total } = await listAuditEvents({ limit: 50, offset: 0 });
    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    // Urutan terbaru dulu.
    expect(rows[0].action).toBe("campaign_publish");
    expect(rows[0].adminEmail).toBeNull();
    expect(rows[1].action).toBe("login_ok");
    expect(rows[1].adminEmail).toBe("ops@gmail.com");
    expect(rows[1].detail).toEqual({ a: 1 });
    expect(rows[1].ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pagination limit/offset + clamp limit", async () => {
    await audit("e1");
    await audit("e2");
    await audit("e3");

    const first = await listAuditEvents({ limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.rows.map((r) => r.action)).toEqual(["e3", "e2"]);

    const second = await listAuditEvents({ limit: 2, offset: 2 });
    expect(second.rows.map((r) => r.action)).toEqual(["e1"]);

    const clamped = await listAuditEvents({ limit: 500, offset: 0 });
    expect(clamped.rows).toHaveLength(3);
  });
});
