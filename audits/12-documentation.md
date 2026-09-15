# Audit 12 — Documentation

Tanggal: 2026-09-14
Lingkup: README, setup, env, cara menjalankan, panduan deploy, runbook operasi, DESIGN.md. Metode: audit ulang mandiri read-only. Dibaca penuh dan diverifikasi ulang: `README.md` (113 baris), `docs/deploy.md` (340), `docs/operations.md` (335), `.env.example`, `.agents/DESIGN.md` (412), `package.json`, `package-lock.json`, `astro.config.mjs`, `Dockerfile`, `docker-compose.yml`, `vercel.json`, `playwright.config.ts`, `scripts/*.ts`, `src/lib/env.ts`, `src/lib/schema.ts`, `src/lib/cron-auth.ts`, seluruh berkas `test/**/*.spec.ts`. Verifikasi silang klaim vs kode aktual. Tidak ada perubahan kode; tidak ada build/test/server yang dijalankan (aturan lead).

## Ringkasan

Dokumentasi masih **kuat untuk pemula** dan runbook operasinya nyata, tetapi audit ulang menemukan **dua cacat yang menyesatkan operator**, bukan sekadar kelengkapan: (a) target Vercel didokumentasikan detail padahal adapter tidak disiapkan (DOC2, naik dari MINOR ke UTAMA), dan (b) `docs/deploy.md` B5 secara eksplisit menyuruh migrasi/seed/bootstrap di dalam container Easypanel sambil **salah** mengklaim `tsx` dan `drizzle/` sudah ada di image, padahal `tsx`/`dotenv` ter-prune dan `src/` tidak di-COPY (DOC4, temuan baru). DOC1 (Neon pooled/direct) tetap inkonsisten; DOC3 (`TEST_SEND_ADDRESSES`) tetap tak terdokumentasi; ditambah inkonsistensi Vercel-isme di `docs/operations.md` (DOC5) dan angka E2E yang salah di README (DOC6). Verifikasi per area selebihnya bertahan.

**Verdict audit 12: LULUS BERSYARAT** — dokumentasi tidak boleh diklaim "dua target siap deploy" sampai DOC2 dan DOC4 diperbaiki; keduanya bertaut dengan blocker ops DEP1/DEP4 di audit 10.

## Temuan

### DOC1 — README vs deploy.md bertentangan soal Neon pooled/direct URL
- Status: **MINOR (akurasi).**
- Bukti (teks saat ini): `README.md:79` — "`DATABASE_URL` (pakai pooled URL untuk runtime, direct URL untuk migrasi)"; tabel `README.md:84` — "Postgres (Neon pooled)"; langkah migrasi `README.md:111` — `DATABASE_URL=<direct-url> npm run db:migrate`. Sebaliknya `docs/deploy.md:262-264` — "Untuk migrasi diperlukan koneksi langsung (non-pooled); bila Neon memberi dua URL (pooled + direct), pakai yang **direct** untuk `DATABASE_URL`", dan contoh migrasi `docs/deploy.md:276-278` memakai `<connection-string-neon-direct>`.
- Analisis: keduanya setuju migrasi pakai direct. Konfliknya: README memisahkan pooled (runtime) + direct (migrasi), sedangkan deploy.md menetapkan `DATABASE_URL` = direct secara harfiah — padahal `DATABASE_URL` yang sama dipakai runtime serverless. Bila diikuti harfiah, runtime Vercel memakai koneksi direct (bukan pooled).
- Dampak: operator bingung URL mana yang dimasukkan. Runtime serverless memakai direct tanpa pooler berisiko menghabiskan koneksi Neon; memakai pooled untuk migrasi berisiko pgbouncer + prepared statement/transaksi panjang (driver `postgres`).
- Rekomendasi: satu keputusan eksplisit + alasan satu kalimat di kedua dokumen: **runtime = pooled, migrasi = direct**, dan tegaskan `DATABASE_URL` runtime harus pooled. Terkait A2/DEP1.

### DOC2 — Deploy Vercel tak menyebut penggantian adapter; target Vercel tidak fungsional apa adanya (NAIK SEVERITY)
- Status: **UTAMA (ops — target deploy kedua tidak berjalan sebagaimana tertulis).**
- Bukti:
  - Adapter aktif `@astrojs/node` standalone: `astro.config.mjs:5` (`import node from '@astrojs/node'`) dan `astro.config.mjs:13-15` (`adapter: node({ mode: 'standalone' })`); dependency di `package.json:21`.
  - `@astrojs/vercel` **0 kemunculan** di `package-lock.json` dan tidak ada di `package.json`.
  - `README.md:75-114` ("Deploy ke Vercel") dan `docs/deploy.md:235-306` (C0–C6) tidak menyebut penukaran/penambahan adapter; C1 hanya mengandalkan deteksi otomatis, "Jangan ubah build command (`astro build`) dan output directory" (`docs/deploy.md:251-254`).
  - `vercel.json:2-5` mendaftarkan cron, sehingga dokumentasi tampak siap Vercel padahal output build adalah node-standalone (`dist/server/entry.mjs`, `Dockerfile:49`), bukan Vercel Build Output.
- Dampak: mengikuti README/deploy.md apa adanya, SSR Vercel tidak terlayani (hanya aset statis `dist/client`). Dokumentasi menyesatkan operator. Terkait DEP4 audit 10.
- Rekomendasi: pilih satu — (a) tambah `@astrojs/vercel` sebagai dependency + langkah C1b "pasang dan ganti adapter bila target Vercel", atau (b) nyatakan tegas Vercel belum didukung/butuh perubahan adapter dan belum diuji. Samakan dengan keputusan DEP4.

### DOC4 — `docs/deploy.md` B5 salah mengklaim `tsx`+`drizzle/` ada di image; langkah migrasi di container pasti gagal (BARU)
- Status: **UTAMA (ops — langkah dokumentasi akan gagal di deploy Easypanel pertama).**
- Bukti:
  - Klaim salah: `docs/deploy.md:172-173` — "Script `tsx` dan folder `drizzle/` sudah ikut di dalam image Docker". Ini bagian dari B5 yang menyuruh `npm run db:migrate` / `npm run seed` / `npm run admin:bootstrap` **di dalam Console container** (`docs/deploy.md:160-183`, khususnya `:168`, `:176`, `:182`).
  - `drizzle/` memang ikut (`Dockerfile:35`), tetapi `tsx` TIDAK: `Dockerfile:25` (`RUN npm prune --omit=dev`) menghapus seluruh devDependencies, termasuk `tsx` (`package.json:38`) dan `dotenv` (`package.json:36`).
  - Runtime stage tidak menyalin `src/`: `Dockerfile:32-36` hanya `node_modules`, `dist`, `package.json`, `drizzle`, `scripts`. Semua script mengimpor modul dari `src/`: `scripts/seed.ts:5` (`../src/lib/db`), `scripts/migrate.ts:3` (`../src/lib/db`), `scripts/bootstrap-admin.ts:2` (`../src/lib/db`); ketiganya juga `import "dotenv/config"` (`scripts/*.ts:1`).
  - Akibatnya tiga kebutuhan runtime script (`tsx`, `dotenv`, `src/`) semuanya absen, sehingga perintah B5 gagal.
- Dampak: operator Easypanel yang mengikuti docs akan gagal di langkah migrasi. Kontras dengan alur Vercel C3 yang benar (migrasi dari lokal, `docs/deploy.md:275-281`).
- Rekomendasi (pilih satu): (a) ubah B5 agar migrasi/seed/bootstrap dijalankan dari komputer sendiri dengan `DATABASE_URL` produksi (meniru C3), atau (b) ubah `Dockerfile` (pindahkan `tsx`+`dotenv` ke `dependencies` dan tambah `COPY --from=build /app/src ./src`). Selaraskan dengan keputusan DEP1 audit 10.

### DOC3 — `TEST_SEND_ADDRESSES` ada di `.env.example` tetapi tak terdokumentasi di README/deploy/operations
- Status: **TRIVIAL.**
- Bukti (grep): hanya di `.env.example:23` (nilai kosong) dan kode (`src/lib/broadcast/stats.ts:246,261`; `src/pages/admin/api/email-campaigns/[id]/test-send.ts:14`; `src/pages/admin/email-campaigns/[id].astro:270,865`). **Nol kemunculan di `README.md`, `docs/deploy.md`, dan `docs/operations.md`** (audit lama baru menyebut README/deploy; operations juga tidak memuatnya).
- Rekomendasi: satu baris di tabel env README ("daftar email uji test-send, koma-dipisah; default `kelaswfa@gmail.com`").

### DOC5 — `docs/operations.md` seluruhnya berasumsi Vercel/Neon, tidak selaras target utama Easypanel (BARU)
- Status: **MINOR (konsistensi).**
- Bukti: `docs/operations.md:5` memakai `psql "$DATABASE_URL_DIRECT"` — nama variabel ini tidak ada di `.env.example` maupun README; `docs/operations.md:21` "terpasang di **Vercel Production**"; seluruh §6 rotasi secret berbunyi "Set ... di Vercel → redeploy" (`docs/operations.md:284`, `:293`, `:302`, `:307`). Padahal `docs/deploy.md:3-5` merekomendasikan VPS Easypanel sebagai target utama, dan prosedur kill switch Easypanel disebut di §5 lewat Cron Jobs Vercel (`docs/operations.md:267-272`).
- Dampak: operator Easypanel harus menerjemahkan sendiri langkah Vercel-vs-Easypanel; `DATABASE_URL_DIRECT` tak dikenal (bukan env aplikasi, hanya placeholder).
- Rekomendasi: generalisasi kata "Vercel" menjadi "panel deploy/Vercel" di §1/§6, dan jelaskan `DATABASE_URL_DIRECT` adalah nama konvensi bebas (bukan env app).

### DOC6 — Angka E2E di README salah (BARU)
- Status: **TRIVIAL (akurasi).**
- Bukti: `README.md:57` menulis "E2E (Playwright, 5 test)". Aktual: **5 berkas spec, 9 test case** — `test/admin/e2e/admin.spec.ts:12`; `test/admin/e2e/dashboard.spec.ts:41,69`; `test/broadcast/e2e/broadcast.spec.ts:18`; `test/e2e/funnel.spec.ts:3,22,33,51`; `test/e2e/launch.spec.ts:7`. Tidak ada `describe`/`skip` (`playwright.config.ts:4-9`, satu worker).
- Rekomendasi: tulis "E2E (Playwright, 9 test / 5 berkas spec)" atau cukup "5 berkas spec".

### Catatan kecil
- Tabel perintah README (`README.md:47-58`) memuat 10 baris, mencakup 9 dari 10 script `package.json:8-19`; `npm run astro` (`package.json:12`) tidak didaftarkan. TRIVIAL.
- Instruksi menyalin `.env.example` → `.env` (`README.md:41-43`) ditempatkan setelah blok 6 langkah, walau teksnya menyatakan "lebih dulu". Urutannya tetap terbaca; bukan temuan.

## Verifikasi per area (yang dikonfirmasi)

1. **Quickstart benar.** Urutan `docker compose up -d` → `npm install` → `db:migrate` → `seed` → `admin:bootstrap` → `dev` (`README.md:21-39`); prasyarat Node `>=22.12` cocok `package.json:5-7`; port 4321 cocok `Dockerfile:41`; Postgres 16 cocok `docker-compose.yml:3` (`postgres:16-alpine`).
2. **Tabel perintah sebagian besar akurat.** 9 script `package.json` terdokumentasi; path `npx playwright test test/broadcast/e2e/broadcast.spec.ts` (`README.md:58`) valid (berkas ada). Inkonsistensi: `npm run astro` tidak didaftarkan dan angka E2E salah (DOC6).
3. **Struktur direktori sesuai.** 6 baris `README.md:66-73` cocok repo aktual: `src/lib/` (25 berkas), `src/pages/`, `src/components/`, `scripts/` (`seed.ts`, `migrate.ts`, `bootstrap-admin.ts`), `test/` (Vitest `*.test.ts` + Playwright `*.spec.ts`), `drizzle/`.
4. **Tabel env README lengkap.** 21 variabel di `README.md:82-97`; default (TTL 12, rate limit 10/5, Emailit 2/5000) sesuai `.env.example:17-21`. Seluruh nama dari `env()` di `src/` ada di `.env.example` (21 nama, termasuk `TEST_SEND_ADDRESSES`); satu-satunya nama di luar `.env.example` adalah `TEST_TIMER_MS` (`astro.config.mjs:9`, `src/lib/timer.ts:11-14`) — build-time, default `30000`, hanya untuk e2e; bukan gap. Gap dokumentasi tersisa: DOC3. Peringatan `change-me` ada di `docs/deploy.md:42-43`.
5. **Deploy.md untuk pemula — dengan dua catatan serius.** Secret acak ada perintahnya (`docs/deploy.md:30-32`), Emailit/R2 langkah klik (A2–A3), Easypanel B0–B8 + Vercel C0–C6, cron dua skema auth konsisten `src/lib/cron-auth.ts:11-12` (`x-cron-secret` / `Authorization: Bearer ${CRON_SECRET}`), troubleshooting memetakan gejala→penyebab (`docs/deploy.md:324-333`). Namun B5 salah (DOC4) dan C1–C6 tidak fungsional tanpa adapter (DOC2).
6. **Operations.md runbook nyata.** Terverifikasi ada: checklist launch §1 (`docs/operations.md:18`), SPF/DKIM/DMARC bertahap §2 (`:33`, `none`→`quarantine`→`reject` di `:56-59`), backup/restore Neon PITR §3 (`:74`), query alert §4 (`:106`), prosedur pause/cancel + kill switch §5 (`:229`), rotasi secret §6 (`:278`), kapasitas Emailit §7 (`:312`). Nama tabel di query cocok `src/lib/schema.ts`: `contact` (`:3`), `email_outbox` (`:105`), `admin_user` (`:127`), `email_campaigns` (`:200`), `email_campaign_recipients` (`:219`), `email_deliveries` (`:231`), `email_suppressions` (`:245`), `email_provider_events` (`:251`). Klaim `providerCaps()`/`validateLimits()` cocok `src/lib/broadcast/machine.ts:27,45`. Keterbatasan: bernuansa Vercel/Neon (DOC5).
7. **DESIGN.md sumber kebenaran visual.** Panjang benar **412 baris** (`.agents/DESIGN.md`). Token konsisten: tinggi app header 64px mobile / 72px desktop (`.agents/DESIGN.md:139`); `--page-shell: 1200px` (`.agents/DESIGN.md:396`); font utama Plus Jakarta Sans (`.agents/DESIGN.md:61`). *(Koreksi recon: `--page-shell` ada di baris 396, bukan 61 — baris 61 adalah "Font utama".)*
8. **`.env.example` sinkron dengan kode.** Terverifikasi; `MOCK_EMAILIT`/`MOCK_R2` diperingatkan wajib off di produksi (`README.md:97`, `docs/deploy.md:145`).
9. **Cron dua target terdokumentasi.** `vercel.json:2-5` (`/api/cron/outbox`, `/api/cron/broadcast`, keduanya `* * * * *`) cocok `README.md:99-108`; Easypanel pakai Cron Job panel (`docs/deploy.md:189-211`).

## Yang belum dinilai pada tahap ini

- Uji sungguhan mengikuti quickstart dari nol di mesin bersih (klaim terverifikasi baca, bukan eksekusi; build/docker/test tidak dijalankan sesuai aturan lead).
- Deploy nyata Easypanel/Vercel + cron 200 + webhook delivery + restore drill Neon (prosedur ada, eksekusi milik operator).
- Komentar kode sebagai dokumentasi (dicakup audit 3).
- API reference terpisah (tidak ada; struktur route cukup jelas tanpa itu pada skala ini).

## Rekomendasi prioritas

1. **DOC2 (UTAMA)** — putuskan adapter Vercel: tambah `@astrojs/vercel` + langkah C1b, atau tandai Vercel belum didukung. Bareng DEP4 audit 10.
2. **DOC4 (UTAMA, baru)** — perbaiki `docs/deploy.md:160-183`: migrasi/seed/bootstrap dari lokal (meniru C3 `:275-281`) ATAU ubah Dockerfile (`tsx`+`dotenv` ke dependencies + `COPY src`). Bareng DEP1 audit 10.
3. **DOC1** — samakan keputusan Neon: runtime pooled, migrasi direct, satu kalimat alasan di README + deploy.md.
4. **DOC5** — generalisasi `docs/operations.md` untuk Easypanel dan jelaskan `DATABASE_URL_DIRECT`.
5. **DOC6 + DOC3** — koreksi angka E2E dan tambah baris `TEST_SEND_ADDRESSES` di tabel env.

## Catatan revisi audit ulang

| Klaim lama (audit 12 versi awal) | Hasil verifikasi ulang | Tindakan |
|---|---|---|
| "Verdict tahap 12: LULUS" | Dua cacat menyesatkan ditemukan (DOC2 target Vercel tidak fungsional; DOC4 klaim palsu `tsx`+`drizzle` di image). | Verdict diubah menjadi **"Verdict audit 12: LULUS BERSYARAT"**; label "Verdict tahap 12" diganti karena harus cocok nomor file. |
| DOC1 "README menyuruh runtime pooled, deploy.md menyuruh `DATABASE_URL` direct" | **VALID, belum berubah.** `README.md:79,84,111` vs `docs/deploy.md:262-264,276-278`. | Dipertahankan (MINOR); dampak pgbouncer/prepared statement dicatat. |
| DOC2 "MINOR (kelengkapan) — Vercel tak menyebut penggantian adapter" | **VALID dan lebih buruk.** `astro.config.mjs:5,13-15` pakai `@astrojs/node`; `@astrojs/vercel` 0 kemunculan di `package.json`/`package-lock.json`; `README.md:75-114` & `docs/deploy.md:235-306` tak menyebut adapter; `vercel.json:2-5` memperkuat kesan siap. | **Severity dinaikkan MINOR → UTAMA**, dikaitkan DEP4 audit 10. |
| DOC3 "`TEST_SEND_ADDRESSES` hanya di `.env.example`, nol di README/deploy" | **VALID, cakupan diperluas.** `grep` menemukan hanya `.env.example:23` + kode; nol di `README.md`, `docs/deploy.md`, **dan `docs/operations.md`**. | Dipertahankan (TRIVIAL) + disebut operations.md. |
| Area: "9 perintah sesuai package.json … E2E (Playwright, 5 test)" | **SEBAGIAN SALAH.** README mendokumentasikan 9 script (benar) tetapi melewatkan `npm run astro` (`package.json:12`); E2E aktual **9 test case di 5 berkas spec** (`admin.spec.ts:12`; `dashboard.spec.ts:41,69`; `broadcast.spec.ts:18`; `funnel.spec.ts:3,22,33,51`; `launch.spec.ts:7`), bukan 5 test. | Ditambah temuan **DOC6** + catatan `npm run astro`. |
| Area: "Struktur direktori sesuai — 6 baris" | **VALID.** `README.md:66-73` cocok repo (`src/lib`, `src/pages`, `src/components`, `scripts`, `test`, `drizzle`). | Dipertahankan. |
| Area: "Tabel env README lengkap; default sesuai kode" | **VALID.** 21 variabel `README.md:82-97`; default cocok `.env.example:17-21`; semua `env()` ada di `.env.example`; hanya `TEST_TIMER_MS` di luar daftar (`astro.config.mjs:9`, `src/lib/timer.ts:11-14`), build-time default `30000`. | Dipertahankan + klarifikasi `TEST_TIMER_MS`. |
| Area: "Deploy.md untuk pemula sungguhan" | **SEBAGIAN SALAH.** Alur pemula benar (A1–A4, B0–B8, C0–C6, tabel troubleshooting `docs/deploy.md:324-333`), tetapi B5 salah klaim (`docs/deploy.md:172-173`: "`tsx` dan folder `drizzle/` sudah ikut di dalam image") padahal `Dockerfile:25` mem-prune `tsx` (`package.json:38`) + `dotenv` (`package.json:36`) dan `Dockerfile:32-36` tidak menyalin `src/` (script impor `../src/lib/*`: `scripts/seed.ts:5`, `scripts/migrate.ts:3`, `scripts/bootstrap-admin.ts:2`). | Ditambah temuan baru **DOC4 (UTAMA)**, dikaitkan DEP1 audit 10. |
| Area: "Operations.md runbook nyata — checklist, SPF/DKIM/DMARC, PITR, query, pause/cancel, rotasi, kapasitas" | **VALID.** §1 `:18`, §2 `:33` (`:56-59` gradasi DMARC), §3 `:74`, §4 `:106`, §5 `:229`, §6 `:278`, §7 `:312`; tabel SQL cocok `src/lib/schema.ts` dan `src/lib/broadcast/machine.ts:27,45`. | Dipertahankan + temuan baru **DOC5** (asumsi Vercel/Neon, `DATABASE_URL_DIRECT` `:5` tak terdokumentasi). |
| Area: "DESIGN.md 412 baris, token konsisten" | **VALID.** 412 baris; header 64/72px `.agents/DESIGN.md:139`; `--page-shell: 1200px` `.agents/DESIGN.md:396`; font Plus Jakarta Sans `:61`. | Dipertahankan; catatan: recon menyebut `--page-shell` di baris 61, aktual **396** (baris 61 = "Font utama"). |
| Area: "`.env.example` sinkron dengan kode" | **VALID.** Semua `env()` ada di example; `change-me` diperingatkan `docs/deploy.md:42-43`. | Dipertahankan. |
