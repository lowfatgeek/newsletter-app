import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { changePassword, completeLogin, startLogin } from "../../src/lib/admin/login";
import { hashPassword } from "../../src/lib/admin/password";
import { resolveSession } from "../../src/lib/admin/sessions";
import { db } from "../../src/lib/db";
import { adminAuditLog, adminUsers, emailOutbox, trustedDevices } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

async function seedAdmin() {
  const [u] = await db
    .insert(adminUsers)
    .values({
      email: "kelaswfa@gmail.com",
      passwordHash: await hashPassword("GoodPassword123"),
    })
    .returning();
  return u;
}

describe("login flow", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_EMAILIT: "true" });
  });

  it("startLogin wrong password → generic invalid + audit", async () => {
    const u = await seedAdmin();
    expect(await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    const logs = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "login_failed"));
    expect(logs).toHaveLength(1);
  });
  it("startLogin unknown email → generic invalid (no email sent)", async () => {
    expect(await startLogin({ email: "nope@gmail.com", password: "Whatever123", ip: "1.1.1.1" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
  it("full login: password → otp → session; trust device optional", async () => {
    const u = await seedAdmin();
    const start = await startLogin({ email: u.email, password: "GoodPassword123", ip: "1.1.1.1" });
    expect(start.ok).toBe(true);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.emailType, "otp_admin"));
    const code = mail.text.match(/\d{6}/)![0];
    const done = await completeLogin({
      challengeId: (start as any).challengeId,
      code,
      trustDevice: true,
      ip: "1.1.1.1",
    });
    expect(done.ok).toBe(true);
    const session = await resolveSession((done as any).session.raw);
    expect(session?.email).toBe(u.email);
    const devices = await db.select().from(trustedDevices);
    expect(devices).toHaveLength(1);
    expect(await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "login_success"))).toHaveLength(1);
  });
  it("rate limit: 11th attempt blocked", async () => {
    const u = await seedAdmin();
    for (let i = 0; i < 10; i++) {
      await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" });
    }
    expect(await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" })).toEqual({
      ok: false,
      reason: "rate-limited",
    });
  });
  it("changePassword revokes sessions and devices", async () => {
    const u = await seedAdmin();
    const start = await startLogin({ email: u.email, password: "GoodPassword123", ip: "1.1.1.1" });
    const [mail] = await db.select().from(emailOutbox);
    const done = await completeLogin({
      challengeId: (start as any).challengeId,
      code: mail.text.match(/\d{6}/)![0],
      trustDevice: true,
      ip: "1.1.1.1",
    });
    await changePassword(u.id, "NewPassword456");
    expect(await resolveSession((done as any).session.raw)).toBeNull();
    // revokeAllDevices marks rows revoked (not deleted) — assert no active device remains
    expect(
      await db
        .select()
        .from(trustedDevices)
        .where(and(eq(trustedDevices.adminUserId, u.id), isNull(trustedDevices.revokedAt))),
    ).toHaveLength(0);
  });
});
