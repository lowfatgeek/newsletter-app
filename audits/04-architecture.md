# Audit 04 — Architecture

Tanggal: 2026-09-14 (revisi audit ulang: 2026-09-14)
Lingkup: separation of concern, state management, API layer, database design. Metode: read-only. Tidak ada perubahan kode.

## Ringkasan

Arsitektur **masuk akal dan konsisten** untuk skala single-tenant MVP. Lapisan tegas: `src/lib/*` logika bisnis murni (nol import Astro, terverifikasi: `grep "from \"astro" src/lib/` = 0 hasil) → Astro pages/endpoints sebagai pipa tipis → Postgres sebagai source of truth → worker/cron idempoten untuk pengiriman. Tidak ada SPA store (SSR-first, tepat untuk produk ini — `package.json:22-30` tidak memuat zustand/nanostores). Transaksi dipakai di titik kritis (konfirmasi, unsubscribe, slug change, duplikasi, anonimisasi). Queue berbasis tabel dengan dua jalur terpisah (outbox transaksional + recipient broadcast).

Tiga temuan lama tetap berlaku dengan satu **koreksi penting**: A1 benar bahwa invariant single-`sending` tidak punya penegakan struktural (partial unique index), tetapi **bukan** "hanya dijaga timing" — guard-nya memang SQL level-DB dan atomik satu statement; sisa risiko nyata adalah dua UPDATE konkuren pada dua campaign berbeda yang sama-sama lolos `NOT EXISTS` di bawah READ COMMITTED. A2 (pool `max: 5` tanpa catatan kapasitas) dan A3 (kolom `status` varchar tanpa CHECK/enum) tetap minor.

Revisi ini menambahkan tiga temuan nyata: N1 klaim "tidak ada SQL di pages" **salah** (13 file halaman mengimpor `db`/`drizzle-orm`, termasuk SQL mentah), N2 klaim "tidak ada HTML di lib kecuali `templates.ts`" **salah** (`notfound.ts`, `broadcast/content.ts`), dan N3 tidak ada ordering literal untuk AC PRD §12 (dua cron independen; drain best-effort hanya di jalur subscribe, tidak di OTP).

**Verdict audit 04: LULUS BERSYARAT** — A1 disarankan ditutup sebelum launch (uji race atau partial unique index); N3 layak ditutup/diuji karena menyentuh AC PRD §12; A2/A3 serta N1/N2 dokumentasi atau backlog.

## Temuan

### A1 — Invariant single-`sending` tanpa penegakan struktural (partial unique index)
- Status: **UTAMA (arsitektur).** Duplikat sengaja dari F2 audit 01 (`audits/01-functional-correctness.md:32-38`) — sudut pandang berbeda: F2 soal kebenaran fungsional, A1 soal jaminan arsitektur.
- Bukti: `claimForSending` — `src/lib/broadcast/machine.ts:144-154`. Guard memang **SQL level-DB dan atomik dalam satu statement**:
  - `UPDATE email_campaigns SET status='sending' ... WHERE id = $campaignId AND status='queued' AND NOT EXISTS (select 1 from email_campaigns ec where ec.status='sending' and ec.id <> $campaignId) RETURNING id` (`machine.ts:145-152`, klausa `NOT EXISTS` di `machine.ts:150`).
  - Untuk campaign yang **sama**, dua worker konkuren hanya satu menang (row lock + predikat `status='queued'`). Klaim ulang campaign yang sudah `sending` → `false` lewat `status='queued'`, bukan lewat guard.
- **Koreksi klaim lama:** pernyataan versi lama ("tidak dijamin di level DB / dijamin hanya oleh timing") **tidak akurat**. Guard-nya level DB. Yang benar: **belum ada partial unique index** `WHERE status='sending'` — `grep "sending" drizzle/*.sql` = 0 hasil, dan `src/lib/schema.ts:200-217` tidak mendeklarasikan index parsial (hanya index unik untuk slug/claim/token, lihat `schema.ts:48,72,97,229,257`). Tidak ada pula isolasi SERIALIZABLE (`grep -ri "serializable|isolation" src/ drizzle/` = 0).
- Sisa risiko nyata: dua `UPDATE` konkuren pada **dua campaign berbeda** dapat sama-sama lolos `NOT EXISTS` karena masing-masing tidak melihat baris `sending` yang belum di-commit milik transaksi lain (READ COMMITTED, default Postgres). Ini bukan "tanpa guard", melainkan celah balapan lintas-campaign.
- Komentar worker menyatakan advisory lock eksplisit dianggap tidak perlu karena klaim atomic — `src/lib/broadcast/worker.ts:11-17` ("SINGLE-FLIGHT: `claimForSending` ... adalah satu-satunya mekanisme mutual exclusion ... sehingga advisory lock tidak diperlukan").
- Dampak: probabilitas rendah (cron 1 menit, satu batch per tick — `vercel.json`, `worker.ts:73-81`), tetapi invariant PRD §7.4 dijaga oleh guard aplikatif tanpa jaring pengaman struktural.
- Rekomendasi: partial unique index (`CREATE UNIQUE INDEX ... ON email_campaigns ((1)) WHERE status='sending'`) atau kolom `sending_lock` + advisory lock di worker, plus uji konkurensi. Sama dengan F2 audit 01.

### A2 — Pool koneksi `max: 5` tanpa catatan kapasitas
- Status: **MINOR (dokumentasi/ops).**
- Bukti: `src/lib/db.ts:4` — `postgres(env("DATABASE_URL"), { max: 5 })`. Satu pool global (module-level) dipakai server SSR, kedua cron (`src/pages/api/cron/outbox.ts:12`, `src/pages/api/cron/broadcast.ts:17`), dan CLI (`scripts/seed.ts`, `scripts/migrate.ts`, `scripts/bootstrap-admin.ts` via `src/lib/db`).
- Catatan dokumentasi: **tidak ada** perhitungan kapasitas pool di `README.md`, `docs/operations.md`, atau `docs/deploy.md`. Yang ada hanya (a) rekomendasi memakai Neon **pooled URL** untuk runtime + direct URL untuk migrasi (`README.md:79`, `README.md:84`, `docs/deploy.md:262-263`) — mitigasi parsial, dan (b) §7 `docs/operations.md:312-330` yang membahas kapasitas **Emailit**, bukan pool DB. Jadi klaim A2 tetap akurat.
- Dampak: di serverless (banyak instance × 5 koneksi) atau saat worker broadcast menahan koneksi lama, pool bisa jenuh. Untuk trafik MVP kemungkinan aman, tetapi tidak ada catatan perhitungan.
- Rekomendasi: dokumentasikan asumsi (satu instance Node standalone, bukan serverless scale-to-many) di README/ops, atau turunkan risiko dengan pooler (PgBouncer/Neon pooled URL) bila deploy ke Vercel.

### A3 — Kolom status varchar tanpa check constraint
- Status: **MINOR (integritas data).**
- Bukti: semua kolom status berupa `varchar` dengan komentar daftar nilai, tanpa `CHECK`/`enum`:
  - `contacts.confirmationStatus` — `src/lib/schema.ts:7` (`pending | confirmed`).
  - `marketingSubscriptions.status` — `src/lib/schema.ts:15` (`inactive | active | unsubscribed`).
  - `rewardCampaigns.status` — `src/lib/schema.ts:31` (`draft | published | paused | archived`).
  - `rewardClaims.status` — `src/lib/schema.ts:69` (`access_sent | accessed`).
  - `emailOutbox.status` — `src/lib/schema.ts:113` (`pending | sent | failed`).
  - `emailCampaigns.status` — `src/lib/schema.ts:202` (`draft | scheduled | queued | sending | completed | paused | cancelled | failed`).
  - `emailCampaignRecipients.status` — `src/lib/schema.ts:224` (`pending | sent | failed | cancelled`).
  - `emailDeliveries.status` — `src/lib/schema.ts:237` (`accepted | sent | delivered | bounced | failed | suppressed`). **Tambahan revisi:** versi lama melewatkan kolom ini.
- Migrasi SQL juga hanya `varchar(...) ... NOT NULL` tanpa `CONSTRAINT ... CHECK`: `drizzle/0000_rare_risque.sql:23,58,69,110,121`, `drizzle/0003_careless_matthew_murdock.sql:6,16,39`. Tidak ada definisi `enum`/`CHECK` untuk status di seluruh `drizzle/*.sql`.
- Dampak: typo atau bug dapat menulis status invalid yang tidak dikenali state machine (mis. campaign berstatus `sendnig` hilang dari semua query). Validasi ada di application layer (`src/lib/broadcast/machine.ts`, `validateSlug`, dsb.) tetapi DB tidak menjadi jaring pengaman terakhir.
- Rekomendasi: tambah `CHECK (status IN (...))` via migrasi untuk tabel inti (murah, tanpa perubahan kode). Backlog yang layak, bukan penghalang launch.

### N1 — Klaim "tidak ada SQL di pages" tidak benar (BARU)
- Status: **MINOR–SEDANG (separation of concern).**
- Bukti: 13 file di `src/pages/` mengimpor `db`/`drizzle-orm` dan menjalankan query langsung: `src/pages/admin/campaigns/[id].astro`, `src/pages/admin/campaigns/index.astro`, `src/pages/admin/contacts/index.astro`, `src/pages/admin/email-campaigns/index.astro`, `src/pages/admin/email-campaigns/[id].astro`, `src/pages/admin/email-campaigns/[id]/laporan.astro`, `src/pages/admin/preview/[id].astro`, `src/pages/akses/[token].astro`, `src/pages/en/akses/[token].astro`, `src/pages/api/health.ts`, `src/pages/api/subscribe.ts`, `src/pages/api/timer-token.ts`, `src/pages/api/sitemap.xml.ts`. Contoh SQL mentah: `src/pages/api/health.ts:10` (`db.execute(sql\`select 1\`)`) dan `src/pages/admin/email-campaigns/[id]/laporan.astro:32` (template `sql` untuk agregasi failed).
- Dampak: sebagian logika query/agregasi hidup di halaman, bukan seluruhnya di `src/lib/*`. Tidak fatal (tetap SSR, tetap teruji sebagian), tetapi melemahkan narasi "pages hanya pipa tipis" dan mempersulit unit-test logika tersebut.
- Rekomendasi: pindahkan query halaman yang mengandung logika (mis. agregasi laporan) ke `src/lib/*`; sisakan halaman sebagai pemanggil fungsi. Backlog.

### N2 — Klaim "tidak ada HTML di lib kecuali `templates.ts`" tidak benar (BARU)
- Status: **MINOR (dokumentasi/arsitektur).**
- Bukti: HTML juga ada di `src/lib/notfound.ts:10-80` (dokumen 404 lengkap + CSS inline, dipakai `src/pages/404.astro` dan `r/[slug].astro`) dan `src/lib/broadcast/content.ts:175` (pembungkus `<div>` preheader tersembunyi). `src/lib/templates.ts` memang pemilik mayoritas HTML email (`broadcastLayout`, `confirmationEmail`, `rewardAccessEmail`, `otpEmail`).
- Dampak: bukan pelanggaran serius — `notfound.ts` justru "sumber tunggal" yang disengaja (komentarnya menjelaskan alasan teknis Astro.rewrite), dan `content.ts:175` adalah bagian pipeline rendering email. Tetapi klaim audit lama perlu dikoreksi.
- Rekomendasi: tidak ada aksi kode; cukup koreksi klaim.

### N3 — Tidak ada ordering literal untuk prioritas transaksional (AC PRD §12) (BARU)
- Status: **MINOR–SEDANG (gap terhadap AC).**
- Bukti: AC PRD §12 — `.agents/kelaswfa-newsletter-prd-v2.md:551` ("Email konfirmasi/reward/OTP tetap diproses sebelum worker mengambil item broadcast berikutnya"); niat prioritas di `PRD:293`.
- Implementasi saat ini: dua cron **independen** berjalan tiap menit — `vercel.json` (`/api/cron/outbox` dan `/api/cron/broadcast`, keduanya `* * * * *`). Worker broadcast (`src/lib/broadcast/worker.ts:81`) sama sekali tidak menyentuh `email_outbox` (import `worker.ts:1-8` tidak memuat outbox), dan `processOutbox` (`src/lib/mailworker.ts:10-18`) tidak dipanggil dari worker broadcast. **Tidak ada** kode yang men-drain outbox sebelum tick broadcast.
- Satu-satunya "prioritas" bersifat struktural + best-effort: jalur subscribe (konfirmasi/akses reward) memicu `processOutbox()` best-effort setelah enqueue (`src/lib/subscribe.ts:85`, `src/lib/subscribe.ts:99`). Namun:
  - OTP (`src/lib/admin/otp.ts:22` lewat `issueOtpChallenge`) dan test-send broadcast (`src/lib/broadcast/stats.ts:296`) **tidak** memicu drain setelah enqueue → menunggu cron outbox berikutnya (hingga ~60 detik).
  - Outbox memang tabel terpisah dengan `idempotencyKey` unik + `FOR UPDATE SKIP LOCKED` (`src/lib/mailworker.ts:18`), jadi tidak "terblokir" broadcast; tetapi tidak ada jaminan urutan literal sebagaimana bunyi AC.
- Dampak: pada tick yang sama, broadcast bisa mengambil batch lebih dulu sebelum outbox diproses. Karena kapasitas provider dipakai bersama, ini berpotensi menunda email transaksional hingga satu interval cron.
- Rekomendasi: drain outbox di awal tick cron broadcast (panggil `processOutbox()` sebelum `processBroadcast()`), atau tambahkan drain best-effort pada `issueOtpChallenge` dan test-send; plus uji yang menegakkan AC §12.

### N4 — Cakupan transaksi anonimisasi tidak mencakup seluruh sekuen (BARU, minor)
- Status: **INFORMATIF (ketelitian klaim).**
- Bukti: `anonymizeContact` — `src/lib/admin/contacts.ts:288` membuka `db.transaction`, tetapi pemilihan `claimIds` dilakukan di luar transaksi (`contacts.ts:281-283`) dan pembersihan `marketing_subscriptions` juga di luar tx (dieksekusi sebelum blok tx). Yang atomik hanya delete `access_tokens` + update `contacts` (`contacts.ts:289-300`).
- Dampak: sangat kecil (operasi admin, satu arah), tetapi klaim "anonimisasi kontak — semua dalam `db.transaction`" perlu dipertegas menjadi "mutasi inti (token + kontak) atomik; pemilihan claim dan pembersihan subscription di luar tx".
- Rekomendasi: tidak ada aksi wajib; perjelas klaim/opsional pindahkan seluruh sekuen ke dalam tx.

## Verifikasi per area (yang terverifikasi)

1. **Separation of concern.** `src/lib/` murni (nol import Astro, terverifikasi grep = 0), tetapi dua klaim lama perlu dikoreksi: (a) **ada SQL di pages** — lihat N1 (13 file, termasuk SQL mentah `api/health.ts:10` dan `laporan.astro:32`); (b) **ada HTML di lib di luar `templates.ts`** — `notfound.ts:10-80` dan `broadcast/content.ts:175`, lihat N2. Yang tetap benar: `src/components/` presentasi, `src/middleware.ts` cross-cutting (security headers), dan `templates.ts` sebagai pemilik HTML email.
2. **State management.** Tepat guna: SSR-first, tanpa client store (`package.json:22-30`). State interaktif minimal (timer, tabs) hidup di script komponen terisolasi; state server di DB; sesi admin di cookie httpOnly + tabel (`src/lib/schema.ts:135-142`). Tidak ada kebutuhan Zustand/Nanostores untuk produk ini — penambahan akan menjadi over-engineering.
3. **API layer.** REST di bawah `/api/*` (publik) dan `/admin/api/*`. Terverifikasi: dari 24 file `src/pages/admin/api/**`, **tepat 5** tidak memakai `getAdmin` dan memang route auth publik (`login.ts`, `logout.ts`, `otp.ts`, `password/request.ts`, `password/confirm.ts`); sisanya 19 memakai `getAdmin`. Cron terotentikasi secret ganda (Bearer Vercel + `x-cron-secret` manual) — `src/lib/cron-auth.ts:10-14`. Webhook memverifikasi signature HMAC terhadap raw body **sebelum** parse JSON — `src/pages/api/webhooks/emailit.ts:30-34`.
4. **Desain queue.** Dua jalur terpisah sesuai PRD: `email_outbox` (transaksional, `idempotencyKey` unique `schema.ts:112`, attempts + backoff + `MAX_ATTEMPTS=5` `src/lib/mailworker.ts:7,40-51`, `FOR UPDATE SKIP LOCKED` `mailworker.ts:18`) dan `email_campaign_recipients` (snapshot per-recipient `schema.ts:219-229`, token klik unik `schema.ts:226`, status pending/sent/failed/cancelled `schema.ts:224`). **Terverifikasi:** worker broadcast tidak menyentuh outbox (`src/lib/broadcast/worker.ts:1-8,81`). **Koreksi:** "mailworker drain best-effort setelah enqueue" hanya berlaku di jalur subscribe (`subscribe.ts:85,99`); OTP (`otp.ts:22`) dan test-send (`stats.ts:296`) tidak drain — lihat N3.
5. **Transaksi di titik kritis.** Terverifikasi `db.transaction` di: konfirmasi token `src/lib/access.ts:77`; unsubscribe `src/lib/broadcast/unsubscribe.ts:45`; resubscribe `unsubscribe.ts:90`; ganti slug + redirect historis `src/lib/admin/campaigns.ts:131`; duplikasi campaign `campaigns.ts:219`; set doa selection `campaigns.ts:355`; anonimisasi kontak `src/lib/admin/contacts.ts:288` (dengan catatan cakupan di N4). Pola `DbExecutor` (db | tx) di `access.ts:10`/`unsubscribe.ts:14` memungkinkan komposisi yang rapi.
6. **Model kontak.** Satu email = satu kontak global (`emailNormalized` unique `schema.ts:5`), subscription terpisah (`marketingSubscriptions` PK `contactId` `schema.ts:14`), consent trail append-only (`consentEvents` `schema.ts:21-26`), claim unik per (contact, campaign) `schema.ts:72`. Desain ini tepat mendukung aturan "tanpa double opt-in ulang" (`src/lib/access.ts:90-99` tidak mengaktifkan ulang `unsubscribed`).
7. **Token discipline.** Raw token tidak pernah disimpan — hanya hash SHA-256 unique (`accessTokens.tokenHash` `schema.ts:78`, `adminSessions` `schema.ts:137`, `adminOtpChallenges.codeHash` `schema.ts:147`, `trustedDevices` `schema.ts:157`, `clickTokenHash` `schema.ts:226`); masa berlaku di `expiresAt`; sekali-pakai via `usedAt` + konsumsi atomik `UPDATE ... RETURNING` (`src/lib/access.ts:57-65`, `src/lib/admin/otp.ts:47-55`).
8. **Migrasi.** Drizzle (`drizzle/` + `scripts/migrate.ts:4` memakai `drizzle-orm/postgres-js/migrator`), **4 file migrasi** berurutan `0000_rare_risque` → `0003_careless_matthew_murdock` (cocok dengan `drizzle/meta/_journal.json`: 4 entri) — alur standar, bukan SQL manual lepas.
9. **Integrasi eksternal terisolasi.** `emailit.ts` (kirim), `storage.ts` (R2 presign), `email.ts` (normalisasi) masing-masing satu modul dengan batas jelas; `MOCK_R2`/`MOCK_EMAILIT`/`mailworker-for-test.ts` memisahkan test dari kredensial.
10. **i18n struktural.** Konten locale di tabel `reward_campaign_locale` (`schema.ts:39-48`) + kolom `_id`/`_en` (mis. `emailCampaigns.subjectId/subjectEn` `schema.ts:203-208`, `rewardAssets.nameId/nameEn` `schema.ts:54-55`), dengan unique `(campaignId, locale)` (`schema.ts:48`) — query dan fallback eksplisit per locale (`src/lib/broadcast/worker.ts:169-175`).

## Yang belum dinilai pada tahap ini

- Kapasitas/throughput aktual (masuk tahap 7 Performance).
- Backup/restore dan observability produksi (masuk tahap 10/13).
- Review migrasi SQL baris-per-baris (sampling skema Drizzle dianggap cukup untuk tahap ini).
- Uji race konkurensi `claimForSending` lintas-campaign (belum dijalankan pada audit ini).

## Rekomendasi prioritas

1. Tutup celah race single-`sending`: partial unique index `WHERE status='sending'` atau advisory lock, plus uji konkurensi lintas-campaign (A1 = F2).
2. Tegakkan AC PRD §12: drain outbox di awal tick broadcast dan/atau setelah enqueue OTP/test-send (N3).
3. Dokumentasikan asumsi pool koneksi vs target hosting (A2).
4. Tambah CHECK constraint status sebagai hardening data (A3, backlog).
5. Rapikan separation of concern: pindahkan query berlogika dari pages ke lib (N1); koreksi klaim HTML lib (N2, tanpa aksi kode).

## Catatan revisi audit ulang

Format: klaim lama → hasil verifikasi → tindakan.

1. **A1 "tidak dijamin di level DB / dijamin hanya oleh timing"** (versi lama, `audits/04-architecture.md:18-20`).
   → **Koreksi.** `claimForSending` adalah **satu statement UPDATE** dengan guard `NOT EXISTS` SQL-level, atomik (`src/lib/broadcast/machine.ts:145-152`, klausa di `machine.ts:150`). Komentar worker memang menyatakan advisory lock tidak diperlukan (`src/lib/broadcast/worker.ts:11-17`). Yang tidak ada adalah **partial unique index** (`grep "sending" drizzle/*.sql` = 0; `schema.ts:200-217` tanpa index parsial) dan isolasi SERIALIZABLE (grep = 0).
   → **Tindakan:** restate A1 sebagai "tanpa penegakan struktural; sisa risiko race lintas-campaign di READ COMMITTED". Status tetap UTAMA, tingkat keparahan diturunkan dari "tidak ada guard" menjadi "celah balapan sempit".

2. **A1/F2 duplikasi** (versi lama menyebut "Sama dengan F2 tahap 1").
   → **Terverifikasi.** F2 memang ada di `audits/01-functional-correctness.md:32-38`.
   → **Tindakan:** pertahankan sebagai duplikat sengaja dengan cross-reference eksplisit; diberi catatan sudut pandang arsitektur vs fungsional.

3. **A2 pool `max: 5` tanpa catatan kapasitas** (`src/lib/db.ts`).
   → **Terverifikasi akurat.** `src/lib/db.ts:4` `{ max: 5 }`; dipakai SSR + 2 cron + CLI; tidak ada perhitungan kapasitas pool di README/docs. Yang ada: rekomendasi Neon pooled URL (`README.md:79,84`; `docs/deploy.md:262-263`) dan §7 `docs/operations.md:312-330` soal Emailit (bukan DB).
   → **Tindakan:** dipertahankan MINOR, bukti dilengkapi.

4. **A3 kolom status tanpa CHECK/enum, daftar tabel** (versi lama `audits/04-architecture.md:30`).
   → **Terverifikasi akurat**, dengan tambahan `emailDeliveries.status`. Bukti baru: `schema.ts:7,15,31,69,113,202,224,237`; `drizzle/0000_rare_risque.sql:23,58,69,110,121`; `drizzle/0003_careless_matthew_murdock.sql:6,16,39`; tidak ada `CHECK`/`enum` di seluruh `drizzle/*.sql`.
   → **Tindakan:** dipertahankan MINOR, daftar bukti dilengkapi.

5. **"Transaksi di titik kritis: konfirmasi, unsubscribe/resubscribe, slug change, duplikasi, anonimisasi — semua dalam `db.transaction`"** (versi lama `audits/04-architecture.md:40`).
   → **Sebagian terverifikasi / perlu nuansa.** Semua tx ditemukan: `access.ts:77`, `unsubscribe.ts:45,90`, `campaigns.ts:131,219,355`, `contacts.ts:288`. Namun anonimisasi tidak seluruhnya di dalam tx (pemilihan `claimIds` di `contacts.ts:281-283` dan pembersihan subscription di luar blok `contacts.ts:288`).
   → **Tindakan:** klaim dipertegas; ditambah temuan N4.

6. **"Tidak ada SQL di pages"** (versi lama `audits/04-architecture.md:36`).
   → **SALAH.** 13 file `src/pages/` mengimpor `db`/`drizzle-orm`; ada SQL mentah di `src/pages/api/health.ts:10` dan `src/pages/admin/email-campaigns/[id]/laporan.astro:32`.
   → **Tindakan:** koreksi klaim; tambah temuan N1.

7. **"Tidak ada HTML di lib (kecuali builder email di `templates.ts`)"** (versi lama `audits/04-architecture.md:36`).
   → **SALAH.** HTML juga di `src/lib/notfound.ts:10-80` dan `src/lib/broadcast/content.ts:175`.
   → **Tindakan:** koreksi klaim; tambah temuan N2 (tanpa aksi kode).

8. **"4 file migrasi berurutan"** (versi lama `audits/04-architecture.md:43`).
   → **Terverifikasi.** `drizzle/0000_rare_risque.sql` … `0003_careless_matthew_murdock.sql` (4 file) + `drizzle/meta/_journal.json` 4 entri; `scripts/migrate.ts:4`.
   → **Tindakan:** dipertahankan, bukti ditambah.

9. **"Dua jalur queue terpisah; worker broadcast tidak menyentuh outbox; mailworker drain best-effort setelah enqueue"** (versi lama `audits/04-architecture.md:39`).
   → **Sebagian terverifikasi.** Worker broadcast memang tidak menyentuh outbox (`src/lib/broadcast/worker.ts:1-8,81`; `mailworker.ts:10-18`). Tetapi drain best-effort **hanya** di `subscribe.ts:85,99`; OTP (`otp.ts:22`) dan test-send (`stats.ts:296`) tidak drain. Tidak ada ordering literal untuk AC PRD §12 (`PRD:551`) — dua cron independen di `vercel.json`.
   → **Tindakan:** koreksi nuansa; tambah temuan N3.

10. **Label verdict "Verdict tahap 4"** (versi lama `audits/04-architecture.md:12`).
    → **Tidak konsisten** dengan nomor file.
    → **Tindakan:** diubah menjadi **"Verdict audit 04"** (LULUS BERSYARAT).
