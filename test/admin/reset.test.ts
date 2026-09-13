import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../src/lib/db";
import {
  adminAuditLog,
  adminOtpChallenges,
  adminUsers,
  emailOutbox,
  trustedDevices,
} from "../../src/lib/schema";
import { hashPassword } from "../../src/lib/admin/password";
import { requestPasswordReset, completePasswordReset } from "../../src/lib/admin/login";
import { startLogin, completeLogin } from "../../src/lib/admin/login";
import { resolveSession } from "../../src/lib/admin/sessions";
import { resetDb, setEnv } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({
    email: "kelaswfa@gmail.com", passwordHash: await hashPassword("GoodPassword123"),
  }).returning();
  return u;
}

async function readCode(challengeId: string): Promise<string> {
  // idempotencyKey OTP = `otp-<challengeId>` — pilih email milik challenge ini.
  const [mail] = await db.select().from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `otp-${challengeId}`));
  expect(mail).toBeDefined();
  return mail.text.match(/\d{6}/)![0];
}

describe("password reset via OTP", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_EMAILIT: "true" }); });

  it("full flow: request → otp email → confirm updates hash and revokes sessions/devices", async () => {
    const u = await seedAdmin();

    // Buat sesi + perangkat tepercaya yang harus dicabut setelah reset.
    const start = await startLogin({ email: u.email, password: "GoodPassword123", ip: "1.1.1.1" });
    const [loginMail] = await db.select().from(emailOutbox).where(eq(emailOutbox.emailType, "otp_admin"));
    const done = await completeLogin({
      challengeId: (start as { challengeId: string }).challengeId,
      code: loginMail.text.match(/\d{6}/)![0],
      trustDevice: true, ip: "1.1.1.1",
    });
    expect(done.ok).toBe(true);

    const req = await requestPasswordReset("kelaswfa@gmail.com", "2.2.2.2");
    expect(req.ok).toBe(true);
    const challengeId = (req as { challengeId?: string }).challengeId;
    expect(challengeId).toBeDefined();
    const [challenge] = await db.select().from(adminOtpChallenges)
      .where(and(eq(adminOtpChallenges.adminUserId, u.id), isNull(adminOtpChallenges.consumedAt)));
    expect(challenge.id).toBe(challengeId);
    const code = await readCode(challenge.id);

    const confirm = await completePasswordReset(challenge.id, code, "BrandNewPassword99");
    expect(confirm).toEqual({ ok: true });

    const [updated] = await db.select().from(adminUsers).where(eq(adminUsers.id, u.id));
    expect(await import("../../src/lib/admin/password").then((m) => m.verifyPassword(updated.passwordHash, "BrandNewPassword99"))).toBe(true);
    // Sesi lama dicabut, perangkat tepercaya dicabut.
    expect(await resolveSession((done as { session: { raw: string } }).session.raw)).toBeNull();
    expect(await db.select().from(trustedDevices)
      .where(and(eq(trustedDevices.adminUserId, u.id), isNull(trustedDevices.revokedAt)))).toHaveLength(0);
    const audits = await db.select().from(adminAuditLog);
    expect(audits.some((a) => a.action === "password_reset_requested")).toBe(true);
    expect(audits.some((a) => a.action === "password_reset_completed")).toBe(true);

    // Login dengan password lama gagal, password baru berhasil.
    expect(await startLogin({ email: u.email, password: "GoodPassword123", ip: "3.3.3.3" }))
      .toEqual({ ok: false, reason: "invalid" });
    const ok2 = await startLogin({ email: u.email, password: "BrandNewPassword99", ip: "3.3.3.3" });
    expect(ok2.ok).toBe(true);
  });

  it("wrong email: ok generically, no outbox row, no user created", async () => {
    const req = await requestPasswordReset("attacker@gmail.com", "2.2.2.2");
    expect(req).toEqual({ ok: true });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it("unknown ADMIN_EMAIL: creates the admin user and sends OTP", async () => {
    const req = await requestPasswordReset("kelaswfa@gmail.com", "2.2.2.2");
    expect((req as { challengeId?: string }).challengeId).toBeDefined();
    const [u] = await db.select().from(adminUsers).where(eq(adminUsers.email, "kelaswfa@gmail.com"));
    expect(u).toBeDefined();
    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0].emailType).toBe("otp_admin");
  });

  it("confirm rejects wrong code", async () => {
    const u = await seedAdmin();
    await requestPasswordReset(u.email, "2.2.2.2");
    const [challenge] = await db.select().from(adminOtpChallenges)
      .where(eq(adminOtpChallenges.adminUserId, u.id));
    const r = await completePasswordReset(challenge.id, "000000", "BrandNewPassword99");
    expect(r.ok).toBe(false);
  });

  it("confirm rejects weak password", async () => {
    const u = await seedAdmin();
    await requestPasswordReset(u.email, "2.2.2.2");
    const [challenge] = await db.select().from(adminOtpChallenges)
      .where(eq(adminOtpChallenges.adminUserId, u.id));
    const code = await readCode(challenge.id);
    const r = await completePasswordReset(challenge.id, code, "short");
    expect(r).toEqual({ ok: false, reason: "weak-password" });
  });
});

describe("completePasswordReset input guards", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_EMAILIT: "true" }); });

  it("malformed challengeId → invalid without touching DB", async () => {
    const r = await completePasswordReset("garbage-not-a-uuid", "123456", "BrandNewPassword99");
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});
