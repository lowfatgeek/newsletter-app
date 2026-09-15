# Audit 10 — Build & Deployment

Tanggal: 2026-09-14

Lingkup: build bersih, Dockerfile, config deploy (Easypanel + Vercel), env, migrasi, cron, production-readiness.

Metode: audit ulang mandiri read-only. `npm run build` tidak dijalankan ulang (aturan lead) — status build dilaporkan sebagai bukti eksternal + artefak `dist/` yang ada. Dibaca dan diverifikasi ulang: `Dockerfile`, `vercel.json`, `astro.config.mjs`, `package.json`/`package-lock.json`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`, `docs/deploy.md`, `docs/operations.md`, `README.md`, `scripts/*.ts`, `src/pages/**`, `src/lib/cron-auth.ts`, `src/pages/api/health.ts`, serta isi `dist/`. Tidak ada perubahan kode. `audits/` untracked (`git status` hanya menampilkan `?? audits/`) — disengaja, bukan temuan.

## Ringkasan

Untuk target **Easypanel**, jalur build-deploy praktis siap, tetapi punya **satu blocker operasional** di langkah migrasi (DEP1): image runtime tidak berisi `tsx`, `dotenv`, maupun `src/`, sementara `docs/deploy.md` B5 memerintahkan `npm run db:migrate` / `seed` / `admin:bootstrap` di dalam console container. Untuk target **Vercel**, dokumentasi ada tetapi **belum dapat dijalankan sebagaimana tertulis** (DEP4): proyek memakai adapter `@astrojs/node` (bukan `@astrojs/vercel`), dan tidak ada satu pun instruksi untuk menukar/menambah adapter.

Bukti kuat yang tetap sahih: `Dockerfile` multi-stage ramping (`npm ci` → build → `npm prune --omit=dev`) dengan healthcheck, panduan deploy dua target yang rinci, cron terdokumentasi di kedua target, health endpoint benar-benar cek DB, runbook operasi + checklist go-live.

Empat temuan: DEP1 (blocker ops, terverifikasi — bahkan lebih parah dari klaim awal), DEP4 (blocker ops untuk target Vercel, temuan baru), DEP2 (minor, tidak ada CI), DEP3 (minor, seed tanpa guard produksi).

**Verdict audit 10: LULUS BERSYARAT — dua blocker ops sebelum klaim "dua target siap deploy" (DEP1 untuk Easypanel, DEP4 untuk Vercel).**

## Temuan

### DEP1 — Script migrasi/seed/bootstrap tidak bisa jalan di image runtime (bukan hanya `tsx`)
- Status: **UTAMA (ops — memblokir langkah docs B5).**
- Bukti yang dikonfirmasi:
  - `scripts/*.ts` dijalankan lewat `tsx` (devDependency): `package.json:15` (`seed`), `package.json:16` (`admin:bootstrap`), `package.json:18` (`db:migrate`), `package.json:38` (`tsx`), `package.json:36` (`dotenv`).
  - Dockerfile memangkas devDependencies: `Dockerfile:25` (`RUN npm prune --omit=dev`). Runtime hanya menyalin `node_modules`, `dist`, `package.json`, `drizzle`, `scripts` — `Dockerfile:32-36`.
  - `docs/deploy.md:160` (B5) memerintahkan migrasi/seed/bootstrap **di dalam console container** (`docs/deploy.md:168`, `:176`, `:182`), dan secara eksplisit (salah) mengklaim "Script `tsx` dan folder `drizzle/` sudah ikut di dalam image Docker" (`docs/deploy.md:172-173`).
- **Fakta tambahan (memperberat klaim lama, temuan baru):** runtime stage bahkan **tidak menyalin `src/`** (`Dockerfile:32-36`). Semua script mengimpor modul dari `src/`: `scripts/seed.ts:5` (`../src/lib/db`), `scripts/migrate.ts:3` (`../src/lib/db`), `scripts/bootstrap-admin.ts:2` (`../src/lib/db`). Jadi kalaupun `tsx` dipertahankan, script tetap gagal (`Cannot find module ../src/lib/...`).
- **Fakta tambahan kedua:** ketiga script juga `import "dotenv/config"` (`scripts/seed.ts:1`, `scripts/migrate.ts:1`, `scripts/bootstrap-admin.ts:1`), sedangkan `dotenv` devDependency (`package.json:36`) ikut ter-prune. Jadi tiga dependensi runtime yang dibutuhkan script (`tsx`, `dotenv`, `src/`) semuanya absen.
- Dampak: operator yang mengikuti docs akan gagal di langkah migrasi pada deploy pertama Easypanel — gagal lebih awal dari yang dibayangkan (bukan hanya `tsx`).
- Rekomendasi (pilih satu):
  1. Jadikan script runnable di image: pindahkan `tsx` + `dotenv` ke `dependencies`, dan tambahkan `COPY --from=build /app/src ./src` di stage runtime; atau
  2. Ubah docs: migrasi/seed/bootstrap dijalankan dari komputer sendiri dengan `DATABASE_URL` produksi (meniru alur Vercel C3 `docs/deploy.md:275-281`), bukan dari console Easypanel.
- Catatan: alur Vercel C3 memang sudah migrasi dari lokal (`docs/deploy.md:275-279`), jadi skrip ini benar untuk Vercel; yang bermasalah adalah alur Easypanel B5.

### DEP4 — Target Vercel didokumentasikan tetapi adapter-nya tidak disiapkan (BARU)
- Status: **UTAMA (ops — target deploy kedua tidak fungsional sebagaimana tertulis).**
- Bukti:
  - Adapter aktif adalah `@astrojs/node` (`astro.config.mjs:5`, `astro.config.mjs:13-15`), bergantung pada `@astrojs/node` (`package.json:21`).
  - `@astrojs/vercel` **tidak ada** di `package.json` (grep `vercel` → hanya `vercel.json` yang cocok) dan **0 kemunculan** di `package-lock.json`.
  - `README.md:75-114` ("Deploy ke Vercel") dan `docs/deploy.md:235-306` (C1–C6) tidak pernah menyebut instalasi/penggantian adapter; C1 hanya mengandalkan "framework terdeteksi otomatis" (`docs/deploy.md:251-254`) dan `README.md:77`.
- Dampak: `astro build` dengan `@astrojs/node` menghasilkan output node-standalone (`dist/server/entry.mjs` — ada di `dist/server/`), bukan Vercel Build Output (`.vercel/output`). Tanpa `@astrojs/vercel`, deploy Vercel tidak akan melayani route SSR (hanya output statis `dist/client`). Dokumentasi menyesatkan operator.
- Rekomendasi: tambahkan `@astrojs/vercel` sebagai dependency opsional + catatan di C1/README cara memakai adapter Vercel (atau nyatakan jelas bahwa target Vercel memerlukan perubahan adapter dan belum diuji). Jika Vercel bukan target prioritas, tandai eksplisit "belum didukung".

### DEP2 — Tidak ada CI (build/test otomatis per push)
- Status: **MINOR.**
- Bukti: tidak ada `.github/workflows/` maupun file CI lain (pencarian `github|gitlab|circle|travis|jenkins|drone|woodpecker|bitbucket|azure` → tidak ada; satu-satunya file YAML di root adalah `docker-compose.yml`). Build dijalankan manual oleh lead (bukti eksternal) dan sukses, tetapi tidak ada penjamin build/test tetap hijau di commit berikutnya.
- Rekomendasi: satu workflow minimal (checkout → `npm ci` → `npm run build` + `npm test`). Backlog wajar, bukan penghalang deploy pertama.

### DEP3 — Seed tanpa guard `NODE_ENV=production`
- Status: **MINOR (pengaman).**
- Bukti: `scripts/seed.ts:89` (`main()`) tidak menolak `NODE_ENV=production`; tidak ada cek `process.env.NODE_ENV` di file itu. Delete ber-scope ketat (`[E2E]%` di `scripts/seed.ts:172-189`, `admin-e2e-%` di `scripts/seed.ts:196-200`, rate-limit admin di `scripts/seed.ts:216-218`) dan insert idempoten — aman bila dijalankan sekali sesuai docs.
- Catatan tambahan: `scripts/bootstrap-admin.ts` juga tanpa guard, tetapi non-destruktif (`src/lib/admin/bootstrap.ts:22-38` hanya membuat bila belum ada), jadi risikonya rendah.
- Rekomendasi: tambah guard (`if (NODE_ENV === "production" && !ALLOW_SEED) fail`) atau flag konfirmasi pada `seed.ts` (dan opsional `bootstrap-admin.ts`).

## Verifikasi per area (yang dikonfirmasi)

1. **Build.** `npm run build` pernah sukses dijalankan lead (bukti eksternal; tidak dijalankan ulang pada audit ini sesuai aturan). Artefak konsisten: `dist/server/entry.mjs` ada, dan **tepat 5 route prerender** — `find dist -name "*.html"` → `dist/client/404.html`, `dist/client/index.html`, `dist/client/admin/login/index.html`, `dist/client/admin/otp/index.html`, `dist/client/admin/reset/index.html`. Konsisten dengan source: 67 file di `src/pages`, 62 di antaranya `export const prerender = false`, dan 5 tanpa deklarasi (`src/pages/404.astro`, `src/pages/index.astro`, `src/pages/admin/login.astro`, `src/pages/admin/otp.astro`, `src/pages/admin/reset.astro`). *(Klaim lama "6 route statis" SALAH — angka benar 5.)* `dist/` tidak ter-commit (`git ls-files dist` kosong; `dist/` di `.gitignore:2`).
2. **Dockerfile benar.** Multi-stage (`Dockerfile:10` build, `Dockerfile:28` runtime), `npm ci` terkunci lockfile (`Dockerfile:16`), `npm run build` (`Dockerfile:22`), `npm prune --omit=dev` (`Dockerfile:25`), `HOST=0.0.0.0`/`PORT=4321`/`EXPOSE 4321` (`Dockerfile:40-42`), healthcheck ke `/api/health` (`Dockerfile:46-47`), `CMD node ./dist/server/entry.mjs` (`Dockerfile:49`), komentar jujur stateless (`Dockerfile:6-7`). Runtime COPY = `node_modules`, `dist`, `package.json`, `drizzle`, `scripts` (`Dockerfile:32-36`) — **tanpa `src/`** (dasar DEP1).
3. **Health endpoint bermakna.** `src/pages/api/health.ts:10` `db.execute(sql\`select 1\`)` → 200 (`:11`), error → `{"status":"error"}` 503 (`:13`). `prerender = false` di `:6`. Memadai untuk healthcheck container.
4. **Dua target deploy terdokumentasi** — tetapi hanya Easypanel yang jalurnya utuh; Vercel belum fungsional (DEP4). Easypanel pakai Cron Job panel (`docs/deploy.md:189-211`) + alternatif cron-job.org (`:209-211`). Vercel pakai `vercel.json` (`vercel.json:2-5`: `/api/cron/outbox` dan `/api/cron/broadcast`, keduanya `* * * * *`) dan klaim Bearer otomatis (`docs/deploy.md:286-290`) **sesuai** `src/lib/cron-auth.ts:11-12` (menerima `x-cron-secret` dan `Authorization: Bearer ${CRON_SECRET}`).
5. **Env lengkap.** Semua nama dari `env()` di `src/` ada di `.env.example`: DATABASE_URL, TOKEN_SECRET, R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET, IP_HASH_SALT, EMAILIT_API_KEY, EMAILIT_WEBHOOK_SECRET, CRON_SECRET, MOCK_EMAILIT, MOCK_R2, PUBLIC_SITE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_SESSION_TTL_HOURS, RATE_LIMIT_IP_PER_HOUR, RATE_LIMIT_EMAIL_PER_HOUR, EMAILIT_MAX_PER_SECOND, EMAILIT_MAX_PER_DAY, MO_BROADCAST, TEST_SEND_ADDRESSES. `ADMIN_PASSWORD` juga dibaca langsung via `process.env` (`src/lib/admin/bootstrap.ts:33`). Satu-satunya nama yang dipakai tetapi tidak ada di `.env.example` adalah `TEST_TIMER_MS` (`src/lib/timer.ts:13-14`, `astro.config.mjs:9`) — build-time, punya default `30000`, dan hanya untuk e2e; bukan gap. Tidak ada variabel `.env.example` yang menganggur. Peringatan `change-me` ada di `docs/deploy.md:42-43`.
6. **Migrasi standar.** Drizzle migrator + folder `drizzle/` (4 migrasi `0000`–`0003` + `meta/`) ikut image (`Dockerfile:35`); `scripts/migrate.ts:4` `migrationsFolder: "./drizzle"`, `:6` `console.log("migrated")`.
7. **Timer aman di build.** `TEST_TIMER_MS` default `30000` (`astro.config.mjs:9`, dikonsumsi `src/lib/timer.ts:11-14`) + peringatan Dockerfile (`Dockerfile:20-21`) — produksi mendapat 30 detik kecuali sengaja diubah.
8. **Runbook operasi ada.** `docs/operations.md`: checklist launch (§1, `:18`), SPF/DKIM/DMARC (§2, `:33`), backup/restore Neon PITR (§3, `:74`), query alert (§4, `:106`), pause/cancel darurat + kill switch (§5, `:229`), rotasi secret (§6, `:278`), kapasitas Emailit (§7, `:312`).
9. **Checklist go-live.** `docs/deploy.md:309-320` (halaman contoh, cron 200, webhook, test-send lintas mailbox, rotasi secret) — cakupan pra-launch yang benar.
10. **Seed idempoten.** Domain dicek-sebelum-insert (`scripts/seed.ts:91-95`), template doa per (variant, locale, name) (`:98-110`), campaign dicek-sebelum-insert (`:115-122`), R2 dilewati bila kredensial kosong (`:47-50`), admin bootstrap try/catch (`:207-212`).
11. **Secret tidak ikut ke image.** `.env` ada di working tree tetapi dikecualikan `.dockerignore:5-6` (`.env`, `.env.*`), jadi tidak ter-`COPY . .` ke image.

## Yang belum diuji pada tahap ini

- `docker build` + `docker run` end-to-end (Dockerfile dibaca; CLI Docker 28.5.1 tersedia, tidak di-build di mesin ini).
- `npm run build` tidak dijalankan ulang pada audit ini (aturan lead); keberhasilan build adalah bukti eksternal dari lead, didukung artefak `dist/`.
- Deploy nyata ke Easypanel/Vercel + cron 200 + webhook delivery.
- Restore drill Neon PITR (prosedur ada, eksekusi milik operator).

## Rekomendasi prioritas

1. Putuskan DEP1 sebelum deploy Easypanel pertama: buat script runnable di image (`tsx`+`dotenv` ke dependencies + `COPY src`) ATAU ubah docs ke migrasi-dari-lokal.
2. Putuskan DEP4 sebelum mengklaim dukungan Vercel: tambahkan `@astrojs/vercel` + instruksi adapter, atau tandai target Vercel sebagai belum didukung.
3. Tambah workflow CI minimal (DEP2).
4. Guard seed produksi (DEP3).

## Catatan revisi audit ulang

| Klaim lama | Hasil verifikasi ulang | Tindakan |
|---|---|---|
| "`npm run build` sukses (±1 detik, 6 route statis)" | Build tidak dijalankan ulang (aturan). Artefak `dist/` ada dan konsisten; jumlah route prerender **5**, bukan 6: `dist/client/404.html`, `index.html`, `admin/login/index.html`, `admin/otp/index.html`, `admin/reset/index.html`; source: 67 file di `src/pages`, 62 `prerender=false`, 5 tanpa deklarasi. | Angka "6 route statis" dikoreksi menjadi **5**; status build ditandai sebagai bukti eksternal + artefak. |
| DEP1 "butuh `tsx`, tetapi `tsx` ter-prune" | VALID, bahkan lebih parah: runtime juga tidak menyalin `src/` (`Dockerfile:32-36`; script impor `../src/lib/*` di `scripts/seed.ts:5`, `scripts/migrate.ts:3`, `scripts/bootstrap-admin.ts:2`) dan `dotenv` ikut ter-prune (`package.json:36`, `scripts/*.ts:1`). Docs B5 (`docs/deploy.md:168-182`) memerintahkan run di container dan salah klaim `tsx`+`drizzle` sudah ada (`docs/deploy.md:172-173`). | DEP1 dipertahankan + bukti diperkuat (`src/` dan `dotenv`); status tetap UTAMA. |
| "Dua target deploy terdokumentasi ... Vercel" (implisit Vercel jalan) | Koreksi: target Vercel **belum fungsional**. `astro.config.mjs:5,13-15` pakai `@astrojs/node`; `@astrojs/vercel` tidak ada di `package.json` maupun `package-lock.json` (0 kemunculan); `README.md:75-114` dan `docs/deploy.md:235-306` tak menyebut penggantian adapter. | Ditambah temuan baru **DEP4 (UTAMA)**. |
| DEP2 "tidak ada CI" | VALID. Tidak ada `.github/workflows/` atau file CI lain; satu-satunya YAML root `docker-compose.yml`. | Dipertahankan (MINOR). |
| DEP3 "seed tanpa guard `NODE_ENV=production`" | VALID. Tidak ada cek NODE_ENV di `scripts/seed.ts`; delete ber-scope ketat (`:172-200`) + rate-limit cleanup (`:216-218`). `scripts/bootstrap-admin.ts` juga tanpa guard tapi non-destruktif (`src/lib/admin/bootstrap.ts:22-38`). | Dipertahankan (MINOR) + catatan bootstrap-admin. |
| Area 3 "health `select 1` → 200/503" | VALID. `src/pages/api/health.ts:10` select 1, `:11` 200, `:13` 503. | Dipertahankan. |
| Area 4 "cron-auth dua skema auth" | VALID. `src/lib/cron-auth.ts:11` `x-cron-secret`, `:12` `Authorization: Bearer ${CRON_SECRET}`; `vercel.json:2-5` dua cron tiap menit. | Dipertahankan. |
| Area 5 "semua `env()` ada di `.env.example`" | VALID. Satu nama di luar daftar: `TEST_TIMER_MS` (`src/lib/timer.ts:13-14`, `astro.config.mjs:9`) — build-time, default `30000`, bukan gap. | Dipertahankan + klarifikasi `TEST_TIMER_MS`. |
| Area 6 "`drizzle/` ikut image; migrate cetak `migrated`" | VALID. `Dockerfile:35`; `scripts/migrate.ts:4` `./drizzle`, `:6` `console.log("migrated")`; 4 migrasi + `meta/`. | Dipertahankan. |
| Area 8/9 "runbook + checklist" | VALID. `docs/operations.md` §1–§7 (`:18`,`:33`,`:74`,`:106`,`:229`,`:278`,`:312`); `docs/deploy.md:309-320`. | Dipertahankan. |
| Area 10 "seed idempoten" | VALID. `scripts/seed.ts:91-122`, `:47-50`, `:207-212`. | Dipertahankan. |
| "Verdict tahap 10" | Label harus cocok nomor file. | Diganti menjadi **"Verdict audit 10"**. |
| Ringkasan "siap produksi dengan dua catatan" | Koreksi karena DEP4 menambah blocker kedua. | Ringkasan + verdict diperbarui: **LULUS BERSYARAT dengan dua blocker ops (DEP1, DEP4)**. |
