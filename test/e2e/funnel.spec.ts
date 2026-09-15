import { expect, test } from "@playwright/test";

test("funnel: timer unlocks, submit shows generic check-email page", async ({ page }) => {
  await page.goto("/r/starter-kit");
  await expect(page.getByRole("heading", { name: "Starter Kit KelasWFA" })).toBeVisible();

  // Timer deterministik via TEST_TIMER_MS (vite.define di astro.config.mjs).
  await expect(page.locator("#claim-form")).toHaveAttribute("data-timer-ms", "100");
  await expect(page.locator("#submit-btn")).toBeDisabled();

  // Tunggu unlock nyata (bukan waitForTimeout): tombol kembali aktif.
  await expect(page.locator("#submit-btn")).toBeEnabled({ timeout: 15_000 });

  await page.fill("#email", "e2e@gmail.com");
  await page.click("#submit-btn");
  await expect(page).toHaveURL(/cek-email/);
  await expect(page.getByRole("heading", { name: "Cek emailmu" })).toBeVisible();
  // Tombol "Kirim ulang" menaut kembali ke landing campaign asal (?s=<slug>).
  await expect(page.getByRole("link", { name: "Kirim ulang" })).toHaveAttribute("href", "/r/starter-kit");
});

test("en fallback: /en/r/starter-kit renders ID content with lang=id + bilingual alternate links", async ({ page }) => {
  const response = await page.goto("/en/r/starter-kit");
  expect(response?.status()).toBe(200);
  // Konten memang ID → html lang mengikuti locale konten efektif, bukan URL.
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByRole("heading", { name: "Starter Kit KelasWFA" })).toBeVisible(); // fallback ID
  // Kedua varian bahasa tetap bisa ditemukan crawler lewat link alternate.
  await expect(page.locator('link[rel="alternate"][hreflang="id"]')).toHaveAttribute("href", "/r/starter-kit");
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", "/en/r/starter-kit");
});

test("locale toggle: /r/<slug> ⇄ /en/r/<slug> with per-locale canonical", async ({ page }) => {
  await page.goto("/r/starter-kit");
  const idNav = page.getByRole("navigation", { name: "Pilih bahasa" });
  await expect(idNav.getByRole("link", { name: "EN" })).toBeVisible();
  await expect(idNav.locator('[aria-current="true"]')).toHaveText("ID");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/r\/starter-kit$/);

  await idNav.getByRole("link", { name: "EN" }).click();
  await expect(page).toHaveURL("/en/r/starter-kit");
  const enNav = page.getByRole("navigation", { name: "Pilih bahasa" });
  await expect(enNav.getByRole("link", { name: "ID" })).toBeVisible();
  await expect(enNav.locator('[aria-current="true"]')).toHaveText("EN");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/r\/starter-kit$/);

  await enNav.getByRole("link", { name: "ID" }).click();
  await expect(page).toHaveURL("/r/starter-kit");
});

test("404: unknown slug returns friendly 404 page with status 404", async ({ page }) => {
  const response = await page.goto("/r/tidak-ada-campaign-ini");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
});
