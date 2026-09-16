import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { env } from "../env";
import { adminUsers } from "../schema";
import { assertPasswordStrength, hashPassword } from "./password";

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
  // Task 3.3 / 05-S5: baca lewat helper env() seperti variabel lain. Fallback
  // "" dipakai karena ADMIN_PASSWORD memang opsional (dianggap tidak diset).
  const configuredPassword = env("ADMIN_PASSWORD", "");
  const password = options?.resetPassword || configuredPassword || randomBytes(18).toString("base64url");
  assertPasswordStrength(password);

  // Task 3.4 / 08-N1: satu insert atomik. Sebelumnya select-then-insert bisa
  // balapan (dua proses bootstrap bersamaan → unique violation 23505);
  // onConflictDoNothing membuat tepat satu proses "menang" dan itulah yang
  // dilaporkan sebagai created.
  const [created] = await db
    .insert(adminUsers)
    .values({ email, passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: adminUsers.email })
    .returning({ id: adminUsers.id });

  if (created) {
    return { created: true, email, generatedPassword: password === configuredPassword ? undefined : password };
  }

  if (options?.resetPassword) {
    assertPasswordStrength(options.resetPassword);
    await db
      .update(adminUsers)
      .set({ passwordHash: await hashPassword(options.resetPassword) })
      .where(eq(adminUsers.email, email));
  }
  return { created: false, email };
}
