import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { adminSessions, adminUsers } from "../../src/lib/schema";
import {
  createAdminSession,
  resolveSession,
  revokeSession,
  revokeAllSessions,
} from "../../src/lib/admin/sessions";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("admin sessions", () => {
  beforeEach(resetDb);

  it("create → resolve round-trip", async () => {
    const u = await seedAdmin();
    const s = await createAdminSession(u.id);
    const admin = await resolveSession(s.raw);
    expect(admin?.id).toBe(u.id);
    expect(admin?.email).toBe("a@gmail.com");
  });

  it("expired session resolves null", async () => {
    const u = await seedAdmin();
    const s = await createAdminSession(u.id);
    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminSessions.id, s.id));
    expect(await resolveSession(s.raw)).toBeNull();
  });

  it("revoked single and revoke-all", async () => {
    const u = await seedAdmin();
    const s1 = await createAdminSession(u.id);
    const s2 = await createAdminSession(u.id);
    await revokeSession(s1.raw);
    expect(await resolveSession(s1.raw)).toBeNull();
    expect(await resolveSession(s2.raw)).not.toBeNull();
    await revokeAllSessions(u.id);
    expect(await resolveSession(s2.raw)).toBeNull();
  });

  it("garbage resolves null", async () => {
    expect(await resolveSession("nope")).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });
});
