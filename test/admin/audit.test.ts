import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminAuditLog } from "../../src/lib/schema";
import { audit } from "../../src/lib/admin/audit";
import { resetDb } from "../helpers";

describe("audit", () => {
  beforeEach(resetDb);

  it("writes action with detail and hashed ip", async () => {
    await audit("login_failed", { detail: { email: "a@gmail.com" }, ip: "1.2.3.4" });
    const rows = await db.select().from(adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("login_failed");
    expect(rows[0].detail).toEqual({ email: "a@gmail.com" });
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].ipHash).not.toContain("1.2.3.4");
  });

  it("writes minimal row without opts", async () => {
    await audit("logout");
    const rows = await db.select().from(adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("logout");
    expect(rows[0].adminUserId).toBeNull();
    expect(rows[0].detail).toEqual({});
    expect(rows[0].ipHash).toBeNull();
  });
});
