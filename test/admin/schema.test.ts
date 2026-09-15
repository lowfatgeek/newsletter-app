import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import {
  adminAuditLog,
  adminOtpChallenges,
  adminSessions,
  adminUsers,
  campaignRedirects,
  rewardCampaigns,
  trustedDevices,
} from "../../src/lib/schema";
import { resetDb } from "../helpers";

describe("admin schema", () => {
  beforeEach(resetDb);
  it("creates admin user and related rows", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "kelaswfa@gmail.com", passwordHash: "h" }).returning();
    const [s] = await db
      .insert(adminSessions)
      .values({ tokenHash: "t1", adminUserId: u.id, expiresAt: new Date(Date.now() + 1000) })
      .returning();
    const [c] = await db
      .insert(adminOtpChallenges)
      .values({ adminUserId: u.id, codeHash: "c", expiresAt: new Date() })
      .returning();
    const [d] = await db
      .insert(trustedDevices)
      .values({ adminUserId: u.id, tokenHash: "d1", expiresAt: new Date() })
      .returning();
    const [a] = await db.insert(adminAuditLog).values({ action: "test", adminUserId: u.id }).returning();
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "x" }).returning();
    const [r] = await db.insert(campaignRedirects).values({ campaignId: camp.id, oldSlug: "old" }).returning();
    expect(s.adminUserId).toBe(u.id);
    expect(c.attempts).toBe(0);
    expect(d.revokedAt).toBeNull();
    expect(a.detail).toEqual({});
    expect(r.oldSlug).toBe("old");
  });
  it("rejects duplicate email and duplicate tokenHash", async () => {
    await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" });
    await expect(db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" })).rejects.toThrow();
  });
});
