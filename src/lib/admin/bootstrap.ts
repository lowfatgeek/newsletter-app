import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminUsers } from "../schema";
import { hashPassword, assertPasswordStrength } from "./password";
import { env } from "../env";

export async function ensureAdmin(): Promise<{ created: boolean; email: string; generatedPassword?: string }> {
  const email = env("ADMIN_EMAIL", "kelaswfa@gmail.com").toLowerCase();
  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) {
    return { created: false, email };
  }
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  assertPasswordStrength(password);
  await db.insert(adminUsers).values({ email, passwordHash: await hashPassword(password) });
  return { created: true, email, generatedPassword: process.env.ADMIN_PASSWORD ? undefined : password };
}
