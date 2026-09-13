import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminUsers } from "../schema";
import { hashPassword, assertPasswordStrength } from "./password";
import { env } from "../env";

export type EnsureAdminOptions = {
  /**
   * Dev/test-only: bila admin sudah ada (mis. dari run sebelumnya dengan
   * password tak dikenal), timpa hash dengan password ini supaya bootstrap
   * deterministik (dipakai scripts/seed.ts untuk e2e). Audit sengaja tidak
   * dicatat untuk jalur dev-only ini.
   */
  resetPassword?: string;
};

export async function ensureAdmin(
  options?: EnsureAdminOptions,
): Promise<{ created: boolean; email: string; generatedPassword?: string }> {
  const email = env("ADMIN_EMAIL", "kelaswfa@gmail.com").toLowerCase();
  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) {
    if (options?.resetPassword) {
      assertPasswordStrength(options.resetPassword);
      await db
        .update(adminUsers)
        .set({ passwordHash: await hashPassword(options.resetPassword) })
        .where(eq(adminUsers.email, email));
    }
    return { created: false, email };
  }
  const password = options?.resetPassword || process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  assertPasswordStrength(password);
  await db.insert(adminUsers).values({ email, passwordHash: await hashPassword(password) });
  return { created: true, email, generatedPassword: password === process.env.ADMIN_PASSWORD ? undefined : password };
}
