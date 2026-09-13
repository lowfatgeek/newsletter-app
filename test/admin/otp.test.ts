import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { adminOtpChallenges, adminUsers, emailOutbox } from "../../src/lib/schema";
import { issueOtpChallenge, verifyOtpChallenge } from "../../src/lib/admin/otp";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("otp", () => {
  beforeEach(resetDb);

  it("issues challenge, enqueues email, correct code verifies once", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.emailType, "otp_admin"));
    const code = mail.text.match(/\d{6}/)![0];
    expect(await verifyOtpChallenge(id, code)).toEqual({ ok: true });
    expect(await verifyOtpChallenge(id, code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("wrong code increments attempts; 6th attempt rejected", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtpChallenge(id, "000000")).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyOtpChallenge(id, "000000")).toEqual({ ok: false, reason: "too-many-attempts" });
  });

  it("expired challenge rejected", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    await db.update(adminOtpChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminOtpChallenges.id, id));
    expect(await verifyOtpChallenge(id, "123456")).toEqual({ ok: false, reason: "expired" });
  });
});
