import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

/**
 * Smoke PARITY PRODUKSI.
 *
 * Bug yang diuji: build Astro meng-inline `<script>` komponen ke HTML SSR;
 * middleware CSP (`script-src 'self'`) menolak semuanya → JS form admin &
 * claim page mati total. `astro dev` TIDAK menangkap ini (script disajikan
 * sebagai file eksternal), jadi regressi ini jalan terhadap server hasil
 * BUILD (`node ./dist/server/entry.mjs`), bukan dev server.
 *
 * Butuh `npm run build` sebelum spec ini; playwright.config tidak me-build,
 * jadi spec melempar error jelas kalau dist/ belum ada / basi.
 */
const PORT = 4329;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPassword123";

test.setTimeout(120_000);

async function readLatestAdminOtp(): Promise<string> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    for (let i = 0; i < 15; i++) {
      const rows = await sql`
        select text from email_outbox
        where email_type = 'otp_admin'
        order by created_at desc
        limit 1
      `;
      if (rows.length > 0) {
        const code = rows[0].text.match(/\d{6}/)?.[0];
        if (code) return code;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("OTP otp_admin tidak ditemukan di email_outbox");
  } finally {
    await sql.end();
  }
}

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* belum listen */
    }
    if (Date.now() > deadline) throw new Error(`server ${url} tidak siap dalam ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

test.describe("prod-parity smoke (server hasil build)", () => {
  let srv: ReturnType<typeof spawn>;
  test.beforeAll(async () => {
    srv = spawn(process.execPath, ["./dist/server/entry.mjs"], {
      env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", MOCK_EMAILIT: "true" },
      stdio: "ignore",
    });
    try {
      await waitForServer(`${BASE}/api/health`);
    } catch (e) {
      srv.kill();
      throw new Error(`${String(e)} — jalankan \`npm run build\` dulu (spec ini butuh dist/ hasil build)`);
    }
  });
  test.afterAll(() => srv.kill());

  test("login OTP via UI, form di halaman SSR memicu fetch nyata, nol pelanggaran CSP", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to execute|Refused to apply/i.test(m.text())) violations.push(m.text());
    });

    // 1. Login lengkap lewat UI: password → OTP dari email_outbox → dashboard.
    await page.goto(`${BASE}/admin/login`);
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", ADMIN_PASSWORD);
    await page.click("#login-submit");
    await page.waitForURL(/\/admin\/otp/, { timeout: 10_000 });
    // OTP dikirim async (outbox worker): beri jeda agar baris terbaru terbaca.
    await page.waitForTimeout(1200);
    const code = await readLatestAdminOtp();
    await page.fill("#code", code);
    await page.click("#otp-submit");
    await page.waitForURL((u) => !/\/admin\/otp/.test(u.pathname), { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Dashboard Funnel" })).toBeVisible();

    // 2. Halaman SSR campaigns/new: submit harus memicu POST nyata.
    //    Sebelum fix hash-CSP, skrip inline hasil build diblokir → 0 request.
    await page.goto(`${BASE}/admin/campaigns/new`);
    await page.fill("#slug", `preview-smoke-${Date.now()}`);
    const postRes = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/admin/api/campaigns") && r.request().method() === "POST", {
        timeout: 8_000,
      }),
      page.click("#new-submit"),
    ]).then(([res]) => res);
    expect(postRes.ok()).toBeTruthy();
    // Body response tak terbaca lagi (halaman langsung bernavigasi), jadi id
    // campaign diambil dari URL editor — pola sama dengan admin.spec.
    await page.waitForURL(/\/admin\/campaigns\/[0-9a-f-]{36}$/, { timeout: 8_000 });
    const campaignId = new URL(page.url()).pathname.split("/").pop()!;
    expect(campaignId).toMatch(/^[0-9a-f-]{36}$/);

    // 3. Editor reward (halaman SSR): form binding hidup — Simpan memicu POST
    //    nyata dan status "Tersimpan" dimunculkan oleh skrip inline yang di-hash.
    await page.goto(`${BASE}/admin/campaigns/${campaignId}`);
    await page.fill("#f-title-id", "Preview Smoke");
    const patchRes = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/admin/api/campaigns/${campaignId}`) && r.request().method() === "POST",
        { timeout: 8_000 },
      ),
      page.click("#save-btn"),
    ]).then(([res]) => res);
    expect(patchRes.ok()).toBeTruthy();
    await expect(page.locator("#save-status")).toContainText("Tersimpan", { timeout: 5_000 });

    // 4. Header CSP halaman SSR (dari goto di langkah 2 tidak tersedia lagi;
    //    request ulang): script-src tetap ketat — tanpa unsafe-inline — tapi
    //    mengizinkan inline skrip hasil build via hash sha256.
    const htmlRes = await page.context().request.get(`${BASE}/admin/campaigns/new`);
    expect(htmlRes.ok()).toBeTruthy();
    const csp = htmlRes.headers()["content-security-policy"] ?? "";
    const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toMatch(/'sha256-[A-Za-z0-9+/=]+'/); // hash inline skrip ikut diizinkan

    // 5. Nol pelanggaran CSP selama seluruh alur di atas.
    expect(violations).toEqual([]);

    // Cleanup lewat DB (tidak ada API DELETE untuk reward campaign).
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`delete from reward_campaign where id = ${campaignId}`;
    } finally {
      await sql.end();
    }
  });
});
