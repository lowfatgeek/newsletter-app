import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import "dotenv/config";
import {
  E2E_CONTACT_EMAIL,
  E2E_CRON_SECRET,
  E2E_EMAILIT_WEBHOOK_SECRET,
} from "./constants";

// Fixture test (bukan secret) — nilai sama dengan webServer env di
// playwright.config.ts; seed me-reset hash admin dengan password ini.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPassword123";

test.setTimeout(180_000);

test("broadcast e2e: composer → kirim → worker → laporan → delivered → unsubscribe", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // a. Seed contact confirmed + subscription aktif via SQL langsung.
    //    Seed sudah menghapus sisa campaign '[E2E]' sebelumnya → audiens =
    //    tepat 1 contact ini. Reset juga suppression/consent dari run lama.
    await sql`
      insert into contact (email_normalized, locale, confirmation_status, confirmed_at)
      values (${E2E_CONTACT_EMAIL}, 'id', 'confirmed', now())
      on conflict (email_normalized) do update
        set confirmation_status = 'confirmed', confirmed_at = now()
    `;
    await sql`
      delete from email_suppressions where email_normalized = ${E2E_CONTACT_EMAIL}
    `;
    await sql`
      delete from consent_event
      where contact_id in (select id from contact where email_normalized = ${E2E_CONTACT_EMAIL})
    `;
    await sql`
      insert into marketing_subscription (contact_id, status, subscribed_at, source)
      select id, 'active', now(), 'e2e' from contact where email_normalized = ${E2E_CONTACT_EMAIL}
      on conflict (contact_id) do update
        set status = 'active', subscribed_at = now(), unsubscribed_at = null
    `;

    // b. Login admin (pola admin.spec.ts): /admin → login → OTP dari outbox →
    //    dashboard.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", ADMIN_PASSWORD);
    await page.click("#login-submit");
    await expect(page).toHaveURL(/\/admin\/otp/);

    const otpRows = await sql<{ text: string }[]>`
      select text from email_outbox
      where email_type = 'otp_admin'
      order by created_at desc
      limit 1
    `;
    expect(otpRows).toHaveLength(1);
    const code = otpRows[0].text.match(/\d{6}/)![0];

    await page.fill("#code", code);
    await page.check("#trust-device");
    await page.click("#otp-submit");
    await expect(page).toHaveURL(/\/admin\/campaigns$/);

    // b2. Ekspektasi audiens dihitung dari DB dengan definisi yang sama seperti
    //     src/lib/broadcast/audience.ts: contact confirmed + subscription
    //     marketing aktif + tanpa baris suppression. Segment default "Semua
    //     subscriber" (all: true); tidak ada cap limit saat snapshot. Ini
    //     membuat spec tidak lagi bergantung pada asumsi "audiens = 1".
    const expectedRows = await sql<{ id: string }[]>`
      select c.id
      from contact c
      join marketing_subscription ms on ms.contact_id = c.id
      left join email_suppressions s on s.email_normalized = c.email_normalized
      where c.confirmation_status = 'confirmed'
        and ms.status = 'active'
        and s.email_normalized is null
    `;
    const expected = expectedRows.length;
    expect(expected).toBeGreaterThan(0);

    // c. Buat campaign draft → editor → isi konten ID + 1 link https → simpan.
    await page.goto("/admin/email-campaigns/new");
    await page.click("#new-submit");
    await expect(page).toHaveURL(/\/admin\/email-campaigns\/[0-9a-f-]{36}$/);
    const campaignId = page.url().split("/").pop()!;

    await page.fill("#f-subject-id", "[E2E] Uji Broadcast");
    await page.fill("#f-preheader-id", "Smoke test broadcast KelasWFA ujung ke ujung.");
    await page.fill(
      "#f-body-id",
      `<p>Halo {{email}},</p><p>Terima kasih sudah membaca. <a href="https://kelaswfa.example/terima-kasih">Baca selengkapnya</a></p>`,
    );
    // Segment default "Semua subscriber" sudah terpilih; limit default dibiarkan.
    await page.click("#save-btn");
    await expect(page.locator("#save-status")).toContainText("Tersimpan");

    // d. Review modal → CTA memuat estimasi audiens riil (1) → kirim sekarang
    //    → status queued.
    await page.click("#schedule-btn");
    const reviewConfirm = page.locator("#review-confirm");
    await expect(reviewConfirm).toHaveText(`Kirim ke ${expected} subscriber`);
    await expect(page.locator("#rv-audience")).toHaveText(`${expected} subscriber`);
    await reviewConfirm.click();
    await expect(page.locator(".helper strong")).toHaveText("Antre");

    // e. Trigger worker cron → batch terkirim via MO_BROADCAST (tanpa API
    //    provider) → campaign completed.
    const cronRes = await page.request.get("/api/cron/broadcast", {
      headers: { "x-cron-secret": E2E_CRON_SECRET },
    });
    expect(cronRes.status()).toBe(200);
    const cronJson = (await cronRes.json()) as { campaignId: string | null; sent: number; stopped: string };
    expect(cronJson.campaignId).toBe(campaignId);
    expect(cronJson.sent).toBe(expected);
    expect(cronJson.stopped).toBe("completed");

    // f. Laporan: badge Selesai, progres <expected> dari <expected>, KPI
    //    Terkirim <expected> (Sampai masih 0 — webhook belum masuk).
    await page.goto(`/admin/email-campaigns/${campaignId}/laporan`);
    await expect(page.locator(".helper .badge")).toContainText("Selesai");
    await expect(page.locator(".progress-line")).toContainText(
      new RegExp(`Mengirim\\s*${expected} dari ${expected} penerima`),
    );
    const kpi = (label: string) => page.locator(".kpi", { has: page.locator("dt", { hasText: label }) }).locator("dd");
    await expect(kpi("Terkirim")).toHaveText(String(expected));
    await expect(kpi("Sampai")).toHaveText("0");
    // Belum ada yang unsubscribe.
    await expect(kpi("Berhenti")).toHaveText("0");

    // g. Simulasikan webhook Emailit delivered: baca fake provider message id
    //    (mo-<recipientId>) dari email_deliveries, hitung HMAC-SHA256 hex dari
    //    RAW body dengan secret yang sama dengan server, POST ke webhook.
    const deliveries = await sql<{ provider_message_id: string }[]>`
      select d.provider_message_id
      from email_deliveries d
      join email_campaign_recipients r on r.id = d.campaign_recipient_id
      where r.campaign_id = ${campaignId} and d.email_type = 'broadcast'
    `;
    expect(deliveries).toHaveLength(expected);
    const rawBody = JSON.stringify({ type: "email.delivered", message_id: deliveries[0].provider_message_id });
    const signature = createHmac("sha256", E2E_EMAILIT_WEBHOOK_SECRET).update(rawBody).digest("hex");
    const hookRes = await page.request.post("/api/webhooks/emailit", {
      headers: { "x-emailit-signature": signature, "Content-Type": "application/json" },
      data: rawBody,
    });
    expect(hookRes.status()).toBe(200);
    expect(((await hookRes.json()) as { result: string }).result).toBe("recorded");

    // Reload laporan → KPI Sampai 1.
    await page.reload();
    await expect(kpi("Sampai")).toHaveText("1");

    // h. Unsubscribe satu-klik dari link di html terakhir (token raw 43 char
    //    base64url) → halaman konfirmasi → DB: unsubscribed + suppression.
    //    Ambil baris recipient MILIK contact e2e (bukan recipients[0]) agar
    //    tetap benar saat audiens > 1.
    const recipients = await sql<{ last_rendered_html: string }[]>`
      select r.last_rendered_html
      from email_campaign_recipients r
      join contact c on c.id = r.contact_id
      where r.campaign_id = ${campaignId} and c.email_normalized = ${E2E_CONTACT_EMAIL}
    `;
    expect(recipients).toHaveLength(1);
    const rawToken = recipients[0].last_rendered_html.match(/\/api\/unsubscribe\/([A-Za-z0-9_-]{43})/)?.[1];
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.goto(`/api/unsubscribe/${rawToken}`);
    await expect(page).toHaveURL(new RegExp(`/batal-berlangganan/${rawToken}$`));
    await expect(page.getByRole("heading", { name: "Kamu berhenti berlangganan newsletter KelasWFA" })).toBeVisible();

    const subs = await sql<{ status: string }[]>`
      select ms.status from marketing_subscription ms
      join contact c on c.id = ms.contact_id
      where c.email_normalized = ${E2E_CONTACT_EMAIL}
    `;
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("unsubscribed");

    const suppressions = await sql<{ reason: string }[]>`
      select reason from email_suppressions where email_normalized = ${E2E_CONTACT_EMAIL}
    `;
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0].reason).toBe("unsubscribe");

    // i. Kembali ke laporan → KPI Berhenti 1 (hanya contact e2e yang
    //    unsubscribe; nilai ini tidak bergantung besar audiens).
    await page.goto(`/admin/email-campaigns/${campaignId}/laporan`);
    await expect(kpi("Berhenti")).toHaveText("1");
  } finally {
    await sql.end();
  }
});
