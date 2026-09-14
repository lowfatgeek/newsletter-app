import { env } from "./env";

/**
 * Autentikasi endpoint cron. Menerima DUA bentuk agar cocok dengan Vercel Cron
 * (yang otomatis mengirim `Authorization: Bearer $CRON_SECRET` bila env
 * `CRON_SECRET` terpasang) sekaligus pemanggil manual yang memakai header
 * `x-cron-secret` (dipakai e2e).
 */
export function cronAuthorized(request: Request): boolean {
  const secret = env("CRON_SECRET");
  if (request.headers.get("x-cron-secret") === secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
