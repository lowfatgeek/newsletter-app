import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminOtpChallenges, adminUsers } from "../schema";
import { assertPasswordStrength, hashPassword, verifyPassword } from "./password";
import { issueOtpChallenge, verifyOtpChallenge } from "./otp";
import { createAdminSession, revokeAllSessions } from "./sessions";
import { mintTrustedDevice, revokeAllDevices } from "./devices";
import { audit } from "./audit";
import { consumeRateLimit, hashIp } from "../ratelimit";
import { env } from "../env";

const LOGIN_ATTEMPTS_PER_HOUR = 10;
const RESET_ATTEMPTS_PER_HOUR = 5;

// challengeId adalah uuid — tolak bentuk lain sebelum menyentuh DB supaya
// input sampah tidak memicu error tipe Postgres (500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export type RequestPasswordResetResult = { ok: true; challengeId?: string };

export type CompletePasswordResetResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "too-many-attempts" | "weak-password" };

/**
 * Permintaan reset password. Hanya email === ADMIN_EMAIL yang diproses
 * (user admin dibuat bila belum ada); email lain tetap mendapat { ok: true }
 * generik tanpa efek apa pun — mencegah user enumeration. Rate limit per IP
 * dan per email diterapkan sebelum pengecekan mana pun.
 */
export async function requestPasswordReset(email: string, ip: string): Promise<RequestPasswordResetResult> {
  const normalized = email.trim().toLowerCase();
  if (!(await consumeRateLimit("admin-reset-ip", hashIp(ip), RESET_ATTEMPTS_PER_HOUR))
    || !(await consumeRateLimit("admin-reset-email", normalized, RESET_ATTEMPTS_PER_HOUR))) {
    return { ok: true }; // generik — jangan bocorkan pembatasan
  }
  const adminEmail = env("ADMIN_EMAIL", "kelaswfa@gmail.com").toLowerCase();
  if (normalized !== adminEmail) return { ok: true }; // tanpa efek, tanpa email

  let [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, adminEmail));
  if (!user) {
    // Admin belum ada (bootstrap belum jalan) — buat dengan password acak
    // yang tidak diketahui siapa pun; pemilik email men-set password via OTP.
    const [created] = await db.insert(adminUsers)
      .values({ email: adminEmail, passwordHash: await hashPassword(randomBytes(24).toString("base64url")) })
      .onConflictDoNothing({ target: adminUsers.email })
      .returning();
    if (created) {
      user = created;
    } else {
      [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, adminEmail));
    }
  }
  if (!user) return { ok: true };

  const challengeId = await issueOtpChallenge(user.id, user.email);
  await audit("password_reset_requested", { adminUserId: user.id, detail: { email: adminEmail }, ip });
  // challengeId ikut dikembalikan agar halaman reset bisa lanjut ke langkah
  // konfirmasi. Email lain tidak pernah menerima challengeId (tanpa efek).
  return { ok: true, challengeId };
}

/**
 * Konfirmasi reset password: verifikasi OTP → changePassword (mencabut semua
 * sesi dan perangkat tepercaya) → audit. Password lemah ditolak tanpa
 * mengubah apa pun.
 */
export async function completePasswordReset(
  challengeId: string,
  code: string,
  newPassword: string,
): Promise<CompletePasswordResetResult> {
  if (!UUID_RE.test(challengeId)) return { ok: false, reason: "invalid" };
  const otp = await verifyOtpChallenge(challengeId, code);
  if (!otp.ok) {
    await audit("otp_failed", {
      detail: { challengeId, reason: otp.reason, context: "password_reset" },
    });
    return { ok: false, reason: otp.reason };
  }
  const [ch] = await db.select().from(adminOtpChallenges).where(eq(adminOtpChallenges.id, challengeId));
  if (!ch) return { ok: false, reason: "invalid" };
  try {
    await changePassword(ch.adminUserId, newPassword);
  } catch {
    return { ok: false, reason: "weak-password" };
  }
  await audit("password_reset_completed", { adminUserId: ch.adminUserId });
  return { ok: true };
}
