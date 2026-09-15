# Audit 09 — Dependency Quality

Tanggal: 2026-09-14
Lingkup: library berlebihan/deprecated/vulnerability, outdated, lisensi, lockfile. Metode: `npm audit`, `npm audit --omit=dev`, `npm outdated`, `npm ls`, verifikasi pemakaian per paket (grep), baca field `license` di `node_modules/*/package.json`, cek riwayat git lockfile/config. Tidak ada perubahan kode.

## Ringkasan

Daftar dependensi **ramping dan disiplin**: 8 runtime + 6 dev (`package.json:20-29`, `package.json:33-40`), semuanya terpakai (tidak ada paket nganggur), tidak ada framework JS client, lisensi semuanya permissive (MIT/Apache-2.0/Unlicense/OFL-1.1/BSD-2-Clause), lockfile ter-commit (`git ls-files` → `package-lock.json`; 220.895 byte ≈ 215,7 KB), Docker memakai `npm ci` lalu `npm prune --omit=dev`.

Satu temuan minor: 4 vuln moderat dari rantai `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild 0.18.20` (D1) — dev-only, tidak mencapai produksi (`npm audit --omit=dev` → **0 vulnerabilities**). Temuan baru hasil audit ulang: D2 (2 paket transitif deprecated), D3 (duplikasi esbuild 3 versi), D4 (tanpa Dependabot/Renovate), D6 (skrip `tsx` di image runtime tidak bisa jalan karena dev deps diprun).

**Verdict audit 09: LULUS (dengan catatan)** — D1 tidak dapat ditutup oleh "sekali upgrade `drizzle-kit`" karena `0.31.10` sudah versi terbaru dan masih membawa `esbuild-kit`; tidak ada jalur fix non-breaking. Dampak produksi nihil.

## Temuan

### D1 — 4 vuln moderat via drizzle-kit (dev-only, tidak ke produksi)
- Status: **MINOR.** Dampak produksi nol.
- Bukti: `npm audit --omit=dev` → `found 0 vulnerabilities`. `npm audit` penuh → `4 moderate severity vulnerabilities`: `esbuild <=0.24.2` (dev-server request forgery, GHSA-67mh-4wv8-2f99) via `@esbuild-kit/core-utils → @esbuild-kit/esm-loader → drizzle-kit 0.19.0–1.0.0-beta.1-fd8bfcc`.
- Pohon terpasang (`npm ls esbuild`): `drizzle-kit@0.31.10` → `esbuild@0.25.12` (sendiri) + `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2` → `esbuild@0.18.20`. Yang vulnerable hanya `0.18.20`; top-level `esbuild@0.28.2` (via `astro@7.3.2`/`vite@8.3.0`/`tsx@4.23.13`) dan `0.25.12` tidak terflag.
- **Koreksi penting:** `drizzle-kit@0.31.10` adalah versi **terbaru** (`npm view drizzle-kit version` → `0.31.10`; `npm outdated` kosong) dan deklarasi dependensinya masih `"@esbuild-kit/esm-loader": "^2.5.5"`. Jadi rekomendasi lama "upgrade `drizzle-kit` ke rilis yang memakai esbuild ≥0.25 / men-drop esbuild-kit" **tidak dapat dijalankan** saat ini. Satu-satunya fix yang ditawarkan npm adalah `npm audit fix --force` → memasang `drizzle-kit@0.18.1` (breaking change/downgrade) — tidak direkomendasikan.
- Dampak: esbuild dev-server hanya relevan saat tooling lokal; tidak ada di image produksi (lihat D6).

### D2 — 2 paket transitif deprecated (KOREKSI klaim "tidak ada warning deprecated")
- Status: **MINOR / informatif.**
- Bukti registry: `npm view @esbuild-kit/core-utils deprecated` → `"Merged into tsx: https://tsx.hirok.io"`; idem `@esbuild-kit/esm-loader`. Versi terpasang keduanya sudah versi terakhir masing-masing (`3.3.2`, `2.6.5`) sehingga tidak ada versi non-deprecated untuk dipilih selama `drizzle-kit` masih menariknya.
- Tidak ada paket **top-level** yang deprecated (semua 14 dependensi langsung dicek `npm view <pkg> deprecated` → kosong).

### D3 — Duplikasi tiga versi `esbuild` (nuansa klaim "satu fungsi satu paket")
- Status: **MINOR.**
- Bukti (`package-lock.json` + `node_modules`): `esbuild@0.18.20`, `0.25.12`, `0.28.2` terpasang berdampingan; masing-masing membawa 25 paket binary `@esbuild/*` per versi. Duplikasi ini berasal dari transitif (`drizzle-kit`/`esbuild-kit`) dan tidak dikendalikan langsung oleh `package.json`.
- Klaim lama "setiap fungsi terwakili tepat satu paket" benar untuk paket top-level, tetapi tidak akurat di level transitif.

### D4 — Tanpa konfigurasi Dependabot/Renovate (temuan, bukan lagi "belum dinilai")
- Status: **MINOR / ops.**
- Bukti: `git ls-files | grep -iE "dependabot|renovate"` → kosong (exit 1); direktori `.github/` tidak ada di root repo; tidak ada `renovate.json`/`.renovaterc*`.

### D5 — `@types/sanitize-html` hanya dirujuk dari `package.json`
- Status: **OK (bukan nganggur).**
- Bukti: satu-satunya rujukan adalah `package.json:35`; tidak ada impor/rujukan di `src/`, `test/`, `scripts/`, atau `tsconfig.json`. Namun `tsconfig.json:1-6` meng-`extends` `astro/tsconfigs/strict` dan `include` `**/*` tanpa batasan `types`, sehingga `@types/sanitize-html` tetap dikonsumsi otomatis saat typecheck `sanitize-html` (dipakai di 7 file). Tetap dipertahankan.

### D6 — `tsx`/`dotenv` diprun, tetapi `scripts/` ikut disalin ke image runtime
- Status: **MINOR / potensi bug operasional.**
- Bukti: `Dockerfile:25` → `RUN npm prune --omit=dev` (dev deps termasuk `tsx` dihapus); `Dockerfile:36` → `COPY --from=build /app/scripts ./scripts`. Script `db:migrate`/`seed`/`admin:bootstrap` (`package.json:15-18`) dijalankan via `tsx`, sehingga perintah tersebut **tidak bisa dijalankan di image runtime** (tsx sudah diprun). `dotenv` juga devDependency namun beberapa script memakainya.
- Catatan: temuan ini bersinggungan dengan Audit 10 (build/deployment); di sini dicatat sebagai konsekuensi pruning, bukan duplikasi penilaian.

## Verifikasi per area (yang terverifikasi)

1. **Jumlah dependensi.** 8 runtime (`package.json:20-29`) + 6 dev (`package.json:33-40`) — **klaim lama benar**. `npm ls --omit=dev --depth=0` menampilkan tepat 8 paket runtime.
2. **Semua terpakai.** `drizzle-kit` dipakai via script `db:generate` (`package.json:17`) **dan** diimpor di `drizzle.config.ts:1` (koreksi: bukan hanya script); `tsx` hanya via script (`package.json:15-16,18`); `dotenv` di 9 file (`astro.config.mjs:2`, `scripts/{seed,bootstrap-admin,migrate}.ts:1`, `test/setup.ts:1`, 4 spec e2e); `@playwright/test` di 6 file; `vitest` diimpor di 49 file. Nol paket nganggur.
3. **Tidak deprecated.** Top-level: tidak ada. Transitif: 2 paket `@esbuild-kit/*` deprecated (D2).
4. **Lisensi aman.** Tidak ada GPL/copyleft:

   | Paket | Versi | License |
   |---|---|---|
   | astro | 7.3.2 | MIT |
   | @astrojs/node | 11.1.5 | MIT |
   | @fontsource/plus-jakarta-sans | 5.3.0 | OFL-1.1 |
   | @node-rs/argon2 | 2.2.1 | MIT |
   | aws4fetch | 1.0.20 | MIT |
   | drizzle-orm | 0.45.2 | Apache-2.0 |
   | postgres | 3.4.9 | Unlicense |
   | sanitize-html | 2.17.7 | MIT |
   | @playwright/test | 1.63.0 | Apache-2.0 |
   | @types/sanitize-html | 2.16.1 | MIT |
   | dotenv | 17.4.2 | BSD-2-Clause |
   | drizzle-kit | 0.31.10 | MIT |
   | tsx | 4.23.13 | MIT |
   | vitest | 5.0.0 | MIT |

5. **Reproducibility.** `package-lock.json` ter-commit dan satu-satunya lockfile (`git ls-files`), ukuran **220.895 byte ≈ 215,7 KB** (koreksi dari "197 KB"). `Dockerfile:16` memakai `npm ci`. `engines.node >=22.12.0` (`package.json:5-7`); runtime lokal v24.19.0 memenuhi.
6. **Tidak ada postinstall mencurigakan.** `"allowScripts": { "esbuild": true }` (`package.json:30-32`) — cakupan allow minimal per-paket, bukan `true` global.
7. **Versi terpasang.** `astro 7.3.2`, `vite 8.3.0`, `drizzle-kit 0.31.10`, `drizzle-orm 0.45.2`, `vitest 5.0.0`, `@playwright/test 1.63.0`, `tsx 4.23.13`, `postgres 3.4.9`, `sanitize-html 2.17.7`, `aws4fetch 1.0.20`, `@node-rs/argon2 2.2.1`, `dotenv 17.4.2`. `npm outdated` → **kosong** (tidak ada paket outdated). `typescript` **tidak terpasang** di `node_modules` (relevan Audit 03).

## Yang belum dinilai pada tahap ini

- Review otomatis berkelanjutan: dikonfirmasi **tidak ada** Dependabot/Renovate (D4) — masuk rekomendasi ops tahap 12/13.
- Kesesuaian lisensi font untuk embedding email (OFL-1.1 membolehkan; pemakaian web aman) — tidak diuji dari artefak email.
- Risiko SCA pada tooling dev di luar `npm audit` (mis. advisory yang belum masuk database npm).

## Rekomendasi prioritas

1. **D1 — jangan `npm audit fix --force`.** Itu men-*downgrade* ke `drizzle-kit@0.18.1` (breaking). Terima sebagai risiko dev-only; pantau upstream `drizzle-kit` agar drop `@esbuild-kit/esm-loader` (baru setelah itu `npm audit` penuh bisa bersih). Verifikasi ulang `npm audit --omit=dev` tetap 0 tiap rilis.
2. **D6 — putuskan strategi skrip di produksi.** Jika `db:migrate`/`seed` harus jalan di container, pindahkan `tsx` (dan `dotenv`) ke `dependencies` atau jalankan di tahap terpisah; jika tidak, hapus `COPY --from=build /app/scripts ./scripts` (`Dockerfile:36`) untuk mengecilkan permukaan image.
3. **D4 — aktifkan Dependabot/Renovate** (opsional) untuk pengingat upgrade rutin.
4. **D3 — opsional:** kurangi duplikasi `esbuild` bila upstream mengizinkan (override/pin), tanpa memaksa.

## Catatan revisi audit ulang

- Klaim "8 runtime + 6 dev" → **benar** → dipertahankan (`package.json:20-29`, `package.json:33-40`).
- Klaim "semua paket terpakai, nol nganggur" → **benar dengan nuansa** → diperjelas: `drizzle-kit` juga diimpor di `drizzle.config.ts:1`; `@types/sanitize-html` (`package.json:35`) hanya implisit via auto-include `@types` (D5).
- Klaim "dotenv 9 file / playwright 6 file / vitest 49 file" → **benar** → dipertahankan (angka cocok hasil grep).
- Klaim "tidak ada warning deprecated" → **SALAH** → dikoreksi: `@esbuild-kit/core-utils@3.3.2` dan `@esbuild-kit/esm-loader@2.6.5` deprecated di registry (D2).
- Klaim "lockfile 197 KB" → **SALAH** → dikoreksi menjadi 220.895 byte ≈ 215,7 KB.
- Klaim "Docker memakai `npm ci`" → **benar** (`Dockerfile:16`); **tambahan**: sudah ada `npm prune --omit=dev` (`Dockerfile:25`).
- Rekomendasi lama "`npm ci --omit=dev` di stage produksi" → **TIDAK BERLAKU** → dicabut; pruning sudah dilakukan di `Dockerfile:25`.
- Rekomendasi lama "upgrade `drizzle-kit` agar `npm audit` bersih" → **TIDAK BERLAKU** → direvisi: `0.31.10` sudah terbaru dan masih membawa `esbuild-kit`; fix npm justru downgrade breaking ke `0.18.1` (D1).
- Klaim pohon `drizzle-kit@0.31.10` membawa `esbuild@0.25.12` + `0.18.20` → **benar** → dipertahankan (`npm ls esbuild`).
- Klaim "setiap fungsi tepat satu paket" → **nuansa** → ditandai duplikasi `esbuild` 3 versi (D3).
- Klaim "Dependabot/Renovate belum dikonfirmasi" → **dikonfirmasi tidak ada** → dinaikkan menjadi temuan D4.
- Klaim "esbuild dev-server tidak ada di image produksi" → **benar** (dev deps diprun di `Dockerfile:25`), tetapi `scripts/` tetap disalin (`Dockerfile:36`) → ditambah temuan D6.
- Label "Verdict tahap 9" → **dikoreksi** menjadi "Verdict audit 09".
- Judul bagian "Verifikasi per area (yang 확인됨)" mengandung kata Korea → **dikoreksi** menjadi "(yang terverifikasi)".
- Catatan tambahan: `typescript` tidak ada di `node_modules` (dikonfirmasi; lintas-rujuk Audit 03).
