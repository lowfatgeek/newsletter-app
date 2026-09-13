import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminOtpChallenges, adminUsers } from "../schema";
import { assertPasswordStrength, hashPassword, verifyPassword } from "./password";
import { issueOtpChallenge, verifyOtpChallenge } from "./otp";
import { createAdminSession, revokeAllSessions } from "./sessions";
import { mintTrustedDevice, revokeAllDevices } from "./devices";
import { audit } from "./audit";
import { consumeRateLimit, hashIp } from "../ratelimit";

const LOGIN_ATTEMPTS_PER_HOUR = 10;

export type StartLoginResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: "invalid" | "rate-limited" };

export type CompleteLoginResult =
  | { ok: true; session: { raw: string }; device?: { raw: string } }
  | { ok: false; reason: string };

export async function startLogin(input: { email: string; password: string; ip: string }): Promise<StartLoginResult> {
  const email = input.email.trim().toLowerCase();
  // Rate limit BEFORE any credential check, per IP and per email.
  if (!(await consumeRateLimit("admin-login-ip", hashIp(input.ip), LOGIN_ATTEMPTS_PER_HOUR))
    || !(await consumeRateLimit("admin-login-email", email, LOGIN_ATTEMPTS_PER_HOUR))) {
    return { ok: false, reason: "rate-limited" };
  }
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  const valid = user !== undefined && (await verifyPassword(user.passwordHash, input.password));
  if (!user || !valid) {
    // Generic reason — never reveal whether the email exists.
    await audit("login_failed", { adminUserId: user?.id, detail: { email }, ip: input.ip });
    return { ok: false, reason: "invalid" };
  }
  const challengeId = await issueOtpChallenge(user.id, user.email);
  await audit("password_ok", { adminUserId: user.id, ip: input.ip });
  return { ok: true, challengeId };
}

export async function completeLogin(input: {
  challengeId: string; code: string; trustDevice: boolean; ip: string; userAgent?: string;
}): Promise<CompleteLoginResult> {
  const otp = await verifyOtpChallenge(input.challengeId, input.code);
  if (!otp.ok) {
    await audit("otp_failed", {
      detail: { challengeId: input.challengeId, reason: otp.reason },
      ip: input.ip,
    });
    return { ok: false, reason: otp.reason };
  }
  const [ch] = await db.select().from(adminOtpChallenges).where(eq(adminOtpChallenges.id, input.challengeId));
  if (!ch) return { ok: false, reason: "invalid" };
  await revokeAllSessions(ch.adminUserId); // rotasi sesi saat login
  const session = await createAdminSession(ch.adminUserId);
  let device: { raw: string } | undefined;
  if (input.trustDevice) {
    const d = await mintTrustedDevice(ch.adminUserId, input.userAgent);
    device = { raw: d.raw };
    await audit("device_trusted", { adminUserId: ch.adminUserId, ip: input.ip });
  }
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, ch.adminUserId));
  await audit("login_success", { adminUserId: ch.adminUserId, ip: input.ip });
  return { ok: true, session, device };
}

export async function changePassword(adminUserId: string, newPassword: string): Promise<void> {
  assertPasswordStrength(newPassword);
  await db.update(adminUsers).set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(adminUsers.id, adminUserId));
  await revokeAllSessions(adminUserId);
  await revokeAllDevices(adminUserId);
  await audit("password_changed", { adminUserId });
}
