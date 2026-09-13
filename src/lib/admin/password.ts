import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argonVerify(hash, plain);
}

export function assertPasswordStrength(plain: string): void {
  if (plain.length < 12 || !/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    throw new Error("Password minimal 12 karakter dan mengandung huruf serta angka");
  }
}
