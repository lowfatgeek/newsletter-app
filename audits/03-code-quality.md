# Audit 03 — Code Quality

Tanggal: 2026-09-14 (revisi audit ulang: 2026-09-14)
Lingkup: struktur, modularitas, readability, typing, pola error, komentar, duplikasi, guard middleware. Metode: read-only + verifikasi ulang tiap klaim terhadap kode saat ini; hasil `npm test` (49 file / 326 test) dikutip sebagai bukti eksternal yang telah diverifikasi lead, tidak dijalankan ulang. Tidak ada perubahan kode.

## Ringkasan

Kualitas kode **baik**. Arsitektur berlapis dipatuhi: `src/lib/*` murni tanpa import `astro` (diverifikasi ulang via grep — nol hasil), pages/endpoints hanya pipa tipis, pola discriminated union `{ ok: true } | { ok: false; reason }` konsisten di subscribe/OTP/machine/access/download, konstanta waktu bernama (`SEVEN_DAYS_MS`, `TEN_MIN_MS`, `THIRTY_DAYS_MS`, `DEFAULT_MIN_AGE_MS`), komentar Bahasa Indonesia yang menjelaskan *mengapa* bukan *apa*. Suite unit **49 file, 326 test, semua hijau** (bukti eksternal lead).

Empat temuan: tidak ada linter/formatter (C1), tiga file editor admin besar — 999, 876, dan 623 baris (C2), satu `as any` ganda di helper funnel (C3), dan tidak ada `typescript`/`@astrojs/check` sehingga cek tipe mandiri **dan** cek tipe saat build sama-sama tidak ada (C4).

**Verdict audit 03: LULUS** — tidak ada yang menghalangi lanjut ke tahap 4; C1 dan C4 disarankan sebagai perbaikan proses/tooling.

## Temuan

### C1 — Tidak ada linter/formatter terkonfigurasi
- Status: **UTAMA (proses).**
- Bukti: `ls -a` di root tidak menemukan file `eslint*`, `biome*`, maupun `prettier*`; `package.json:8-17` tidak memuat script `lint`/`format` (hanya `dev`, `build`, `preview`, `astro`, `test`, `test:e2e`, `seed`, `admin:bootstrap`, `db:generate`, `db:migrate`). Konsistensi saat ini dijaga manual dan terlihat rapi, tetapi tanpa penjaga otomatis regresi gaya akan masuk seiring kontributor/kecepatan.
- Rekomendasi: tambah satu toolchain (mis. Biome — satu binary untuk lint+format, cocok untuk Astro) + script `lint` + gate CI. Prioritas sedang; tidak menghalangi launch.

### C2 — Tiga file editor admin besar (999/876/623 baris)
- Status: **MINOR / batas wajar.**
- Bukti (`wc -l`): `src/pages/admin/campaigns/[id].astro` **999** baris, `src/pages/admin/email-campaigns/[id].astro` **876** baris, `src/pages/admin/email-campaigns/[id]/laporan.astro` **623** baris. Ketiganya halaman editor kompleks (frontmatter + markup + `<style>` + `<script>` client). Tidak ada file `src/` lain di atas 400 baris (terbesar berikutnya `src/lib/admin/campaigns.ts` 373 baris).
- Catatan revisi: audit awal hanya menyebut dua file; `laporan.astro` (623 baris) ditambahkan karena juga melewati ambang "besar" dan punya blok `<style>`/`<script>` besar.
- Rekomendasi: bila disentuh lagi, ekstraksi bertahap (mis. komponen form section atau modul JS client terpisah). Bukan refactor wajib pra-launch.

### C3 — `as any` ganda di helper `count()` funnel
- Status: **MINOR TYPING.**
- Bukti: `src/lib/funnel.ts:28` (`.from(table as any)`) dan `src/lib/funnel.ts:29` (`.where(where as any)`) — `.from(table as any).where(where as any)`. Ini satu-satunya `as any`/`any` eksplisit di seluruh `src/` (grep `as any`/`: any`/`<any>`/`any[]` hanya menemukan dua baris ini; hit lain hanyalah CSS `overflow-wrap: anywhere`). Union tipe parameter sudah tepat di `src/lib/funnel.ts:22-25`; cast dipakai untuk melewati batasan generik Drizzle. Ada juga type assertion non-`any` lain di `src/lib/` (9 kemunculan `as <Tipe>`, mis. `src/lib/broadcast/snapshot.ts:75` `as AudienceFilter`) — normal, bukan temuan.
- Rekomendasi: pertahankan dengan komentar (sudah ada konteks), atau bungkus overload per-tabel bila ingin nol `any`. Dampak praktis nihil.

### C4 — Cek tipe tidak tersedia sama sekali (`tsc` dan `astro check` dua-duanya absen)
- Status: **MINOR–SEDANG TOOLING** (dinaikkan dari minor; lihat koreksi).
- Bukti: `typescript` tidak ada di `node_modules/` maupun `package.json`; `npx tsc --noEmit` menjawab "This is not the tsc command you are looking for". `@astrojs/check` juga **tidak terpasang** (`package.json` deps & devDeps tidak memuatnya; `node_modules/@astrojs/` hanya berisi `node`, `internal-helpers`, `markdown-satteri`, `prism`, `telemetry`, compiler binding). `tsconfig.json:2` memakai `astro/tsconfigs/strict` sehingga aturan tetap terdeklarasi, tetapi tidak ada tool yang menegakkannya.
- Koreksi penting: audit awal menyebut "(C4, minor karena `astro check` implisit via build)". Ini **tidak berlaku**: `package.json:10` adalah `"build": "astro build"`, dan `astro build` **tidak** menjalankan `astro check`/type-check (`astro check` adalah command terpisah yang wajib `@astrojs/check`). Karena `@astrojs/check` tidak terpasang, build saat ini **tidak memeriksa tipe**. Jadi klaim "build Astro tetap memeriksa" salah dan severity naik: tidak ada jaring pengaman tipe otomatis di dev maupun CI.
- Rekomendasi: tambah `typescript` + `@astrojs/check` ke devDependencies dan script `check` (`astro check`) agar cek tipe bisa jalan mandiri/CI.

## Verifikasi per area (yang diverifikasi)

1. **Lib murni.** Grep `from 'astro'` / `import ... 'astro'` di `src/lib/` → **nol hasil**. Klaim arsitektur "modul murni, unit-testable" terbukti (48 file di `src/lib/`).
2. **Pola Result konsisten.** Discriminated union terverifikasi dengan baris nyata:
   - `src/lib/subscribe.ts:23-28` — `SubscribeResult` (`ok: true` + `alreadyConfirmed` | `ok: false` + `reason`).
   - `src/lib/admin/login.ts:28-33` dan `:91-95` — hasil login/OTP (`invalid | expired | too-many-attempts | weak-password`).
   - `src/lib/broadcast/machine.ts:24` (`TransitionResult`) dan `:68-71` (`ScheduleResult`, termasuk varian ber-`detail`).
   - `src/lib/access.ts:46,73`, `src/lib/download.ts:12,31`, `src/lib/timer.ts:24`, `src/lib/admin/domains.ts:13-14`.
   Pola dipakai merata; tanpa exception untuk alur bisnis yang diharapkan.
3. **Catch bertanggung jawab.** Tidak ada blok `catch {}` kosong. Sebagian `catch` mengembalikan nilai eksplisit (`src/lib/crypto.ts:27` → `null` yang dipetakan ke `reason: invalid`; `src/pages/api/subscribe.ts:40` → redirect `bad-request`; `src/pages/api/health.ts:12` → 503; `src/pages/admin/api/login.ts:20` → 400), dan `src/lib/mailworker.ts:39-53` menghitung attempts + backoff eksponensial. **Nuansa (temuan baru):** ada 3 promise-catch no-op sengaja yang menelan error — `src/lib/subscribe.ts:85`, `src/lib/subscribe.ts:99` (keduanya berkomentar `// best-effort fast drain`), dan `src/components/EmailForm.astro:118` (best-effort refresh token dengan fallback server-rendered). Ketiganya hanya menelan kegagalan non-kritis, bukan error bisnis; masih dapat diterima tetapi layak dihitung sebagai "swallow" yang disengaja.
4. **Penamaan jelas.** `getPublicCampaignState` (`src/lib/campaign.ts:12`), `confirmContactByToken` (`src/lib/access.ts:71`), `claimForSending` (`src/lib/broadcast/machine.ts:144`), `snapshotRecipients` (`src/lib/broadcast/snapshot.ts:68`), `retryFailedRecipients` (`src/lib/broadcast/stats.ts:189`), `clientIp` (`src/lib/ip.ts:13`), `cronAuthorized` (`src/lib/cron-auth.ts:9`) — verb-first, konsisten Inggris di kode.
5. **Konstanta bernama.** `DEFAULT_MIN_AGE_MS` (`src/lib/timer.ts:4`), `SEVEN_DAYS_MS` (`src/lib/access.ts:6`), `TEN_MIN_MS` (`src/lib/admin/otp.ts:9`), `THIRTY_DAYS_MS` (`src/lib/admin/devices.ts:6`) — semua ada; tidak ada angka telanjang yang misterius di jalur bisnis.
6. **Komentar berkualitas.** Terverifikasi menjelaskan alasan keputusan: race upsert `onConflictDoNothing` (`src/lib/subscribe.ts:59,66`), mengapa `unsubscribed` tidak diaktifkan ulang (`src/lib/broadcast/unsubscribe.ts:34,50`), mengapa CSP preview dikecualikan (`src/middleware.ts:6-16` + `src/pages/admin/api/email-campaigns/[id]/preview.ts:20`), mengapa visit→submit tidak tersedia (`src/lib/funnel.ts:35`).
7. **Duplikasi terkendali.** Mirror ID/EN memang menduplikasi struktur halaman (mis. `src/pages/en/*` vs `src/pages/*`), tetapi itu pola Astro i18n yang disengaja — logika tetap di `lib`. **Guard API admin: 24 route terhitung di `src/pages/admin/api/`; 19 memanggil `getAdmin`, 5 tidak.** Angka 19/24 **VALID**. Lima tanpa guard adalah route auth publik: `login.ts`, `logout.ts`, `otp.ts`, `password/confirm.ts`, `password/request.ts` — tidak satu pun memanggil `getAdmin`. Sisanya memakai pola `getAdmin` → 401 (mis. `src/pages/admin/api/assets/[id].ts:17`, `src/pages/admin/api/campaigns/index.ts:17`; total 42 respons 401 di `src/pages/admin/api/`).
8. **Guard middleware terpusat.** `src/middleware.ts:37-41` memanggil `applySecurityHeaders` untuk semua response; `:23-34` memakai pola `if (!headers.has(...))` sehingga CSP/HSTS/nosniff/referrer global tidak menimpa header per-route (preview menyetel CSP sendiri di `preview.ts:71`). Middleware **tidak** melakukan autentikasi — guard admin murni di level route via `getAdmin` (`src/lib/admin/guard.ts:13`), dan itulah mengapa kelima route auth memang berada di luar guard.
9. **Tidak ada bau klasik.** Nol `console.*` di `src/`; nol `TODO/FIXME/XXX/HACK` (case-sensitive maupun case-insensitive); nol `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable`. **Nuansa `placeholder`:** grep case-insensitive menghasilkan **22 baris / 26 kemunculan** (bukan 24; angka tergantung metode hitung) di 4 file — 19 baris di `src/pages/admin/campaigns/[id].astro` berupa atribut HTML `placeholder=` (mis. `:105,134`), 1 di `src/pages/admin/contacts/index.astro`, 1 di `src/pages/admin/domains.astro`, dan 1 di `src/pages/admin/api/email-campaigns/[id]/preview.ts:17` yang merupakan komentar tentang *template* placeholder `unsubscribe` (substitusi link), bukan sisa pekerjaan. Klaim "nol penanda sisa kerja" tetap benar, tetapi `placeholder` bukan penanda TODO.
10. **Suite hijau.** `npm test` (bukti eksternal lead): **49 file, 326 test, lulus semua (~66 detik)**. Terkonfirmasi ada 49 file `test/**/*.test.ts` sesuai `include` di `vitest.config.ts:2`; 5 file `*.spec.ts` e2e (`test/admin/e2e/*`, `test/broadcast/e2e/*`, `test/e2e/*`) memang di luar include dan dijalankan lewat Playwright.

## Yang belum diuji pada tahap ini

- `astro build` bersih (masuk tahap 10 Build & deployment).
- E2E Playwright (butuh browser + DB; dicatat untuk tahap 10/13).
- Review baris-per-baris tiap modul (audit ini sampling terstruktur, bukan line audit penuh).
- Runtime type-check: karena C4, tidak ada `astro check`/`tsc` yang bisa dijalankan sekarang.

## Rekomendasi prioritas

1. Tambah linter/formatter + gate CI (C1).
2. Tambah `typescript` + `@astrojs/check` ke devDependencies dan script `check` — tanpa ini build tidak memeriksa tipe (C4).
3. Ekstraksi bertahap tiga file editor besar bila disentuh lagi (C2); biarkan `as any` funnel apa adanya (C3).

## Catatan revisi audit ulang

| Klaim lama | Hasil verifikasi | Tindakan |
|---|---|---|
| C1: tidak ada `eslint*`/`biome*`/`prettier*` dan script lint/format | Terkonfirmasi: nol file di root; `package.json:8-17` tanpa script `lint`/`format` | Dipertahankan, bukti baris ditambah |
| C2: "dua file editor admin ~900 baris" (`campaigns/[id].astro` 999, `email-campaigns/[id].astro` 876) | Angka dua file benar; ada file ketiga `email-campaigns/[id]/laporan.astro` = 623 baris | Judul/diubah jadi "tiga file (999/876/623)", file ketiga ditambahkan (C2) |
| C3: `as any` hanya di `src/lib/funnel.ts:28-29` | Terkonfirmasi persis; nol `as any`/`any` eksplisit lain di `src/` | Dipertahankan; ditambah catatan assertion `as <Tipe>` non-`any` (9 di `src/lib/`) bukan temuan |
| C4: `typescript` absen, `tsc --noEmit` gagal; "(minor karena `astro check` implisit via build)" | Bagian pertama valid (`typescript` absen, `tsconfig.json:2` strict). Bagian "astro check implisit via build" **SALAH**: `package.json:10` = `astro build`; `@astrojs/check` tidak terpasang → build tidak type-check | Dikoreksi, severity dinaikkan; rekomendasi menambah `@astrojs/check` |
| Ringkasan: "dua file editor ~900 baris" | Sama seperti C2 | Diubah ke tiga file |
| Ringkasan/Verifikasi: "nol import `astro` di `src/lib/`" | Terkonfirmasi: nol hasil grep | Dipertahankan |
| Verifikasi: "19/24 API admin memakai `getAdmin`; 5 tanpa guard = auth publik" | Terkonfirmasi: 24 route; 19 memanggil `getAdmin`; 5 tanpa guard = `login.ts`, `logout.ts`, `otp.ts`, `password/confirm.ts`, `password/request.ts` | Dipertahankan, daftar 5 route + bukti baris ditambahkan |
| Verifikasi: "tidak ditemukan `catch {}` kosong yang menelan error penting" | Benar untuk blok `catch {}`; tetapi ada 3 `.catch(() => {})` no-op disengaja (`subscribe.ts:85`, `subscribe.ts:99`, `EmailForm.astro:118`) | Dipertahankan dengan nuansa swallow-sengaja ditambahkan |
| Verifikasi: pola Result di subscribe/OTP/machine | Terkonfirmasi, kini dengan file:line (`subscribe.ts:23-28`, `login.ts:28-33/91-95`, `machine.ts:24/68-71`, dll.) | Diperkuat bukti baris |
| Verifikasi: "`throw` hanya untuk kondisi programmer/infra" | 11 `throw` total; mayoritas benar (env `env.ts:5`, MIME/key `storage.ts:17,26,46`), tetapi ada juga precondition bisnis (`campaigns.ts:221` `campaign-not-found`, `password.ts:13`, `snapshot.ts:72`, `campaigns/[id].astro:655` `no-segment`) | Klaim dilunakkan; kategori ditambah contoh |
| Verifikasi: nama fungsi contoh (`getPublicCampaignState`, dll.) | Terkonfirmasi semua, file:line ditambahkan | Diperkuat bukti baris |
| Verifikasi: "`placeholder=` semuanya atribut input HTML yang sah" | Sebagian besar benar (20/22 baris HTML attr); `preview.ts:17` adalah komentar template placeholder, bukan atribut/TODO. Hitungan sebenarnya 22 baris/26 kemunculan, bukan 24 | Dikoreksi dan diberi nuansa |
| Verifikasi: suite "49 file, 326 test" | 49 file `test/**/*.test.ts` terkonfirmasi via `vitest.config.ts:2`; angka 326 test dikutip dari lead | Dipertahankan sebagai bukti eksternal |
| Label verdict "Verdict tahap 3" | Tidak menyebut nomor file audit | Diubah menjadi "Verdict audit 03" |
| Judul seksi "Verifikasi per area (yang 확인됨)" | Ada karakter Korea yang tidak disengaja | Diubah menjadi "(yang diverifikasi)" |
