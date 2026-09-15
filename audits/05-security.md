# Audit 05 — Security

Tanggal: 2026-09-14
Lingkup: auth/session, crypto, rate limiting, XSS, injection, CSRF, secrets, upload, webhook, headers, privasi IP, inventarisasi method HTTP. Metode: read-only terhadap kode saat ini (grep + baca langsung), tanpa menjalankan test/build/server/DB dan tanpa perubahan kode selain file audit ini.

**Pernyataan metode:** audit ini **verifikasi statis berbasis kode**, BUKAN penetration test. Tidak ada eksploitasi, fuzzing, atau serangan nyata ke layanan mana pun. Setiap klaim di bawah disertai `file:line` yang sudah diverifikasi ulang pada revisi ini.

## Ringkasan

Postur keamanan **kuat untuk MVP**. Verifikasi ulang mengonfirmasi hampir semua klaim lama: Argon2id + syarat 12 karakter + huruf + angka (`src/lib/admin/password.ts:11-15`); OTP 6 digit `randomInt`, di-hash, TTL 10 menit, cap 5 percobaan atomik di klausa WHERE (`src/lib/admin/otp.ts:9-10,17,42-63`); token HMAC-SHA256 timing-safe (`src/lib/crypto.ts:17-30,40-42`); raw token tidak pernah disimpan (semua tabel menyimpan hash — `src/lib/schema.ts:9,78,137,147,157,226`); sesi HttpOnly + SameSite=Lax + Secure saat HTTPS dengan rotasi saat login dan pencabutan total saat ganti password (`src/lib/admin/sessions.ts:10-12,46-50`); sanitasi HTML allowlist ketat hanya `https:` + `noopener` (`src/lib/broadcast/content.ts:25,34-51`); CSP global + HSTS produksi (`src/middleware.ts:18-19,32-34`); IP disimpan sebagai hash bersalt (`src/lib/ratelimit.ts:6-8`, `src/lib/admin/audit.ts:14`); `.env` di-ignore dan tidak ada di riwayat git; respons auth generik anti-enumerasi (`src/lib/admin/login.ts:24-25,45-49`).

Koreksi utama hasil audit ulang:
- **S1 (CSRF)** — klaim lama "tanpa cek Origin/Referer" **tetap benar** (`grep -riE "origin|referer|csrf"` tidak menemukan cek di kode), tetapi **dampaknya dulu dinyatakan terlalu tinggi**. Vektor yang tersisa sempit: semua mutasi memakai POST/PATCH/DELETE dan pertahanan utama adalah `SameSite=Lax` (`src/lib/admin/sessions.ts:11`) yang memblokir POST cross-site. Sebagian besar API admin juga mem-parse `application/json` (`request.json()`), sehingga form cross-site sederhana gagal — namun **bukan semua**: upload asset menerima `multipart/form-data` (`src/pages/admin/api/campaigns/[id]/assets.ts:68`), jadi content-type bukan penghalang universal dan `Lax` tetap lapis utama. Status diturunkan menjadi **MINOR / defense-in-depth**.
- **S2 (shared secret)** — klaim lama menyebut secret cron "dapat dikirim via query/header". Faktanya **hanya via header** (`Authorization: Bearer` atau `x-cron-secret`, `src/lib/cron-auth.ts:9-13`); tidak ada jalur query. Perbandingan cron memakai `===` (**bukan** timing-safe), sedangkan webhook memang timing-safe (`src/lib/broadcast/webhooks.ts:23`). Webhook **tidak** memverifikasi timestamp/toleransi replay, tetapi idempotensi unique `(providerMessageId, eventType)` membuat replay tidak berefek (`src/lib/schema.ts:257`, `src/lib/broadcast/webhooks.ts:50-60`).
- **S3 (TEST_TIMER_MS)** — klaim lama **terkonfirmasi**. Baca runtime hanya bila non-PROD (`src/lib/timer.ts:10-15`); nilai render ditentukan saat build (`astro.config.mjs:9,18`).
- **S4 (BARU)** — parsing `X-Forwarded-For` **tidak konsisten**: helper bersama mengambil hop **terakhir** (`src/lib/ip.ts:16-17`), tetapi banyak route admin mengambil hop **pertama** yang bisa dipalsukan klien (`src/pages/admin/api/otp.ts:34`, `src/pages/admin/api/password/request.ts:26`, `src/pages/admin/api/campaigns/[id]/assets.ts:22`, `src/pages/admin/api/domains.ts:32`, dan route admin lain). Akibatnya `ipHash` di audit log dapat dipalsukan dan rate limit reset password per-IP dapat dilewati (bucket per-email tetap menahan).
- **S5 (BARU, trivial)** — `contacts.unsubscribeTokenHash` dideklarasikan (`src/lib/schema.ts:9`) tetapi **tidak dipakai di mana pun** (jalur unsubscribe memakai `emailCampaignRecipients.clickTokenHash`); `ADMIN_PASSWORD` dibaca langsung dari `process.env` melewati `env()` (`src/lib/admin/bootstrap.ts:33`).

**Verdict audit 05: LULUS BERSYARAT** — tidak ada kerentanan langsung yang terbuka, tetapi S1 (lapis kedua CSRF), S4 (konsistensi IP/rate-limit), dan prosedur rotasi secret S2 layak ditutup sebelum launch. Semua murah dan tanpa perubahan UX.

## Temuan

### S1 — Tidak ada proteksi CSRF eksplisit pada mutasi ber-cookie
- Status: **MINOR / defense-in-depth.**
- Bukti: cookie sesi memakai `SameSite=Lax` (`src/lib/admin/sessions.ts:11`). Tidak ada token CSRF dan tidak ada cek `Origin`/`Referer` — pencarian `origin|referer|csrf|xsrf` di `src/` hanya menemukan header `Referrer-Policy` (`src/middleware.ts:29-30`), bukan penegakan same-origin.
- Koreksi atas klaim lama: audit lama menulis "navigasi GET top-level tetap membawa cookie" sebagai vektor. Vektor itu **tidak berlaku** untuk mutasi karena tidak ada route admin yang mengubah state via GET (lihat area 15) dan seluruh endpoint mutasi hanya menerima POST/PATCH/DELETE. Sebagian besar endpoint admin mem-parse `application/json` sehingga form cross-site sederhana gagal, tetapi upload asset menerima `multipart/form-data` (`src/pages/admin/api/campaigns/[id]/assets.ts:68`) — untuk endpoint itu hanya `SameSite=Lax` yang menahan. Yang tersisa adalah serangan same-site/subdomain, browser yang mengabaikan `SameSite`, atau kerentanan subdomain. Karena itu pertahanan berlapis tetap disarankan, tetapi ini bukan celah yang dapat dieksploitasi langsung dari origin asing pada browser modern.
- Dampak: rendah. Menghilangkan lapis kedua bila `SameSite` di-fallback oleh browser lawas atau bila ada kerentanan subdomain.
- Rekomendasi: tambah cek `Origin`/`Referer` same-origin pada semua handler mutasi admin (murah, tanpa perubahan UX). Pertahankan `SameSite=Lax`.

### S2 — Keamanan endpoint cron/webhook bertumpu pada shared secret
- Status: **MINOR / disiplin ops.**
- Bukti: `cronAuthorized` menerima `x-cron-secret` atau `Authorization: Bearer` dari `CRON_SECRET` (`src/lib/cron-auth.ts:9-13`); webhook HMAC-SHA256 hex atas raw body dengan `EMAILIT_WEBHOOK_SECRET` dan `timingSafeEqual` + guard panjang (`src/lib/broadcast/webhooks.ts:15-24`). Dipakai di `src/pages/api/cron/outbox.ts:9` dan `src/pages/api/cron/broadcast.ts:14`.
- Koreksi atas klaim lama: (a) tidak ada jalur pengiriman secret via query — hanya header; (b) perbandingan cron memakai `===` sehingga **tidak timing-safe** (webhook timing-safe); (c) webhook **tidak** memverifikasi timestamp/toleransi replay, tetapi replay aman secara efektif karena `email_provider_events` unik per `(providerMessageId, eventType)` (`src/lib/schema.ts:257`) → duplikat menjadi `"ignored"` (`src/lib/broadcast/webhooks.ts:50-60`).
- Dampak: bila secret bocor (log, CI, dashboard), penyerang dapat memicu pengiriman atau memalsukan event. Inheren pada shared-secret, bukan bug.
- Rekomendasi: rotasi secret berkala, batasi IP sumber di reverse proxy bila mungkin, monitor pemanggilan cron ganda. Opsional: ganti `===` di `cron-auth.ts` dengan `timingSafeEqual` guard panjang agar konsisten.

### S3 — Override timer via env dibaca saat runtime
- Status: **MINOR (terkonfirmasi).**
- Bukti: `src/lib/timer.ts:10-15` menghitung `MIN_AGE_MS` dari `process.env.TEST_TIMER_MS` saat runtime, dengan guard `import.meta.env.PROD || NODE_ENV === "production"` → selalu 30 detik di produksi. Nilai yang dirender halaman ditentukan saat build via `vite.define` (`astro.config.mjs:9,18`).
- Dampak: operator yang keliru menyetel `TEST_TIMER_MS` di staging/dev melemahkan timer di lingkungan itu; produksi aman.
- Rekomendasi: dokumentasikan larangan `TEST_TIMER_MS` di env produksi, atau batasi pembacaan hanya saat `!PROD && TEST` eksplisit.

### S4 (BARU) — Parsing X-Forwarded-For tidak konsisten; IP audit/rate-limit dapat dipalsukan
- Status: **MINOR.**
- Bukti: helper bersama mengambil elemen **terakhir** `X-Forwarded-For` dengan asumsi satu trusted proxy (`src/lib/ip.ts:13-20`), dan dipakai di login + rate limit publik (`src/pages/admin/api/login.ts:29`, `src/pages/api/subscribe.ts:54`, `src/pages/api/timer-token.ts:19`, `src/pages/api/download/[session]/[assetId].ts:15`, `src/pages/api/unsubscribe/[token].ts:19`, `src/pages/api/webhooks/emailit.ts:43`). Namun banyak route admin mengambil elemen **pertama** `[0]` yang ditambahkan klien dan bisa dipalsukan: `src/pages/admin/api/otp.ts:34` (dipakai `completeLogin` → `audit(..., ip)`), `src/pages/admin/api/password/request.ts:26` (**dipakai sebagai identitas rate limit `admin-reset-ip`**), `src/pages/admin/api/campaigns/[id]/assets.ts:21-23`, `src/pages/admin/api/domains.ts:32`, `src/pages/admin/api/campaigns/[id]/status.ts:37`, `src/pages/admin/api/campaigns/[id]/doa.ts:35`, `src/pages/admin/api/campaigns/index.ts:33`, `src/pages/admin/api/campaigns/[id].ts:79`, `src/pages/admin/api/email-campaigns/index.ts:22`, `src/pages/admin/api/email-campaigns/[id].ts:87`, dan endpoint email-campaign lain (`cancel.ts:22`, `pause.ts:20`, `resume.ts:20`, `retry-failed.ts:23`, `schedule.ts:43`, `test-send.ts:38`), `contacts/[id]/anonymize.ts:29`, `contacts/export.ts:41`.
- Dampak: (a) `ipHash` audit log dapat dipalsukan dengan header hop pertama, melemahkan integritas audit trail; (b) rate limit `admin-reset-ip` (5/jam) dapat dilewati per-IP. Dampak dibatasi karena bucket `admin-reset-email` tetap 5/jam per email dan `ADMIN_EMAIL` tunggal; login admin sendiri memakai `clientIp` yang benar sehingga tidak bisa dilewati dengan cara ini.
- Rekomendasi: satukan semua ekstraksi IP ke `clientIp()` (`src/lib/ip.ts`) dan hapus pemakaian `x-forwarded-for.split(",")[0]` di route admin.

### S5 (BARU, trivial) — Sisa kecil hygiene
- Status: **TRIVIAL.**
- Bukti: (a) `contacts.unsubscribeTokenHash` dideklarasikan unik (`src/lib/schema.ts:9`) tetapi tidak pernah ditulis/dibaca di `src/` (jalur unsubscribe memakai `emailCampaignRecipients.clickTokenHash`, `src/lib/schema.ts:226` & `src/lib/broadcast/unsubscribe.ts:21-30`) — kolom mati, berpotensi menyesatkan; (b) `ADMIN_PASSWORD` dibaca via `process.env.ADMIN_PASSWORD` langsung di bootstrap, melewati `env()` (`src/lib/admin/bootstrap.ts:33`).
- Dampak: tidak ada kerentanan langsung; kebersihan skema/konsistensi konfigurasi.
- Rekomendasi: hapus kolom mati atau dokumentasikan cadangannya; gunakan `env("ADMIN_PASSWORD")` opsional bila memang dibutuhkan.

## Verifikasi per area (yang terkonfirmasi)

1. **Password.** Argon2id via `@node-rs/argon2` (`src/lib/admin/password.ts:1-8`), hash di DB (`src/lib/schema.ts:130`), syarat min 12 + huruf + angka (`src/lib/admin/password.ts:11-15`), reset via OTP (bukan link token panjang), ganti password mencabut semua sesi + device (`src/lib/admin/login.ts:82-89`).
2. **OTP.** 6 digit `randomInt` (`src/lib/admin/otp.ts:17`), hash disimpan (`:19`), TTL 10 menit (`:9`), cap 5 percobaan ditegakkan atomik di klausa WHERE (`:42-50, :55-63`), konsumsi sekali pakai (`:37`).
3. **Anti-enumerasi.** Email tak dikenal diverifikasi terhadap dummy hash (`src/lib/admin/login.ts:24-25,45`), respons login/reset generik (`:46-50`, `:107,110`), password-reset tanpa `challengeId` untuk non-admin (`:132`).
4. **Sesi.** Token opaque 32 byte (`src/lib/crypto.ts:32-34`), hash di DB (`src/lib/admin/sessions.ts:19`), TTL 12 jam default dari env (`:16`), `HttpOnly; SameSite=Lax; Secure` saat HTTPS (`:10-12`; pemasangan `src/pages/admin/api/otp.ts:42-46`), rotasi saat login (`src/lib/admin/login.ts:69`), revoke per-sesi & global (`src/lib/admin/sessions.ts:40-50`).
5. **Token HMAC.** `packToken/unpackToken` HMAC-SHA256 + `timingSafeEqual` dengan guard panjang (`src/lib/crypto.ts:8-30`); dipakai timer (`src/lib/timer.ts:19-34`).
6. **Raw token tak disimpan.** Hash/unik di DB: access token (`src/lib/schema.ts:78`), sesi admin (`:137`), OTP challenge (`:147`), device tepercaya (`:157`), click token (`:226`), unsubscribe hash (`:9`). Panjang varchar 64 = SHA-256 hex (`src/lib/crypto.ts:40-42`).
7. **XSS tersanitasi.** Konten broadcast: allowlist tag (`src/lib/broadcast/content.ts:25`), hanya skema `https:` (`:38`), `target=_blank rel=noopener` dipaksa (`:40-48`); template email memakai `escapeHtml` (`src/lib/templates.ts:10-14`, `:73`). Semua pemakaian `set:html` (`RewardItemList.astro:25`, `pages/404.astro:4` via `src/lib/notfound.ts:10`, ikon status admin `campaigns/index.astro:39`, `email-campaigns/index.astro:45`, `email-campaigns/[id]/laporan.astro:86,95,112`) berasal dari **konstanta internal**, bukan input pengguna.
8. **Injection.** Query via Drizzle ORM; `sql` template hanya untuk agregat/count dengan parameter terikat (`src/lib/ratelimit.ts:14-19`, `src/lib/admin/audit.ts:42`, `src/lib/admin/contacts.ts:96,126-127`); tidak ditemukan interpolasi string ke SQL. LIKE/ILIKE di-escape (`src/lib/admin/contacts.ts:62-64,80`). CSV escape formula injection `= + - @` (`src/lib/admin/contacts.ts:226-233`).
9. **Upload.** MIME allowlist 8 tipe (`src/lib/storage.ts:4-13`) + cek ekstensi-vs-MIME (`src/lib/admin/assets.ts:21-45`) + batas 100 MB (`src/lib/storage.ts:14`) divalidasi di application layer sebelum `putObject` (`src/lib/admin/assets.ts:64-75`); pre-check `Content-Length` sebelum buffer body (`src/pages/admin/api/campaigns/[id]/assets.ts:61-64`). Storage key = `rewards/<uuid>/<uuid>-<sanitized>` (`src/lib/admin/assets.ts:74`) dan `putObject`/`presignDownloadUrl` menolak `..`/leading `/` (`src/lib/storage.ts:26,46`).
10. **Webhook.** HMAC hex raw body + timing-safe (`src/lib/broadcast/webhooks.ts:15-24`, `src/pages/api/webhooks/emailit.ts:26-30`); insert idempoten unique `(provider_message_id, event_type)` (`src/lib/schema.ts:257`, `src/lib/broadcast/webhooks.ts:50-60`); guard status terminal (`:26-29,111-119`); event tak dikenal disimpan sebagai audit (`:120-123`). GET ke route webhook → 405 (`src/pages/api/webhooks/emailit.ts:58`).
11. **Rate limit.** Default dari env **hanya** untuk subscribe: IP 10/jam, email 5/jam (`src/lib/subscribe.ts:44-47`). **Koreksi klaim lama ("semua dari env"):** login admin 10/jam per IP & email, reset 5/jam per IP & email adalah **konstanta kode**, bukan env (`src/lib/admin/login.ts:13-14,38-39,105-106`). Bucket lain juga konstanta: timer-token 60/jam (`src/pages/api/timer-token.ts:19`), download 30/jam (`src/pages/api/download/[session]/[assetId].ts:15`), unsubscribe/resubscribe 30/jam (`src/pages/api/unsubscribe/[token].ts:19`, `src/pages/api/unsubscribe/resubscribe.ts:19`), webhook 600 per message_id/IP (`src/pages/api/webhooks/emailit.ts:44`), retry broadcast 3 (`src/lib/broadcast/stats.ts:193`). Semuanya diberi default waras, hanya saja sumbernya bukan env.
12. **Privasi IP.** `hashIp` = SHA-256(`IP_HASH_SALT:ip`) (`src/lib/ratelimit.ts:6-8`); audit log menyimpan `ipHash`, bukan IP mentah (`src/lib/admin/audit.ts:4,14`, `src/lib/schema.ts:169`); kunci rate limit memakai hash. Catatan: untuk route admin, IP sumber hash itu bisa dipalsukan (lihat S4).
13. **Headers.** CSP global dengan `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` (`src/middleware.ts:18-19`); pengecualian preview email `frame-ancestors 'self'` diset per-route (`src/pages/admin/api/email-campaigns/[id]/preview.ts:71`) dan tidak tertimpa karena helper hanya menyetel header yang belum ada (`src/middleware.ts:22-25`); `X-Content-Type-Options: nosniff` (`:26-28`); `Referrer-Policy: strict-origin-when-cross-origin` (`:29-31`); HSTS hanya produksi (`:32-34`, dipanggil dengan `import.meta.env.PROD` di `:39`). `Cache-Control: no-store` pada respons auth sensitif (mis. `src/pages/admin/api/login.ts:7`, `otp.ts:7`, `logout.ts:7`).
14. **Secrets hygiene.** `.env` + `.env.production` di `.gitignore`; `git ls-files` hanya memuat `.env.example`; riwayat git tidak memuat `.env`. `env()` melempar `Missing env: <name>` bila wajib hilang tanpa fallback (`src/lib/env.ts:1-6`), sehingga gagal cepat (mis. `TOKEN_SECRET`, `DATABASE_URL`, `CRON_SECRET`, `EMAILIT_WEBHOOK_SECRET`, `IP_HASH_SALT`). Contoh env tersedia tanpa nilai rahasia (`<nilai>` placeholder).
15. **Tidak ada mutasi state via GET (dengan pengecualian terdokumentasi).** Semua endpoint mutasi admin memakai POST/PATCH/DELETE. Tiga GET yang menyentuh state: (a) unsubscribe satu-klik (`src/pages/api/unsubscribe/[token].ts:16-39`) — disyaratkan standar one-click dan idempoten (`src/lib/broadcast/unsubscribe.ts:41-75`); (b) click tracking (`src/pages/api/click/[linkId]/[token].ts:13-22`) — mencatat `clickedAt` idempoten via `coalesce` (`src/lib/broadcast/links.ts:34-37`); (c) cron (`src/pages/api/cron/outbox.ts:8-14`, `broadcast.ts:13-19`) — GET terotentikasi `cronAuthorized`. Ketiganya sesuai desain; dicatat eksplisit agar inventaris akurat.
16. **Audit trail.** Aksi admin sensitif ter-audit (`login_failed`, `password_ok`, `otp_failed`, `login_success`, `device_trusted`, `password_reset_requested/completed`, `contacts_exported`, `contact_anonymized`, `asset_*`, `domain_*`) dengan `ipHash` (`src/lib/admin/audit.ts:6-16`). Viewer read-only dengan limit ter-clamp (`:32-40`).

## Yang belum diuji pada tahap ini (bukan temuan)

- Penetration test runtime (session hijack, OTP brute-force aktual, upload polyglot, webhook replay, CSRF lintas-origin nyata).
- Review konfigurasi infrastruktur produksi (TLS, reverse proxy/trusted hop, firewall, backup) — masuk tahap 10.
- Verifikasi deliverability/SPF/DKIM/DMARC aktual — pra-syarat operasional PRD.
- Efektivitas `sanitize-html` versi terpasang terhadap CVE baru (hanya allowlist yang diverifikasi statis).

## Rekomendasi prioritas

1. Satukan ekstraksi IP admin ke `clientIp()`; hapus `x-forwarded-for.split(",")[0]` di route admin (S4) — menutup pemalsuan `ipHash` audit dan bypass rate limit reset per-IP.
2. Tambah cek `Origin`/`Referer` same-origin pada mutasi admin sebagai lapis kedua (S1).
3. Prosedur rotasi `CRON_SECRET`/`EMAILIT_WEBHOOK_SECRET` + pembatasan sumber bila mungkin (S2).
4. Dokumentasikan larangan `TEST_TIMER_MS` di produksi (S3).
5. Opsional konsistensi: `timingSafeEqual` di `cron-auth.ts`; bersihkan kolom `unsubscribeTokenHash` yang tak terpakai (S5).

## Catatan revisi audit ulang

Tabel klaim lama → hasil verifikasi → tindakan (bukti `file:line`).

| Klaim lama | Hasil verifikasi | Tindakan |
|---|---|---|
| S1: hanya `SameSite=Lax`, tanpa cek Origin/Referer, vektor GET top-level berbahaya | BENAR tanpa cek Origin/Referer (`grep` bersih; hanya `Referrer-Policy` di `src/middleware.ts:29-30`). Namun vektor GET **tidak berlaku**: tak ada mutasi admin via GET dan API admin butuh JSON; `SameSite=Lax` (`src/lib/admin/sessions.ts:11`) memblokir POST cross-site | Status diturunkan ke MINOR/defense-in-depth; teks vektor dikoreksi; rekomendasi dipertahankan |
| S2: secret cron "dapat dikirim via query/header biasa" | SALAH pada bagian query — hanya header (`src/lib/cron-auth.ts:9-13`) | Dikoreksi; ditambah catatan cron `===` non-timing-safe dan webhook tanpa timestamp tapi idempoten (`src/lib/schema.ts:257`) |
| S2: webhook HMAC timing-safe | BENAR (`src/lib/broadcast/webhooks.ts:15-24`, timingSafeEqual di `:23`) | Dipertahankan; ditambah detail replay |
| S3: `TEST_TIMER_MS` dibaca runtime, produksi aman guard PROD | BENAR (`src/lib/timer.ts:10-15`; build-time `astro.config.mjs:9,18`) | Status tetap MINOR |
| Ringkasan: "perbandingan timing-safe" untuk cron | SALAH (hanya webhook) | Dikoreksi di S2 |
| #11: "Rate limit ... semua dari env dengan default waras" | SALAH untuk mayoritas — hanya subscribe dari env (`src/lib/subscribe.ts:44-47`); login/reset/timer/download/unsub/webhook/retry adalah konstanta (`src/lib/admin/login.ts:13-14`; `src/pages/api/timer-token.ts:19`; `src/pages/api/download/[session]/[assetId].ts:15`; `src/pages/api/unsubscribe/[token].ts:19`; `src/pages/api/webhooks/emailit.ts:44`; `src/lib/broadcast/stats.ts:193`) | Dikoreksi di area 11 |
| #15: "semua state-changing memakai POST/PATCH/DELETE", GET hanya baca/tracking/cron | SEBAGIAN — GET tracking klik (`src/pages/api/click/[linkId]/[token].ts:13-22`) dan unsubscribe (`src/pages/api/unsubscribe/[token].ts:16-39`) memang menyentuh state; keduanya idempoten & sesuai desain | Dikoreksi jadi pengecualian eksplisit |
| #6 "raw token tak disimpan" | BENAR (`src/lib/schema.ts:9,78,137,147,157,226`) | Dipertahankan dengan nomor baris |
| #13 CSP/HSTS/headers | BENAR (`src/middleware.ts:18-19,26-34`; `src/pages/admin/api/email-campaigns/[id]/preview.ts:71`) | Dipertahankan |
| #14 `env()` melempar; `.env` tak di git | BENAR (`src/lib/env.ts:1-6`; `.gitignore`; `git ls-files` hanya `.env.example`) | Dipertahankan; ditambah catatan `ADMIN_PASSWORD` via `process.env` (`src/lib/admin/bootstrap.ts:33`) |
| Label "Verdict tahap 5" | Tidak cocok dengan nomor file | Diubah menjadi **"Verdict audit 05"** |

**Sinkronisasi dengan audit 13.** Versi lama register di `audits/13-prd-compliance.md` (sebelum revisi) menyebut `S6 (custody copy)` dan `S2 (OTP wording)`. **ID tersebut tidak ada di audit 05 ini**: audit 05 hanya punya **S1** (CSRF), **S2** (shared secret cron/webhook), **S3** (TEST_TIMER_MS), ditambah **S4** (X-Forwarded-For) dan **S5** (trivia) hasil revisi. Tidak ditemukan temuan "custody copy" maupun "OTP wording" di kode saat ini (teks OTP: `src/lib/templates.ts:92-100`, dan tidak ada mekanisme custody copy di sumber). **Ketidakcocokan ini sudah ditutup:** register di `audits/13-prd-compliance.md` (versi revisi) kini memakai ID asli audit 05 (S1–S5) dan mencatat ID lama sebagai fiktif.
