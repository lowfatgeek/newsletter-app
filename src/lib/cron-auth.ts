import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Perbandingan timing-safe untuk secret yang panjangnya bisa berbeda (task 2.3):
 * timingSafeEqual menolak buffer beda panjang — dan throw-behavior itu sendiri
 * membocorkan informasi. SHA-256 kedua sisi terlebih dahulu membuat digest selalu
 * 32 byte sehingga perbandingan konstan waktunya tanpa membocorkan panjang secret.
 */
function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Autentikasi endpoint cron. Menerima DUA bentuk agar cocok dengan Vercel Cron
 * (yang otomatis mengirim `Authorization: Bearer $CRON_SECRET` bila env
 * `CRON_SECRET` terpasang) sekaligus pemanggil manual yang memakai header
 * `x-cron-secret` (dipakai e2e).
 */
export function cronAuthorized(request: Request): boolean {
  const secret = env("CRON_SECRET");
  const header = request.headers.get("x-cron-secret");
  if (header && secretsEqual(header, secret)) return true;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && secretsEqual(auth.slice(7), secret)) return true;
  return false;
}
