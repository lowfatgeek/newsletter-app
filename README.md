# KelasWFA Newsletter

Newsletter + reward funnel untuk komunitas KelasWFA: halaman reward publik
bilingual (ID/EN) dengan gate timer, pengumpulan kontak dengan konfirmasi
double opt-in, CMS admin (reward campaign, preset doa, kontak, ekspor CSV), dan
broadcast email transaksional/marketing lewat Emailit dengan laporan
deliverability.

## Stack

- **Astro 7** (`@astrojs/node`, mode server) + TypeScript
- **PostgreSQL 16** via **Drizzle ORM** (`src/lib/schema.ts`, migrasi `drizzle/`)
- **Emailit** — email provider (broadcast + transaksional)
- **Cloudflare R2** — penyimpanan asset reward (S3-compatible)
- **Argon2id** + OTP email + trusted device untuk login admin · **Vitest** unit, **Playwright** e2e

## Quickstart (dev)

Prasyarat: Node.js >= 22.12, Docker (untuk Postgres), npm.

```sh
# 1. Start database
docker compose up -d

# 2. Install dependency
npm install

# 3. Migrasi skema
npm run db:migrate

# 4. Seed data dev (reward campaign contoh, template doa, admin)
npm run seed

# 5. Buat/atur password admin (opsional jika seed sudah membuatnya)
npm run admin:bootstrap

# 6. Jalankan dev server (http://localhost:4321)
npm run dev
```

Salin `.env.example` → `.env` lebih dulu dan isi minimal `DATABASE_URL`,
`TOKEN_SECRET`, `IP_HASH_SALT`. Dengan `MOCK_EMAILIT=true` dan `MOCK_R2=true`,
email/asset tidak keluar ke provider saat dev.

## Perintah

| Command | Aksi |
| --- | --- |
| `npm run dev` | Dev server Astro (port 4321) |
| `npm run build` | Build produksi (adapter Node standalone; otomatis `@astrojs/vercel` di Vercel) |
| `npm run preview` | Preview hasil build |
| `npm run check` | Type check proyek via Astro Check (`astro check`) |
| `npm run lint` | Linting & verifikasi kode via Biome (`biome check .`) |
| `npm run format` | Auto-format kode via Biome (`biome check --write .`) |
| `npm run db:generate` | Generate migrasi Drizzle dari `src/lib/schema.ts` |
| `npm run db:migrate` | Terapkan migrasi |
| `npm run seed` | Seed data dev + bersihkan sisa baris e2e |
| `npm run admin:bootstrap` | Buat admin dari `ADMIN_EMAIL` / set password |
| `npm test` | Unit/integration test (Vitest, butuh Postgres) |
| `npm run test:e2e` / `npx playwright test` | E2E (Playwright, 10 test / 5 berkas spec) |
| `npx playwright test test/broadcast/e2e/broadcast.spec.ts` | E2E broadcast saja |

Test memakai database yang sama dengan `DATABASE_URL`; `test/helpers.ts`
`resetDb()` men-`TRUNCATE` seluruh tabel di antara test. Jalankan
`docker compose up -d` sebelum test.

## Struktur singkat

```
src/lib/            domain logic (subscribe, outbox, broadcast, admin, storage, templates)
src/pages/          route publik (funnel kado, cek-email, akses, konfirmasi) + admin/cron/webhook
src/components/     komponen Astro publik (RewardClaimModal, CheckEmailNotice, DownloadDesk, dsb.)
preview/            mockup/preview HTML statis Hallmark (diabaikan dari linter Biome)
scripts/            seed, migrate, bootstrap admin (tsx)
test/               Vitest (*.test.ts) + Playwright (*.spec.ts)
drizzle/            SQL migrasi
```

## Deploy ke Vercel

Build mendeteksi target secara otomatis: di Vercel (`VERCEL=1` disuntik
platform) `astro.config.mjs` memakai adapter `@astrojs/vercel`; di luar itu
(Docker/Easypanel/VPS) memakai `@astrojs/node` mode standalone — tanpa flag
konfigurasi tambahan.

1. Import repo ke Vercel; framework preset Astro, build `npm run build`.
2. Sediakan Postgres terkelola (Neon). Salin connection string ke
   `DATABASE_URL` (pakai pooled URL untuk runtime, direct URL untuk migrasi).
3. Isi environment variables (Production + Preview) dari `.env.example`:

   | Variabel | Wajib | Keterangan |
   | --- | --- | --- |
   | `DATABASE_URL` | ya | Postgres (Neon pooled) |
   | `TOKEN_SECRET` | ya | HMAC timer/link token, acak >= 32 karakter |
   | `IP_HASH_SALT` | ya | Salt hash IP untuk rate limit |
   | `PUBLIC_SITE_URL` | ya | URL produksi, mis. `https://newsletter.kelaswfa.my.id` |
   | `ADMIN_EMAIL` | ya | Email admin (login + reset password) |
   | `EMAILIT_API_KEY` | ya | API key Emailit |
   | `EMAILIT_WEBHOOK_SECRET` | ya | Secret verifikasi signature webhook Emailit |
   | `CRON_SECRET` | ya | Secret header cron (`Authorization: Bearer` / `x-cron-secret`) |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | ya | Kredensial Cloudflare R2 |
   | `ADMIN_PASSWORD` | tidak | Hanya bootstrap/dev |
   | `ADMIN_SESSION_TTL_HOURS` | tidak | Default 12 |
   | `RATE_LIMIT_IP_PER_HOUR` / `RATE_LIMIT_EMAIL_PER_HOUR` | tidak | Default 10 / 5 |
   | `EMAILIT_MAX_PER_SECOND` / `EMAILIT_MAX_PER_DAY` | tidak | Default 2 / 5000 |
   | `TEST_SEND_ADDRESSES` | tidak | Allowlist tombol "Kirim uji" di editor email campaign (comma-separated, default `kelaswfa@gmail.com`). Alamat di luar daftar ditolak; kirim uji tidak menyentuh recipient/statistik |
   | `MOCK_EMAILIT` / `MOCK_R2` / `MO_BROADCAST` | tidak | Biarkan kosong/false di produksi |

4. Cron sudah didefinisikan di `vercel.json` (dua job tiap menit):

   | Path | Jadwal | Fungsi |
   | --- | --- | --- |
   | `/api/cron/outbox` | `* * * * *` | Kirim email transaksional tertunda (OTP, konfirmasi, access) |
   | `/api/cron/broadcast` | `* * * * *` | Proses satu batch kampanye broadcast |

   Vercel Cron mengirim header `Authorization: Bearer $CRON_SECRET`; route
   menerimanya sekaligus header `x-cron-secret` (untuk pemanggil manual/e2e).
   Pastikan `CRON_SECRET` terpasang.

5. Jalankan migrasi ke database produksi sekali dari lokal:
   `DATABASE_URL=<direct-url> npm run db:migrate`.
6. Sebelum broadcast produksi pertama, jalankan checklist
   [`docs/operations.md`](docs/operations.md) (SPF/DKIM/DMARC, backup, alert).

---

## Addendum & Status Terkini (September 2026)

- **Desain Permukaan Publik Lengkap ("The Desk Pattern Family")**:
  Seluruh antarmuka publik (`/r/[slug]`, `/cek-email`, `/konfirmasi/[token]`, `/akses/[token]`, `/404`) telah direvitalisasi menggunakan pola *Warm Editorial Utility* Hallmark:
  - `/r/[slug]` & `/en/r/[slug]`: **The Progressive Modal Desk** (1-kolom showcase 740px + modal/drawer ritual dengan timer 30 detik on-demand).
  - `/cek-email` & `/en/cek-email`: **The Express Inbox Desk** (1-kolom fokus 580px dengan tombol cepat webmail Gmail/Outlook & info whitelist kontak).
  - `/akses/[token]` & `/en/akses/[token]`: **The Download Desk** (link download bertanda tangan 1 jam + info masa kedaluwarsa 7 hari).
  - `/konfirmasi/[token]` & `/en/konfirmasi/[token]`: **The Reassurance Desk** (konfirmasi opt-in newsletter & serah terima akses kado).
  - `/404`: **The Lost Courier Desk** (ilustrasi kurir pos & navigasi pemulihan).
- **Arsitektur Pengirim Email Terpisah (Dual-Sender)**:
  - **Transaksional** (OTP admin, konfirmasi opt-in, akses reward): `KelasWFA <hi@kelaswfa.my.id>`.
  - **Broadcast / Newsletter**: `KelasWFA <kurir@kelaswfa.my.id>`.
- **Integrasi CI & Biome Quality Gate**:
  - CI GitHub Actions (`.github/workflows/ci.yml`) secara otomatis memvalidasi migrasi database, Biome lint (`npm run lint`), Astro check (`npm run check`), dan unit test Vitest (`npm test`).
  - Berkas preview/mockup statis HTML di `preview/` dikecualikan dari format/lint Biome (`biome.json`).

