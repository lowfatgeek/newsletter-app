import { createHash } from "node:crypto";

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

/**
 * Astro build meng-inline `<script>` komponen ke dalam HTML yang di-render SSR
 * (di dev, script disajikan sebagai file terpisah — karena itu e2e dev lolos).
 * Dengan `script-src 'self'`, browser menolak semuanya → JS admin (form submit,
 * editor, tombol kirim) dan claim form publik mati total di production.
 *
 * Mitigasi: setiap response HTML dipindai; tiap inline script tanpa `src` dan
 * tanpa nonce/hashed-src (attribute hash juga harus diizinkan) di-hash
 * sha256(base64) sesuai spesifikasi CSP3 dan ditambahkan ke `script-src` —
 * setara dengan apa yang dilakukan `security.csp` bawaan Astro, tapi bekerja
 * dengan header per-request milik middleware ini. CSP tetap menolak inline
 * script hasil injeksi yang tidak dikenal karena tidak ada `'unsafe-inline'`.
 *
 * Catatan: `nonce=`/`integrity=`/`hash=` pada tag tidak di-hash (browser juga
 * mengabaikannya untuk hash allowlist), dan script dengan `src=` bukan inline.
 */
const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const JS_TYPES = new Set(["module", "text/javascript", "application/javascript", "text/babel"]);

function isExecutableScript(attrs: string): boolean {
  const m = /\stype=(["']?)([^"'\s>]+)/i.exec(attrs);
  // Tanpa atribut type = JS klasik. Type non-JS (mis. application/json) tidak dieksekusi.
  return !m || JS_TYPES.has(m[2].toLowerCase());
}

export function cspWithInlineScriptHashes(csp: string, html: string): string {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const [, attrs, body] = match;
    if (!body.trim() || !isExecutableScript(attrs)) continue;
    // Tag dengan nonce tidak bisa diizinkan via hash → lewati (proyek ini tak memakai nonce).
    if (/\snonce=/i.test(attrs) || /data-astro-csp/i.test(attrs)) continue;
    const digest = createHash("sha256").update(body, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  if (hashes.length === 0) return csp;
  return csp.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`);
}

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
  let response = await next();
  applySecurityHeaders(response.headers, import.meta.env.PROD);
  // Buffer hanya untuk HTML (halaman Astro men-inline script komponen saat
  // build; header CSP harus memuat hash-nya agar tidak diblokir script-src).
  const isHtml = response.headers.get("content-type")?.includes("text/html");
  if (isHtml && response.ok && !response.bodyUsed) {
    const body = await response.arrayBuffer();
    const html = new TextDecoder().decode(body);
    const headers = new Headers(response.headers);
    const csp = headers.get("Content-Security-Policy");
    if (csp?.includes("script-src")) {
      headers.set("Content-Security-Policy", cspWithInlineScriptHashes(csp, html));
    }
    response = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
};
