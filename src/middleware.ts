import type { MiddlewareHandler } from "astro";

/**
 * Security headers untuk SEMUA response (halaman + API route on-demand).
 *
 * Catatan penting:
 * - CSP default memakai `frame-ancestors 'none'`. Route preview email
 *   (`/admin/api/email-campaigns/[id]/preview`) sudah menyetel CSP-nya sendiri
 *   (`frame-ancestors 'self'`) agar bisa di-iframe same-origin oleh composer.
 *   Helper di bawah HANYA menyetel header yang belum ada → CSP route preview
 *   tidak tertimpa.
 * - HSTS hanya dikirim di production; di dev (http localhost) header ini
 *   tidak berguna justru berisiko.
 * - Tidak ada X-Frame-Options: DENY karena akan memblokir iframe preview dan
 *   tidak bisa ditimpa per-route; proteksi framing ditangani CSP
 *   frame-ancestors.
 */
export const SECURITY_CSP =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** Terapkan header keamanan tanpa menimpa header yang sudah diset route. */
export function applySecurityHeaders(headers: Headers, production: boolean): void {
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", SECURITY_CSP);
  }
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  if (production && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

export const onRequest: MiddlewareHandler = async (_context, next) => {
  const response = await next();
  applySecurityHeaders(response.headers, import.meta.env.PROD);
  return response;
};
