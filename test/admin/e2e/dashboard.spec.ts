import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

// Fixture test (bukan secret) — nilai sama dengan webServer env di
// playwright.config.ts; seed me-reset hash admin dengan password ini.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPassword123";

test.setTimeout(120_000);

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.click("#login-submit");
  await expect(page).toHaveURL(/\/admin\/otp/);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<{ text: string }[]>`
      select text from email_outbox
      where email_type = 'otp_admin'
      order by created_at desc
      limit 1
    `;
    expect(rows).toHaveLength(1);
    const code = rows[0].text.match(/\d{6}/)![0];
    await page.fill("#code", code);
  } finally {
    await sql.end();
  }
  await page.click("#otp-submit");
  // Tunggu redirect OTP → /admin selesai (cookie sesi terpasang) sebelum
  // navigasi lanjutan; tanpa ini goto berikutnya berpacu dengan assign OTP.
  await expect(page).toHaveURL(/^.*\/admin\/?$/);
}

test("admin dashboard: /admin menampilkan angka funnel + tautan kerja", async ({ page }) => {
  await loginAdmin(page);
  // OTP mengarah ke /admin → dashboard funnel (bukan redirect campaigns).
  await expect(page).toHaveURL(/^.*\/admin\/?$/);
  await expect(page.getByRole("heading", { name: "Dashboard Funnel" })).toBeVisible();

  // 8 kartu angka + access rate terlihat.
  for (const label of [
    "Total kontak",
    "Terkonfirmasi 30 hari",
    "Subscriber aktif",
    "Total klaim",
    "Email konfirmasi",
    "Email akses hadiah",
    "Unduhan diterbitkan",
    "Berhenti berlangganan",
    "Reward access rate",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // Batasan eksplisit: tanpa pelacakan page-view.
  await expect(page.getByText("tanpa pelacakan page-view")).toBeVisible();

  // Tautan kerja ke kontak, campaign, dan audit log.
  await expect(page.getByRole("link", { name: "Lihat audit log" })).toHaveAttribute("href", "/admin/audit");
});

test("admin audit: /admin/audit 200 + tabel terlihat", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  // Login OTP baru saja menulis audit → minimal 1 baris.
  expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
});

// Task 3.11 / 06-A11y6: di mobile sidebar jadi drawer — tombol burger membuka
// (checkbox + label, tetap jalan tanpa JS), scrim menutupnya.
test.describe("drawer navigasi admin (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("burger membuka drawer, tautan navigasi & scrim bekerja", async ({ page }) => {
    await loginAdmin(page);

    const sidebar = page.locator(".admin-sidebar");
    const navLink = (name: string) =>
      page.getByRole("navigation", { name: "Navigasi admin" }).getByRole("link", { name });
    await expect(sidebar).toBeHidden();
    await expect(page.locator(".admin-mobile-bar")).toBeVisible();

    await page.locator(".admin-nav-burger").click();
    await expect(sidebar).toBeVisible();
    await expect(navLink("Kontak")).toBeVisible();

    // Scrim menutup drawer lagi (klik di area kanan sidebar).
    await page.locator(".admin-nav-scrim").click({ position: { x: 320, y: 400 } });
    await expect(sidebar).toBeHidden();

    // Navigasi lewat drawer mengarah ke halaman admin yang dituju.
    await page.locator(".admin-nav-burger").click();
    await navLink("Kontak").click();
    await expect(page).toHaveURL(/\/admin\/contacts$/);
  });
});
