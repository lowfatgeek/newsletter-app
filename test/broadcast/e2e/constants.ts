/**
 * Konstanta bersama e2e broadcast — dipakai oleh spec DAN playwright.config.ts
 * (webServer env). Satu sumber kebenaran agar secret yang diverifikasi server
 * selalu identik dengan yang dipakai test (webServer env tidak ikut terpropagasi
 * ke proses test).
 *
 * Nilai-nilai ini fixture test, bukan secret produksi.
 */
export const E2E_CRON_SECRET = "cron-secret-e2e";
export const E2E_EMAILIT_WEBHOOK_SECRET = "test-webhook-secret";
export const E2E_CONTACT_EMAIL = "budi-e2e@gmail.com";
