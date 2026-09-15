# Audit 07 — Performance

Tanggal: 2026-09-14 (audit ulang mandiri 2026-09-14)
Lingkup: query DB, index, pagination, over-fetch, bundle client, font/gambar, caching. Metode: read-only — baca kode, grep, `git log` read-only. Tanpa uji beban, tanpa profil runtime, tanpa Lighthouse. Tidak ada perubahan kode. Semua nomor baris diverifikasi ulang pada revisi ini.

## Ringkasan

Kinerja **sehat untuk skala MVP**. Keputusan besar sudah benar: SSR-first tanpa framework JS client (tidak ada bundle hidrasi — JS hanya script inline per halaman), font self-hosted subset latin + `display: swap`, gambar hero berdimensi eksplisit + eager, dashboard memakai `Promise.all` untuk 8 count, daftar admin ber-paginasi, worker memakai budget per menit/jam/hari dengan satu batch per tick, dan outbox memakai `FOR UPDATE SKIP LOCKED` batch 20.

Revisi ini mengoreksi tiga klaim lama yang salah: (a) sitemap **sudah** punya `Cache-Control` publik (`src/pages/api/sitemap.xml.ts:53`), (b) halaman kontak ber-paginasi **20**/halaman, bukan 100 (`src/pages/admin/contacts/index.astro:15`), dan (c) `privacy.astro` **tidak** prerender — ia justru `prerender = false` (`src/pages/privacy.astro:4`, `src/pages/en/privacy.astro:4`). Klaim index lama juga tidak lengkap: beberapa kolom join/`WHERE` jalur panas **belum berindeks** (terutama `email_deliveries.campaign_recipient_id`, `email_outbox(status, scheduled_at)`, `email_campaigns.status`).

Tiga temuan lama tetap berlaku, dengan angka yang dikoreksi: halaman reward menanyakan campaign dua kali (P1 — total ~6 query/request published ID, jadi redundansinya ~17%, bukan ~50%), halaman reward HTML tanpa `Cache-Control` publik (P2), dan statistik laporan memakai query serial (P3 — ~10 query/request, dan `progressOf` sepenuhnya duplikat). Temuan baru: index yang belum ada di tabel yang tumbuh (`email_deliveries`, `email_outbox`, `email_campaigns`, `consent_event`, `admin_audit_log`).

**Verdict audit 07: LULUS** — tidak ada yang menghalangi lanjut; P1–P4 optimasi opportunistis, N1 (index) layak dikerjakan sebelum blast besar.

## Temuan

### P1 — Halaman reward mengambil campaign dua kali (terverifikasi, dampak dikoreksi)
- Status: **MINOR (redundansi).**
- Bukti: `src/pages/r/[slug].astro:22` (`getPublicCampaignState`) lalu `:29` (`getPublishedCampaign`); mirror EN `src/pages/en/r/[slug].astro:22,29`. Keduanya `SELECT ... FROM reward_campaign WHERE slug = ?` ke tabel yang sama — `src/lib/campaign.ts:15` dan `src/lib/campaign.ts:22-25`. Yang pertama hanya membaca `status` untuk klasifikasi (`campaign.ts:16-18`), yang kedua memuat konten bila published.
- Hitungan round-trip nyata satu request halaman reward **published ID**: (1) `campaign.ts:15`, (2) `campaign.ts:22-25`, (3) `campaign.ts:39-42` (`reward_campaign_locale`), (4) `campaign.ts:43-46` (`doa_selection`), (5) `campaign.ts:51` (`doa_template` muslim, `r/[slug].astro:75`), (6) `campaign.ts:51` (`doa_template` universal, `r/[slug].astro:76`) = **6 query**. `localeRow(...)` (`r/[slug].astro:32`) tidak query — filter in-memory (`campaign.ts:71-78`). Halaman EN bisa **8 query** karena `doaText` menambah lookup fallback (`campaign.ts:56-65`) bila template terpilih bukan locale EN.
- Dampak: 1 query ekstra dari ~6 (~17%), bukan ~50%. Query berindeks `slug` unique (`schema.ts:30`) — murah, sub-milidetik. `getPublicCampaignState` juga `select()` semua kolom hanya untuk membaca `status` (over-fetch 1 baris, dapat diabaikan).
- Rekomendasi: gabung menjadi satu fetch status+konten (konten diabaikan bila bukan published). Sekaligus kurangi query `doa_template` dengan join saat `loadCampaignContent`.

### P2 — Tidak ada `Cache-Control` publik pada halaman reward dan redirect gambar (klaim sitemap dikoreksi)
- Status: **MINOR (caching).**
- Bukti grep `Cache-Control` di seluruh `src/`:
  - **Publik (hanya satu):** `src/pages/api/sitemap.xml.ts:53` — `"Cache-Control": "public, max-age=3600"`. Klaim lama bahwa sitemap tidak punya cache publik **SALAH**.
  - **`no-store` (benar, respons sensitif/token):** `src/pages/api/timer-token.ts:34`; `src/pages/api/subscribe.ts:34`; `src/pages/api/click/[linkId]/[token].ts:16,20`; `src/pages/api/unsubscribe/[token].ts:24,36`; `src/pages/api/unsubscribe/resubscribe.ts:22,36,42`; `src/pages/api/webhooks/emailit.ts:21`; seluruh admin API (`src/pages/admin/api/**` — 25+ kemunculan, mis. `domains.ts:9`, `login.ts:7`, `otp.ts:7`, `logout.ts:7`, `contacts/export.ts:21,49`, `email-campaigns/[id]/preview.ts:28,36,53,68`).
  - **Tanpa header sama sekali:** halaman reward HTML (`src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`); middleware hanya menambah header keamanan, bukan cache (`src/middleware.ts:22-35`).
- Bukti tambahan: `/api/image/[...key]` **tidak** mengembalikan byte gambar — ia `Response.redirect(r.url, 302)` ke URL R2 presigned (`src/pages/api/image/[...key].ts:11`), dan tidak menyetel `Cache-Control`. Presigned URL ber-TTL **3600 detik** (`src/lib/download.ts:7` `DOWNLOAD_URL_TTL_SEC = 3600`, dipakai di `download.ts:36`). Resolusi per request = 1 query DB (`download.ts:33-34`) + signing lokal (`src/lib/storage.ts:45-58`, tanpa network).
- Dampak: setiap kunjungan ulang dan setiap forward email memukul origin + DB + signing. Reward HTML juga memuat token timer per-request (`src/components/EmailForm.astro:14,41`) sehingga caching publik harus TTL pendek (lihat rekomendasi).
- Rekomendasi: `Cache-Control: public, max-age=60` (atau `s-maxage`) pada halaman reward **published**; halaman paused/`/akses`/`/konfirmasi` tetap `no-store`/`private`. Untuk redirect `/api/image/[...key]`, TTL cache **tidak boleh melebihi masa berlaku presigned URL** — jadi `public, max-age=3600` maksimum, atau jangan di-cache (`no-store`) dan biarkan byte dilayani langsung dari R2 oleh browser via URL yang di-redirect. Klaim lama "immutable per key, max-age panjang" **tidak aman** karena URL target kedaluwarsa.

### P3 — Statistik laporan memakai ~10 query serial, `progressOf` duplikat (angka dikoreksi)
- Status: **MINOR (query).**
- Bukti `src/pages/admin/email-campaigns/[id]/laporan.astro` (semua `await` serial, tanpa `Promise.all`):
  1. guard `requireAdminOrRedirect` (`laporan.astro:16`) → `src/lib/admin/guard.ts:14` → `src/lib/admin/sessions.ts:26-37`: **1 query**.
  2. `getEmailCampaignById(id)` (`laporan.astro:20`) → `src/lib/broadcast/crud.ts:131`: **1 query**.
  3. `campaignStats(id)` (`laporan.astro:26`) → `src/lib/broadcast/stats.ts:39-94`: **4 query** serial di `stats.ts:40`, `:49`, `:63`, `:69`.
  4. `progressOf(id)` (`laporan.astro:27`) → `src/lib/broadcast/stats.ts:97-106`, query di `:98`: **1 query** — dan hasilnya (`total`, `sentSoFar`) **identik** dengan `recipients`/`sent` yang sudah dihitung `campaignStats` (`stats.ts:42-43`). Ini duplikasi murni.
  5. count failed terpisah (`laporan.astro:29-32`): **1 query**.
  6. `listRecipients(...)` (`laporan.astro:49`) → `src/lib/broadcast/stats.ts:139-158` (rows) + `:160-163` (count): **2 query**. Bila `page` di luar rentang, dipanggil ulang (`laporan.astro:57-59`): **+2 query**.
- Total: **~10 query serial** (12 bila halaman di luar rentang), bukan "3+". Klaim lama "masing-masing agregat `count(*)` ke tabel recipient yang sama" juga tidak tepat: `campaignStats` menyentuh `email_campaign_recipients`, `email_deliveries`, `email_campaigns`, dan `consent_events`.
- Dampak: 10 round-trip serial untuk satu tampilan admin. Tabel `email_campaign_recipients`/`email_deliveries` tumbuh ribuan baris per campaign.
- Rekomendasi: hapus `progressOf` (pakai nilai dari `campaignStats`); jalankan query independen dengan `Promise.all`; gabung agregat recipient menjadi satu `GROUP BY status`. Bukan masalah skala MVP (halaman admin, bukan publik).

### N1 (baru) — Index belum ada pada tabel jalur panas yang tumbuh
- Status: **MINOR–SEDANG (bertambah seiring data).**
- Bukti kolom yang di-join/filter tetapi tanpa index (`src/lib/schema.ts`):
  - `email_deliveries.campaign_recipient_id` — FK `schema.ts:234`, dipakai join di `stats.ts:52`, `stats.ts:72`, `stats.ts:151-154`, `worker.ts:51`.
  - `email_deliveries.contact_id` — FK `schema.ts:233`, filter di `admin/contacts.ts:219`.
  - `email_deliveries.sent_at` — filter `worker.ts:54`, `:62` (`countDeliveriesProvider` memindai semua delivery sejak awal hari, tiap tick).
  - `email_deliveries.email_type` — filter `stats.ts:55`, `:74`, `:153`.
  - `email_outbox(status, scheduled_at)` — filter drain + order di `mailworker.ts:11-13`, jalan tiap menit via cron (`src/pages/api/cron/outbox.ts`).
  - `email_campaigns.status` (+`scheduled_at`) — promosi scheduled & pemilihan queued di `worker.ts:90`, `:96`, tick tiap menit.
  - `consent_event.contact_id` — FK `schema.ts:23`, join `stats.ts:77`, filter `admin/contacts.ts:169`.
  - `admin_audit_log.created_at` — `ORDER BY ... DESC` tanpa filter di `src/lib/admin/audit.ts:57`.
  - `reward_campaign(status, indexable, sort_order)` — filter/order sitemap `src/pages/api/sitemap.xml.ts:33-34` (tabel kecil; prioritas rendah).
- Dampak: pada volume kecil tidak terasa, tetapi `email_deliveries` adalah tabel yang paling cepat tumbuh (satu baris per email terkirim) dan dipakai join di halaman laporan serta hitungan budget worker. Tanpa index, join/agregat menjadi seq scan.
- Rekomendasi: tambah index `email_deliveries(campaign_recipient_id)`, `email_deliveries(contact_id)`, `email_deliveries(sent_at)`, `email_outbox(status, scheduled_at)`, `email_campaigns(status)`, `consent_event(contact_id)` via migrasi Drizzle.

### N2 (baru) — `progressOf` sepenuhnya duplikat dari `campaignStats`
- Sudah tercakup P3. Dicatat terpisah karena menghapusnya menghilangkan 1 dari 10 round-trip tanpa perubahan perilaku (`stats.ts:97-106` vs `stats.ts:40-47`).

### N3 (baru) — `/api/timer-token` menambah 1 request + 2 operasi DB per kunjungan reward
- Status: **MINOR.**
- Bukti: `src/components/EmailForm.astro:109-118` selalu POST `/api/timer-token` saat load. Handler: `consumeRateLimit` = 1 statement DB (`src/pages/api/timer-token.ts:19` → `src/lib/ratelimit.ts:14-19`) + 1 `SELECT` campaign (`timer-token.ts:30`). Jadi +2 operasi DB per kunjungan reward di luar 6 query render. Respons `no-store` (`timer-token.ts:34`).
- Dampak: menggandakan beban halaman terpanas saat blast. Token server-rendered (`EmailForm.astro:14`, HMAC tanpa DB) sebenarnya sudah cukup; fetch ini dipakai untuk menyegarkan `iat`.
- Rekomendasi: pertahankan sebagai best-effort (sudah benar), tetapi bila halaman reward diberi cache publik (P2), token server-rendered yang ter-cache tetap valid ≤ 2 jam (`src/lib/timer.ts:5` `MAX_AGE_MS`), sehingga jumlah fetch tetap bisa ditekan.

## Verifikasi per area (yang terkonfirmasi pada kode saat ini)

1. **Tanpa N+1 baca.** `loadCampaignContent` sebenarnya ada di `src/lib/campaign.ts:38-81` (bukan `src/lib/broadcast/content.ts`): 2 query flat (`campaign.ts:39`, `:43`) tanpa loop query-per-baris; `doaText` menambah query on-demand (`campaign.ts:51`, `:56`). `listRecipients` (`stats.ts:131-166`) = 2 query, tanpa loop. `listContacts` (`admin/contacts.ts:91-151`) = 3 query flat termasuk batch `inArray` agregat claim (`contacts.ts:123-132`); loop `contacts.ts:192,196` hanya map in-memory. Tidak ada `for ... await db` di jalur baca.
2. **Worker per-recipient (catatan).** Loop `worker.ts:153` melakukan ~2 tulisan DB + 1 panggilan provider per recipient (bukan N+1 baca; ini batch pengiriman yang wajar). Batch dibatasi `budget` (`worker.ts:131,147`).
3. **Index terpasang.** Enumerasi dari `schema.ts`: `contacts.email_normalized` unique (`:5`); `contacts.unsubscribe_token_hash` unique (`:9`); `reward_campaign.slug` unique (`:30`); `reward_campaign_locale(campaign_id, locale)` unique (`:48`); `reward_claim(contact_id, campaign_id)` unique (`:72`); `access_token.token_hash` unique (`:78`) + index `access_token(claim_id)` (`:82`); `doa_selection(campaign_id, variant)` unique (`:97`); `email_outbox.idempotency_key` unique (`:112`); `admin_user.email` unique (`:129`); `admin_session.token_hash` unique (`:137`); `trusted_device.token_hash` unique (`:157`); `campaign_redirect.old_slug` unique (`:176`); `email_campaign_recipients.click_token_hash` unique (`:226`) + `(campaign_id, contact_id)` unique (`:229`); `email_deliveries.provider_message_id` unique (`:235`); `email_suppressions` PK `email_normalized` (`:246`); `email_provider_events(provider_message_id, event_type)` unique (`:257`); `email_links.url_hash` unique (`:262`). Filter `email_campaign_recipients.campaign_id` tertutup oleh prefix unique `:229`. **Yang belum berindeks: lihat N1** — klaim lama "semua kolom WHERE/JOIN berindeks" **tidak akurat**.
4. **Pagination.** Laporan **50**/halaman (`laporan.astro:40` `LIMIT = 50`). Kontak **20**/halaman (`admin/contacts/index.astro:15` `PAGE_SIZE = 20`) — klaim lama "100" **salah**. Audit **50**/halaman (`admin/audit.astro:12`), dengan query count + rows di `src/lib/admin/audit.ts:41,46`. Ekspor CSV dibatasi default 5000, cap 50000 (`admin/api/contacts/export.ts:32-34`) — perlu diperhatikan sebagai satu query besar saat ekspor.
5. **Bundle client nol-framework.** `package.json:20-29` hanya `astro`, `@astrojs/node`, `@fontsource/plus-jakarta-sans`, `@node-rs/argon2`, `aws4fetch`, `drizzle-orm`, `postgres`, `sanitize-html`. Grep `react|vue|svelte|nanostores|preact|solid-js|@astrojs/(react|vue|svelte|preact|solid)` di `src/` + `package.json`: **nol**. Tidak ada JS eksternal/render-blocking.
6. **Font.** `@fontsource/plus-jakarta-sans/latin-400/600/700.css` diimpor di `src/layouts/PublicLayout.astro:4-6`, `src/layouts/AdminLayout.astro:3-5`, dan `src/pages/admin/preview/[id].astro:13-15` — tepat 3 bobot, subset latin. `font-display: swap` default terbukti di `node_modules/@fontsource/plus-jakarta-sans/latin-400.css:5`.
7. **Gambar.** `src/components/RewardHero.astro:15-22`: `width="1200" height="630"` + `loading="eager"`, tanpa `fetchpriority` (dapat diterima untuk satu hero). Tidak ada `fonts.googleapis`.
8. **Worker ber-budget.** `worker.ts:81-131`: promosi scheduled (`:88-90`), klaim atomic (`:101`), cap harian provider (`:120-121`), budget menit (`:123-125`), budget jam (`:127-129`), satu batch per tick (`:131,147`), stop reasons `minute-limit`/`hour-limit`/`day-limit`/`completed`.
9. **Outbox batch 20 + skip locked.** `src/lib/mailworker.ts:11-18`: `limit(20)` + `.for("update", { skipLocked: true })`; `MAX_ATTEMPTS = 5` (`:7`); backoff eksponensial (`:47`). Pola benar untuk email transaksional.
10. **Dashboard paralel.** `src/lib/funnel.ts:49-58`: 8 `count()` via `Promise.all` — satu gelombang. Catatan: 8 count ini adalah full-table count per tampilan dashboard, tanpa cache (`funnel.ts:50-57`); untuk MVP wajar, terasa bila tabel sudah besar. Guard dashboard menambah 1 query (`admin/index.astro:10` → `sessions.ts:26`).
11. **Prerender tepat.** Tepat **62** file route `export const prerender = false` di `src/pages/` (dari 67 file route). **5 route prerender** (tanpa `prerender = false`): `src/pages/index.astro`, `src/pages/404.astro`, `src/pages/admin/login.astro`, `src/pages/admin/otp.astro`, `src/pages/admin/reset.astro` — dikonfirmasi artefak build `dist/client/index.html`, `dist/client/404.html`, `dist/client/admin/login/index.html`, `dist/client/admin/otp/index.html`, `dist/client/admin/reset/index.html`. Klaim lama "halaman statis (privacy, 404) tetap prerender" **salah untuk privacy**: `src/pages/privacy.astro:4` dan `src/pages/en/privacy.astro:4` justru `prerender = false` (tidak ada `dist/client/privacy/`).
12. **Pool ramping.** `src/lib/db.ts:4` `postgres(env("DATABASE_URL"), { max: 5 })` — konsisten dengan throughput worker batch.
13. **Tidak ada polling client.** Timer klaim `src/components/EmailForm.astro:128-143` memakai `requestAnimationFrame` + `Date.now()` lokal, tanpa fetch berulang; token disegarkan satu kali best-effort (`EmailForm.astro:109-118`). Grep `setInterval` di `src/`: **nol**. Fetch lain hanya pada aksi user (mis. `admin/domains.astro:247`, `admin/login.astro:73`, `admin/email-campaigns/[id]/laporan.astro:539,580,607`).
14. **Timer klaim rAF (catatan).** `requestAnimationFrame` (`EmailForm.astro:141,143`) berjalan ~60 fps selama 30 detik (~1800 callback) hanya untuk memperbarui `width` bar dan cek elapsed; `setInterval(..., 100)` akan lebih hemat. Dampak kecil, hanya saat countdown aktif.

## Yang belum diuji pada tahap ini

- Uji beban (ratusan klaim/menit, blast ribuan recipient) — disarankan pra-launch bila daftar blast besar. Belum diuji perilaku `max: 5` pool di bawah burst klaim + tick worker bersamaan.
- Lighthouse/Web Vitals aktual (LCP, CLS, INP) di perangkat nyata.
- Ukuran respons HTML halaman editor admin: `src/pages/admin/campaigns/[id].astro` **999 baris** (bukan ~900) dan `src/pages/admin/email-campaigns/[id]/laporan.astro` 623 baris → DOM besar, tetapi admin-only.
- Efektivitas `Cache-Control` yang direkomendasikan (P2) terhadap CDN/proxy di deployment nyata (belum ada CDN terkonfigurasi di repo; `vercel.json` hanya berisi cron).

## Rekomendasi prioritas

1. **Tambah index N1** (`email_deliveries(campaign_recipient_id)`, `email_deliveries(contact_id)`, `email_deliveries(sent_at)`, `email_outbox(status, scheduled_at)`, `email_campaigns(status)`, `consent_event(contact_id)`) — murah, mengurangi risiko seq scan saat data tumbuh.
2. **Gabung fetch ganda halaman reward (P1)** dan kurangi query `doa_template`; hemat ~1–3 query dari ~6–8 query halaman terpanas.
3. **Hapus `progressOf` + paralelkan query laporan (P3/N2)** — dari ~10 serial menjadi ~5–6.
4. **Tambah `Cache-Control` publik TTL pendek untuk reward published (P2)**, dan tangani redirect gambar dengan hati-hati (TTL ≤ masa presigned URL).
5. **Gabung agregat statistik laporan menjadi satu `GROUP BY status`** bila halaman disentuh lagi (P3).

## Catatan revisi audit ulang

Tabel klaim lama → hasil verifikasi → tindakan. Semua nomor baris diverifikasi pada revisi ini.

| # | Klaim lama | Hasil verifikasi | Tindakan |
|---|------------|------------------|----------|
| 1 | P1: halaman reward `getPublicCampaignState` + `getPublishedCampaign` di `r/[slug].astro:22,29` → 1 query ekstra, "hemat ~50%". | Benar dua query ke tabel sama (`campaign.ts:15`, `campaign.ts:22-25`). Total request published ID = **6 query** (termasuk 2 `doa_template` di `campaign.ts:51` dari `r/[slug].astro:75-76`), EN hingga 8. Redundansi ~17%, bukan ~50%. | P1 dipertahankan; angka & bukti dikoreksi. |
| 2 | P2: "Tidak ada header cache publik pada halaman reward, gambar, **atau sitemap**". | **Salah untuk sitemap** — `sitemap.xml.ts:53` sudah `public, max-age=3600`. Untuk gambar: benar tidak ada header, tetapi `/api/image/[...key].ts:11` hanya 302 ke presigned URL ber-TTL 3600 (`download.ts:7,36`). | P2 dikoreksi: temuan dipersempit ke reward HTML + redirect gambar; rekomendasi "immutable max-age panjang" dibatalkan. |
| 3 | P2: semua `Cache-Control` lain adalah `no-store` pada respons auth sensitif. | Terkonfirmasi (25+ kemunculan di `src/pages/admin/api/**` + `api/timer-token.ts:34`, `api/subscribe.ts:34`, `api/click`, `api/unsubscribe*`, `api/webhooks/emailit.ts:21`). | Diperkuat dengan daftar `file:line` lengkap. |
| 4 | P3: laporan = "3+ round-trip"; `campaignStats` + `progressOf` + count failed, "masing-masing agregat count(*) ke tabel recipient yang sama". | Aktual **~10 query serial**: guard `guard.ts:14`/`sessions.ts:26`, `crud.ts:131`, `campaignStats` 4 query (`stats.ts:40,49,63,69`), `progressOf` (`stats.ts:98`), failed (`laporan.astro:29`), `listRecipients` 2 query (`stats.ts:139,160`). `progressOf` duplikat `campaignStats`. | P3 dikoreksi angkanya; ditambah N2 (hapus `progressOf`). |
| 5 | Verifikasi #1: "`loadCampaignContent` … 3 query flat (campaign → locales → **assets/selections**)". | Fungsi ada di `src/lib/campaign.ts:38-81`, bukan `broadcast/content.ts`; 2 query flat (`:39,43`) + query on-demand `doa_template` (`:51,56`). Tidak ada "assets" di jalur ini. `listRecipients` (`stats.ts:131-166`) = 2 query tanpa loop — benar. | Klaim dilokasikan & dikoreksi; `listContacts` ditambahkan sebagai bukti tanpa N+1. |
| 6 | Verifikasi #2: "Semua kolom WHERE/JOIN berindeks". | **Tidak akurat.** Banyak index ada (didokumentasikan), tetapi `email_deliveries.campaign_recipient_id/contact_id/sent_at/email_type`, `email_outbox(status, scheduled_at)`, `email_campaigns.status`, `consent_event.contact_id`, `admin_audit_log.created_at` **belum berindeks**. | Daftar index lengkap ditulis ulang; ditambah temuan baru **N1**. |
| 7 | Verifikasi #3: "Laporan 50/halaman, **kontak 100/halaman**". | Laporan benar (`laporan.astro:40`). **Kontak = 20/halaman** (`admin/contacts/index.astro:15`). Audit = 50 (`admin/audit.astro:12`). | Nomor dikoreksi. Ditambah catatan ekspor CSV cap 50000 (`export.ts:32-34`). |
| 8 | Verifikasi #4: bundle nol-framework. | Terkonfirmasi (`package.json:20-29`; grep nol di `src/`). | Dipertahankan. |
| 9 | Verifikasi #5: font latin 3 bobot + swap. | Terkonfirmasi (`PublicLayout.astro:4-6`, `AdminLayout.astro:3-5`, `preview/[id].astro:13-15`; `font-display: swap` di `latin-400.css:5`). | Dipertahankan. |
| 10 | Verifikasi #6–#9, #11–#12: gambar eager, worker budget, outbox 20, dashboard `Promise.all`, pool max 5, timer rAF. | Terkonfirmasi (`RewardHero.astro:15-22`; `worker.ts:81-131`; `mailworker.ts:11-18`; `funnel.ts:49-58`; `db.ts:4`; `EmailForm.astro:109-143`). | Dipertahankan; ditambah catatan rAF ~60 fps dan 8 count dashboard tanpa cache. |
| 11 | Verifikasi #10: "62 route prerender = false … halaman statis (privacy, 404) tetap prerender". | 62 benar. **Privacy salah** — `src/pages/privacy.astro:4` & `src/pages/en/privacy.astro:4` = `prerender = false`. Prerender sebenarnya hanya 5: `index.astro`, `404.astro`, `admin/login.astro`, `admin/otp.astro`, `admin/reset.astro` (dikonfirmasi artefak `dist/client/**`). | Dikoreksi. |
| 12 | Label "Verdict tahap 7: LULUS". | Label tidak cocok nomor file audit. | Diganti menjadi **"Verdict audit 07: LULUS"**. |
| 13 | Ringkasan: "tidak ada `select *` lintas tabel besar tanpa batas". | `select()` tanpa kolom eksplisit dipakai (mis. `campaign.ts:15,22,33`; `download.ts:15,18,33`; `mailworker.ts:11`). Semua terbatas (1 baris atau `limit`), jadi klaim tetap benar — tetapi `getPublicCampaignState` over-fetch hanya untuk `status`. | Diberi catatan pada P1. |
