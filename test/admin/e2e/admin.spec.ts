import { test, expect } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

// Fixture test (bukan secret) — nilai sama dengan webServer env di
// playwright.config.ts; seed me-reset hash admin dengan password ini.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPassword123";

test.setTimeout(120_000);

test("admin e2e: login → OTP → CMS buat campaign → publish → halaman publik", async ({ page }) => {
  // a. /admin tanpa sesi → redirect ke /admin/login.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);

  // b. Login email + password → diarahkan ke halaman OTP.
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.click("#login-submit");
  await expect(page).toHaveURL(/\/admin\/otp/);
  await expect(page.getByRole("heading", { name: "Verifikasi OTP" })).toBeVisible();

  // c. Baca kode OTP dari email_outbox (MOCK_EMAILIT=true → email masuk tabel,
  //    kode 6 digit tertanam di subject dan text).
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  let code: string;
  try {
    const rows = await sql<{ text: string }[]>`
      select text from email_outbox
      where email_type = 'otp_admin'
      order by created_at desc
      limit 1
    `;
    expect(rows).toHaveLength(1);
    code = rows[0].text.match(/\d{6}/)![0];
    expect(code).toMatch(/^\d{6}$/);
  } finally {
    await sql.end();
  }

  // d. Submit OTP + percayai perangkat → dashboard funnel /admin.
  await page.fill("#code", code);
  await page.check("#trust-device");
  await page.click("#otp-submit");
  await expect(page).toHaveURL(/^.*\/admin\/?$/);
  await expect(page.getByRole("heading", { name: "Dashboard Funnel" })).toBeVisible();

  // e. Buat campaign baru via UI → editor terbuka.
  await page.goto("/admin/campaigns");
  await expect(page.getByRole("heading", { name: "Reward Campaign" })).toBeVisible();
  await page.getByRole("link", { name: "Buat reward campaign" }).first().click();
  await expect(page).toHaveURL(/\/admin\/campaigns\/new$/);
  const slug = `admin-e2e-${Math.random().toString(36).slice(2, 8)}`;
  await page.fill("#slug", slug);
  await page.click("#new-submit");
  await expect(page).toHaveURL(/\/admin\/campaigns\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Detail" })).toBeVisible();

  // Isi konten ID + simpan.
  await page.fill("#f-title-id", "Hadiah E2E Admin");
  await page.fill("#f-desc-id", "Halaman reward hasil smoke test admin end-to-end KelasWFA.");
  await page.click("#save-btn");
  await expect(page.locator("#save-status")).toContainText("Tersimpan");

  // Gate publish butuh minimal 1 reward file — sisipkan langsung ke DB
  // (pola sama seperti pembacaan OTP), lalu muat ulang editor supaya gate
  // server-side (canPublishBase) menghitung asset tersebut.
  const campaignId = page.url().split("/").pop()!;
  const sql2 = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql2`
      insert into reward_asset (campaign_id, storage_key, name_id, name_en, mime_type, size_bytes, checksum)
      values (
        ${campaignId},
        ${"rewards/e2e/admin-e2e.pdf"},
        ${"Panduan E2E"},
        ${"E2E Guide"},
        ${"application/pdf"},
        ${1024},
        ${"0".repeat(64)}
      )
    `;
  } finally {
    await sql2.end();
  }
  await page.reload();

  // f. Publish: auto-accept dialog konfirmasi native → badge Published.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.click('[data-status-action="publish"]');
  await expect(page.locator(".status-line strong")).toHaveText("Published");

  // g. Halaman publik menampilkan judul campaign.
  await page.goto(`/r/${slug}`);
  await expect(page.getByRole("heading", { name: "Hadiah E2E Admin" })).toBeVisible();
});
