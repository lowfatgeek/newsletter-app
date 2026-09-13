import { test, expect } from "@playwright/test";

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
});

test("en fallback: /en/r/starter-kit renders Indonesian content with lang=en", async ({ page }) => {
  await page.goto("/en/r/starter-kit");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Starter Kit KelasWFA" })).toBeVisible(); // fallback ID
});
