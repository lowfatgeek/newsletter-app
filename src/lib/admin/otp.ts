import { randomInt } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { hashToken } from "../crypto";
import { db } from "../db";
import { enqueueTransactionalEmail } from "../outbox";
import { adminOtpChallenges } from "../schema";
import { otpEmail } from "../templates";

const TEN_MIN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export type OtpVerifyResult = { ok: true } | { ok: false; reason: "invalid" | "expired" | "too-many-attempts" };

export async function issueOtpChallenge(adminUserId: string, email: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [row] = await db
    .insert(adminOtpChallenges)
    .values({ adminUserId, codeHash: hashToken(code), expiresAt: new Date(Date.now() + TEN_MIN_MS) })
    .returning();
  const m = otpEmail(code);
  await enqueueTransactionalEmail({
    emailType: "otp_admin",
    to: email,
    ...m,
    idempotencyKey: `otp-${row.id}`,
  });
  // cheap housekeeping: drop this admin's long-expired challenges
  await db
    .delete(adminOtpChallenges)
    .where(and(eq(adminOtpChallenges.adminUserId, adminUserId), lt(adminOtpChallenges.expiresAt, new Date())));
  // Best-effort fast drain (task 1.7): jangan tunggu tick cron berikutnya untuk
  // email OTP login admin.
  void import("../mailworker").then((w) => w.processOutbox()).catch(() => {});
  return row.id;
}

export async function verifyOtpChallenge(challengeId: string, code: string): Promise<OtpVerifyResult> {
  const [ch] = await db.select().from(adminOtpChallenges).where(eq(adminOtpChallenges.id, challengeId));
  if (!ch) return { ok: false, reason: "invalid" };
  if (ch.consumedAt) return { ok: false, reason: "invalid" };
  if (ch.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (ch.codeHash === hashToken(code)) {
    // Consume atomically — the attempt cap is enforced in the WHERE clause so a
    // correct code can never slip through a stale read once the cap is reached.
    const consumed = await db
      .update(adminOtpChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(adminOtpChallenges.id, ch.id),
          isNull(adminOtpChallenges.consumedAt),
          lt(adminOtpChallenges.attempts, MAX_ATTEMPTS),
        ),
      )
      .returning({ id: adminOtpChallenges.id });
    return consumed.length > 0 ? { ok: true } : { ok: false, reason: "too-many-attempts" };
  }
  // Wrong code: increment attempts atomically (no stale-read write). The cap
  // gate lives in the WHERE clause, so once attempts reaches MAX_ATTEMPTS no
  // further increment happens and verification is blocked.
  const [row] = await db
    .update(adminOtpChallenges)
    .set({ attempts: sql`${adminOtpChallenges.attempts} + 1` })
    .where(
      and(
        eq(adminOtpChallenges.id, ch.id),
        isNull(adminOtpChallenges.consumedAt),
        lt(adminOtpChallenges.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning({ attempts: adminOtpChallenges.attempts });
  return row ? { ok: false, reason: "invalid" } : { ok: false, reason: "too-many-attempts" };
}
