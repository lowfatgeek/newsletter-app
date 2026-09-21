# Audit 02 — UI/UX Quality

Tanggal: 2026-09-14 (revisi audit ulang: 2026-09-14)
Lingkup: layout, responsivitas, konsistensi visual, loading/error/empty states, kepatuhan DESIGN.md, token usage. Metode: read-only, verifikasi statis (tanpa render browser). Acuan: `.agents/DESIGN.md`, `src/styles/tokens.css`, layouts, components, pages. Tidak ada perubahan kode.

## Ringkasan

Kualitas UI/UX **baik dan konsisten**. Design system dipatuhi: token spacing/warna/radius dipakai merata, satu CTA primer per state, empty states berbahasa Indonesia dengan aksi lanjutan, error form memakai pola Rose Tint, tabel admin scroll horizontal, dan pola loading terlihat di editor admin (autosave "Menyimpan… / Tersimpan HH.MM").

Temuan utama setelah verifikasi ulang: **(U1)** header reward 64px di semua breakpoint padahal DESIGN menetapkan 72px desktop, dan **(U2)** tidak ada loading state pada submit klaim publik sehingga pengguna dapat menekan ulang saat jaringan lambat. Keduanya valid. Temuan konsistensi yang semula diklaim "enam `#ffffff` hardcoded" perlu dikoreksi: hanya **6** kemunculan yang berada di dokumen yang memuat `tokens.css`; kemunculan lain ada di dokumen HTML berdiri sendiri (`notfound.ts`, `templates.ts`) yang memang tidak bisa memakai CSS custom property. Verifikasi ulang juga menemukan 5 temuan baru: token `--page-shell` tak terpakai, padding desktop 40px tidak diterapkan, elemen status yang diminta DESIGN hilang di status page, target sentuh 36px di sebagian kontrol admin, dan `#form-error` pada form klaim yang tidak pernah diisi (dead code).

**Verdict audit 02: LULUS BERSYARAT** — tidak ada yang menghalangi lanjut ke tahap 3; U2 disarankan sebelum launch karena berkaitan dengan double submit.

## Temuan

### U1 — Tinggi header reward 64px di semua breakpoint (DESIGN §5: 64px mobile / 72px desktop)
- Status: **MINOR VISUAL. VALID.**
- Bukti: `src/pages/r/[slug].astro:58` dan `src/pages/en/r/[slug].astro:63` memakai `height: 64px` inline tanpa media query. DESIGN `.agents/DESIGN.md:139` menetapkan "Tinggi 64px mobile / 72px desktop".
- Konteks tambahan: tidak ada satu pun media query di halaman publik maupun komponen publik. Total `@media` di `src/` = 14, semuanya di `src/layouts/AdminLayout.astro` + halaman admin + `src/styles/tokens.css:73` (`prefers-reduced-motion`), jadi tidak ada jalur override 72px desktop di permukaan publik.
- Rekomendasi: tambah media query `min-width: 1024px → 72px`, atau dokumentasikan deviasi bila disengaja.

### U2 — Tidak ada loading state pada submit klaim publik
- Status: **UTAMA (UX, terkait double submit). VALID.**
- Bukti: handler submit `src/components/EmailForm.astro:145-147` hanya `if (!tokenInput.value) e.preventDefault();` — tidak menonaktifkan tombol dan tidak menampilkan status apa pun saat form dikirim. Tombol di-disable hanya selama timer berjalan lalu di-unlock (`src/components/EmailForm.astro:99-103`, `:120-126`).
- Koreksi perbandingan: login/OTP admin memang benar dalam hal **disable tombol + `cursor: wait`** (`src/pages/admin/login.astro:58,71`; `src/pages/admin/otp.astro:79,100`), tetapi **tidak menampilkan pesan "Memproses…"** — string itu tidak ada di repo. Pola label loading yang benar-benar ada adalah autosave editor: "Menyimpan…" / "Tersimpan HH.MM" (`src/pages/admin/campaigns/[id].astro:603,623`; `src/pages/admin/email-campaigns/[id].astro:680,692`).
- Dampak: pada jaringan lambat pengguna tidak mendapat umpan balik dan dapat menekan tombol berulang. Dampak fungsional terbatas karena server idempoten, tetapi pengalaman tetap buruk.
- Rekomendasi: tiru pola editor admin — disable tombol + label "Mengirim…" pada `submit` event form klaim.

### U3 — `#ffffff` hardcoded: 6 yang seharusnya token, 5 di dokumen standalone (koreksi)
- Status: **MINOR KONSISTENSI. DIKOREKSI.**
- Hitung ulang: `#ffffff` case-insensitive di `src/` = 12 kemunculan (11 di luar `tokens.css`). Case-sensitive `#ffffff` = 9 di luar `tokens.css`; 2 kemunculan lain memakai `#FFFFFF` huruf besar (`src/lib/templates.ts:26,41`).
- Yang benar-benar berada di dokumen yang memuat `tokens.css` (**6 kemunculan**, layak diganti token):
  - `src/components/CampaignPaused.astro:24` (teks badge di atas `--color-warning`)
  - `src/components/EmailForm.astro:79` dan `:124` (teks tombol submit)
  - `src/pages/akses/[token].astro:31`
  - `src/pages/en/akses/[token].astro:37`
  - `src/pages/subscribe-again/[token].astro:50`
- Yang **bukan pelanggaran** (dokumen HTML berdiri sendiri tanpa akses `tokens.css`):
  - `src/lib/notfound.ts:32,45` — halaman 404 mandiri (komentar `notfound.ts:8` menjelaskan CSS di-inline).
  - `src/lib/templates.ts:26,38,41` — layout HTML email; CSS custom property tidak didukung di klien email.
  - Kedua file itu juga memuat hex lain (`#36514B`, `#FFFCF5`, `#E7DED0`, `#6C7E79`, `#153B35`, `#176B5B`, `#124F44`). Semuanya wajar karena alasan yang sama, jadi klaim lama "tidak ada hex hardcoded lain di luar `tokens.css`" tidak akurat.
- Catatan: `tokens.css` tidak punya token khusus "teks di atas primary" (mis. `--color-on-primary`), jadi penggantian paling dekat adalah `var(--color-surface-raised)`.
- Rekomendasi: ganti 6 kemunculan di atas ke `var(--color-surface-raised)` (atau tambah token on-primary); biarkan `notfound.ts`/`templates.ts` apa adanya.

### U4 — Halaman root `/` placeholder tipis yang indexable (diperluas)
- Status: **MINOR / perlu keputusan produk. VALID, diperluas.**
- Bukti: `src/pages/index.astro:1-9` hanya heading "KelasWFA Kado" + "Halaman hadiah KelasWFA." tanpa daftar campaign, navigasi, atau redirect.
- Klaim lama "root orphan/tak terhubung" **salah**: `href="/"` muncul 10 kali — header reward (`src/pages/r/[slug].astro:60`, `src/pages/en/r/[slug].astro:65`), `src/components/CampaignPaused.astro:28`, `src/lib/notfound.ts:63`, `src/pages/batal-berlangganan/[token].astro:23`, `src/pages/en/batal-berlangganan/[token].astro:21`, `src/pages/konfirmasi/[token].astro:22`, `src/pages/en/konfirmasi/[token].astro:22`, `src/pages/subscribe-again/[token].astro:24,32`.
- Klaim "tanpa noindex" benar: `src/pages/index.astro` tidak mengoper prop `noindex`, dan `src/layouts/PublicLayout.astro:25` hanya merender `noindex` bila prop true → root **indexable**. Root juga tidak masuk sitemap (sitemap hanya URL reward: `src/pages/api/sitemap.xml.ts:33-46`).
- Rekomendasi: putuskan — direktori campaign, redirect ke campaign utama, atau `noindex` + copy layak bila root memang tidak dipakai.

### U5 — Navigasi admin mobile hanya topbar email + logout, tanpa drawer
- Status: **MINOR NAVIGASI. VALID.**
- Bukti: `src/layouts/AdminLayout.astro:102-121` — sidebar 240px `display:none` di bawah 1024px; penggantinya `.admin-mobile-bar` (`src/layouts/AdminLayout.astro:37-43`) hanya memuat email admin + tombol keluar, tanpa tautan Reward/Email/Kontak/Domain/Audit. DESIGN `.agents/DESIGN.md:213` menyebut "Mobile memakai topbar dan navigation drawer" — drawer tidak ada (grep `drawer|hamburger` tidak menemukan apa pun).
- Rekomendasi: tambah drawer/nav horizontal di mobile bar. Fungsionalitas tidak hilang (URL langsung tetap bisa), tetapi navigasi antar-section sulit di ponsel.

### U6 — Token `--page-shell` (1200px) dan padding desktop 40px tidak diimplementasikan (temuan baru)
- Status: **MINOR KEPATUHAN DESIGN.**
- Bukti: `--page-shell: 1200px` didefinisikan di `src/styles/tokens.css:61` tetapi tidak dipakai di mana pun (`grep -rn "page-shell" src` hanya menemukan definisinya). Dengan kata lain "public page shell max-width 1200px" pada `.agents/DESIGN.md:111` tidak diterapkan; halaman publik hanya memakai `--funnel-content`/`--download-content`.
- Begitu pula padding desktop 40px (`.agents/DESIGN.md:111`) tidak ada: `--space-10` (40px) didefinisikan di `src/styles/tokens.css:44` tapi tidak dipakai, dan halaman publik memakai `var(--space-5)` (20px) di semua lebar tanpa media query (mis. `src/pages/r/[slug].astro:66`, `src/pages/akses/[token].astro:21`).
- Rekomendasi: pakai `--page-shell` untuk header/shell publik dengan padding 20px→40px via media query, atau hapus token yang tidak terpakai agar tidak menyesatkan.
- Catatan: token lain yang juga tak terpakai: `--color-accent` (`tokens.css:16`), `--text-display` (`:29`), `--space-16` (`:46`), `--space-24` (`:48`), `--shadow-float` (`:58`).

### U7 — Elemen status page yang diminta DESIGN belum ada (temuan baru)
- Status: **MINOR VISUAL / KEPATUHAN DESIGN.**
- Cek email: DESIGN `.agents/DESIGN.md:188` meminta "envelope abstrak kecil" dan resend sebagai ghost button dengan cooldown jelas. Implementasi `src/pages/cek-email.astro` tidak punya ikon, dan "Kirim ulang" (`:37-40`) adalah tautan langsung kembali ke campaign (`:15-16`) tanpa cooldown.
- Download reward: DESIGN `.agents/DESIGN.md:190` meminta tiap asset tampil sebagai card dengan ikon file. `src/pages/akses/[token].astro:26-32` menampilkan nama + `mimeType · ukuran` + tombol, tanpa ikon file; bila `assets` kosong tidak ada empty state (daftar kosong tanpa pesan).
- Rekomendasi: tambahkan ikon outline (sesuai inventaris ikon `.agents/DESIGN.md:263`) dan indikator cooldown resend; tambah empty state pada daftar asset.

### U8 — Sebagian target sentuh admin 36px (< 44px DESIGN) (temuan baru)
- Status: **MINOR AKSESIBILITAS/TARGET SENTUH.**
- Bukti: `.btn-secondary { min-height: 36px }` di `src/pages/admin/domains.astro:126` dan `src/pages/admin/contacts/index.astro:249`; input pencarian kontak `min-height: 36px` di `src/pages/admin/contacts/index.astro:262`; `.btn-small { min-height: 36px }` di `src/pages/admin/campaigns/[id].astro:388`. DESIGN `.agents/DESIGN.md:204` menetapkan minimum touch target 44px.
- Sebaliknya, mayoritas kontrol sudah benar: tombol auth/CTA 44px (`src/pages/admin/login.astro:52`, `src/pages/admin/otp.astro:73`), baris tabel 56px (`src/pages/admin/contacts/index.astro:309`, `src/pages/admin/contacts/[id].astro:262`), nav admin (`src/layouts/AdminLayout.astro:72-75`, padding 10px + min-height 24px) dan tombol 44px (`:78-89`), kontrol publik 44–48px (`src/components/LocaleSwitch.astro:10,12`; `src/components/ReflectionTabs.astro:23,32`; `src/components/EmailForm.astro:62,79`).
- Rekomendasi: naikkan kontrol 36px ke 44px.

### U9 — `#form-error` form klaim tidak pernah diisi + tidak ada `aria-describedby` (temuan baru)
- Status: **MINOR ERROR STATE / DEAD CODE.**
- Bukti: `src/components/EmailForm.astro:65` merender `<p id="form-error" hidden>` bergaya Rose Tint, tetapi tidak ada kode mana pun yang mengisi `textContent`-nya (grep `form-error` hanya menemukan deklarasi). Input email (`:55-63`) juga tidak punya `aria-describedby`. Copy `tooFast` (`src/components/EmailForm.astro:21`) ikut tak terpakai di klien.
- Ini mengoreksi klaim lama bahwa `#form-error` "diisi oleh validasi bawaan browser": browser menampilkan bubble validasi sendiri, bukan mengisi elemen itu. Error server justru diarahkan ke halaman `cek-email` (`src/pages/cek-email.astro:17-23`).
- DESIGN `.agents/DESIGN.md:183` dan `:286` meminta error dekat field dengan `aria-describedby` dan fokus ke error pertama. Rekomendasi: isi `#form-error` dari hasil redirect/handler dan hubungkan via `aria-describedby`, atau hapus elemen mati.

### U10 — Badge "EN belum lengkap — fallback ID" hanya `role=status` di halaman preview (temuan baru)
- Status: **MINOR AKSESIBILITAS.**
- Bukti: `role="status"` hanya di `src/pages/admin/preview/[id].astro:85`. Badge di editor reward (`src/pages/admin/campaigns/[id].astro:150`) dan editor email campaign (`src/pages/admin/email-campaigns/[id].astro:158`) adalah `<span>` biasa yang di-toggle JS tanpa `role`/`aria-live`; perubahan status tidak diumumkan. Mengoreksi klaim lama "Badge … memakai `role=status`" yang benar hanya untuk halaman preview.
- Rekomendasi: samakan dengan preview (`role="status"`/`aria-live="polite"`).

## Verifikasi per area

1. **Token system.** `src/styles/tokens.css` lengkap (warna, tipografi Plus Jakarta Sans 400/600/700, spacing, radius, shadow, focus ring, widths, `prefers-reduced-motion` di `:73`). Di luar token, `#ffffff` di dokumen ber-token hanya U3 (6 kemunculan); `notfound.ts`/`templates.ts` adalah dokumen berdiri sendiri dan wajar hardcoded. Token tak terpakai: `--page-shell`, `--color-accent`, `--text-display`, `--space-10/16/24`, `--shadow-float`.
2. **Layout publik.** Funnel satu kolom `max-width: 680px` (`src/pages/r/[slug].astro:66`), konten unduh 760px (`src/pages/akses/[token].astro:21`), auth 440px (`src/layouts/AdminLayout.astro:98`). Viewport meta benar di kedua layout (`src/layouts/PublicLayout.astro:22`, `src/layouts/AdminLayout.astro:15`). Canonical + hreflang terpasang di halaman reward (`src/pages/r/[slug].astro:53-54`, `src/pages/en/r/[slug].astro:58-59`). Catatan: token `--page-shell` 1200px tidak dipakai (U6).
3. **Hierarki konten.** RewardHero (overline → H1 → deskripsi → featured image eager 1200×630 dengan alt = judul) di `src/components/RewardHero.astro:11-22`; daftar item dengan ikon gift SVG, bukan emoji (`src/components/RewardItemList.astro:17,21-26`); ReflectionTabs; form email terakhir (`src/pages/r/[slug].astro:67-79`) — sesuai prinsip "hadiah dulu, form kemudian".
4. **Satu CTA per state.** Tombol klaim abu nonaktif selama timer → primary setelah selesai (`src/components/EmailForm.astro:99-103,120-126`); pola `:disabled`/`aria-disabled` dipakai. Tidak ada CTA ganda dominan di halaman publik.
5. **Timer sebagai ritual tenang.** Progress bar 4px (`src/components/EmailForm.astro:50`) + `aria-live polite` yang hanya mengumumkan "10 detik lagi" dan "selesai" (`:131-139`). Tanpa JS tombol tetap aktif karena server merender tombol tanpa `disabled` (`:71-80`), dan server menegakkan 30 detik (`src/lib/timer.ts:4,31-32`).
6. **Form.** Label permanen "Email untuk menerima hadiah" (`src/components/EmailForm.astro:54`), `type=email`, `autocomplete=email`, `inputmode=email`, `required` (`:55-63`), font 16px + min-height 48px (`:62`), copy newsletter + privacy link (`:67-69`), honeypot tersembunyi `aria-hidden` + `tabindex=-1` (`:38`).
7. **Cek-email.** Email disamarkan di server (`src/lib/templates.ts:4-7`, format `xx**@domain` sesuai DESIGN §5), pesan error spesifik per kode `bad-request/too-fast/rate-limited/domain-not-allowed/campaign-unavailable` (`src/pages/cek-email.astro:17-23`), tombol "Kirim ulang" menaut ke campaign asal via `?s=` (`src/pages/cek-email.astro:15-16,37-40`). Kekurangan: tanpa ikon dan tanpa cooldown (U7).
8. **Akses/unduh.** Pesan masa berlaku 1 jam (`src/pages/akses/[token].astro:23`), daftar asset dengan format/ukuran (`:26-32`; `humanSize`), redirect ke `/` bila token tak valid (`:13`), state kedaluwarsa ramah (`.agents/DESIGN.md:192`; halaman konfirmasi `src/pages/konfirmasi/[token].astro:14-24`). Kekurangan: tanpa ikon file dan tanpa empty state asset (U7).
9. **Halaman paused.** Komponen khusus dengan pesan ramah (`src/components/CampaignPaused.astro:22-31`); toggle bahasa tetap tampil di header di atasnya (`src/pages/r/[slug].astro:61-64`).
10. **404.** Terpusat via `notFoundHtml()` (`src/lib/notfound.ts:10-68`), dipakai `src/pages/404.astro:4` dan route reward (`src/lib/notfound.ts:75-80`).
11. **Empty states admin.** Campaign (`src/pages/admin/campaigns/index.astro:60-64`, CTA "Buat reward campaign"), email-campaign (`src/pages/admin/email-campaigns/index.astro:72-76`, CTA "Buat email campaign"), kontak cocok filter (`src/pages/admin/contacts/index.astro:145-148`, copy tanpa CTA), domain (`src/pages/admin/domains.astro:50-53`, copy + form tambah inline di `:45`), audit (`src/pages/admin/audit.astro:60-62`), sub-state kontak (`src/pages/admin/contacts/[id].astro:124,154,170`). Klaim lama "masing-masing dengan CTA" perlu dikualifikasi: hanya campaign/email yang punya tombol CTA; domain memakai form inline; kontak/audit copy-only.
12. **Error states.** Login/OTP/reset/new-campaign pakai `role=alert` (`src/pages/admin/login.astro:15`, `src/pages/admin/otp.astro:26`, `src/pages/admin/reset.astro:16,30`, `src/pages/admin/campaigns/new.astro:22`, `src/pages/admin/email-campaigns/new.astro:20`); cek-email memakai box warning (`src/pages/cek-email.astro:32-36`). Form klaim: `#form-error` ada tetapi **tidak pernah diisi** (U9) — koreksi klaim lama.
13. **Loading states admin.** Login/OTP/reset/new-campaign disable tombol saat kirim (`src/pages/admin/login.astro:71`, `src/pages/admin/otp.astro:100`, `src/pages/admin/reset.astro:108,137`, `src/pages/admin/campaigns/new.astro:119`, `src/pages/admin/email-campaigns/new.astro:86`). Editor memakai "Menyimpan…/Tersimpan" dengan `role=status` (`src/pages/admin/campaigns/[id].astro:80,603,623`; `src/pages/admin/email-campaigns/[id].astro:82,680,692`). Dashboard funnel SSR tanpa skeleton (`src/pages/admin/index.astro:35-62`) — dapat diterima.
14. **Responsivitas.** Breakpoint nyata: 480/640/768/900/1023px (bukan 1024). 640 dipakai 9x (`src/pages/admin/audit.astro:174`, `src/pages/admin/index.astro:108`, `src/pages/admin/domains.astro:183`, `src/pages/admin/campaigns/index.astro:191`, `src/pages/admin/campaigns/[id].astro:411`, `src/pages/admin/email-campaigns/index.astro:212`, `src/pages/admin/email-campaigns/[id].astro:395,473`, `src/pages/admin/email-campaigns/[id]/laporan.astro:496`), 768 di `src/pages/admin/campaigns/[id].astro:461`, 900 & 480 di `src/pages/admin/email-campaigns/[id]/laporan.astro:377-378`, 1023 di `src/layouts/AdminLayout.astro:102`. Grid `.grid-2` → 1 kolom di ≤640px; KPI laporan 6 → 3 kolom (≤900px) → 2 kolom (≤480px) (`laporan.astro:373,377,378`). Tabel admin `overflow-x: auto` (`src/pages/admin/audit.astro:128`, `domains.astro:158`, `campaigns/index.astro:143`, `contacts/index.astro:298`, `contacts/[id].astro:260`, `email-campaigns/index.astro:163`, `email-campaigns/[id]/laporan.astro:419`). CTA klaim full-width (`src/components/EmailForm.astro:79`); tab refleksi `flex:1` + min-height 44px (`src/components/ReflectionTabs.astro:23,32`).
15. **Focus visible.** Token `--focus-ring` dipakai eksplisit di form admin (`src/pages/admin/domains.astro:147`, `campaigns/new.astro:69`, `contacts/index.astro:266`, `campaigns/[id].astro:438,489`, `email-campaigns/[id].astro:421`), dan tersedia global untuk seluruh permukaan publik via `:focus-visible { box-shadow: var(--focus-ring) }` di `src/styles/tokens.css:72` yang dimuat `src/layouts/PublicLayout.astro:7`.
16. **Konsistensi bahasa.** Copy UI Indonesia; halaman EN memakai kamus `en` terpisah (`src/lib/i18n.ts:3-50`). Badge "EN belum lengkap — fallback ID" memakai `role=status` **hanya** di preview (`src/pages/admin/preview/[id].astro:85`) — lihat U10.

## Yang belum diuji pada tahap ini

- Render visual aktual di browser (320/390/768/1024/1440px), screenshot, atau uji sentuh.
- Kontras warna terukur (alat ukur) — dibahas di tahap 8 Accessibility.
- Perilaku JS timer/tab saat gagal fetch atau dengan screen reader nyata.

## Rekomendasi prioritas

1. Tambah loading/disable pada submit klaim (U2).
2. Selaraskan tinggi header desktop 72px atau dokumentasikan deviasi (U1).
3. Ganti enam `#ffffff` ke token (U3); biarkan `notfound.ts`/`templates.ts`.
4. Putuskan nasib halaman root `/` (U4) dan navigasi admin mobile (U5).
5. Terapkan `--page-shell`/padding desktop 40px atau hapus token mati (U6); lengkapi ikon/cooldown status page (U7).
6. Naikkan target sentuh 36px → 44px (U8); isi atau hapus `#form-error` + `aria-describedby` (U9); samakan `role=status` badge fallback (U10).

## Catatan revisi audit ulang

Revisi dilakukan dengan verifikasi ulang seluruh klaim terhadap kode saat ini (read-only).

| Klaim lama | Hasil verifikasi | Tindakan |
|---|---|---|
| U1: header reward 64px tanpa override 72px | Benar. `src/pages/r/[slug].astro:58`, `src/pages/en/r/[slug].astro:63`; DESIGN `.agents/DESIGN.md:139`. Tidak ada media query di komponen/halaman publik (total `@media` di `src/` = 14) | Dipertahankan, ditambah konteks bukti |
| U2: tidak ada loading state submit klaim | Benar. Handler `src/components/EmailForm.astro:145-147` hanya guard token kosong | Dipertahankan |
| U2: login/OTP menampilkan pesan "Memproses…" | **Salah.** Tidak ada string "Memproses" di repo. Yang benar: disable + `cursor: wait` (`src/pages/admin/login.astro:58,71`; `otp.astro:79,100`). Pola label "Menyimpan…" ada di editor (`campaigns/[id].astro:603,623`) | Dikoreksi di U2 |
| U3: "enam `#ffffff` hardcoded", "tidak ada hex lain di luar tokens.css" | Setengah benar. 6 kemunculan di dokumen ber-token benar-benar layak diganti; tetapi ada 5 lagi di dokumen standalone (`src/lib/notfound.ts:32,45`; `src/lib/templates.ts:26,38,41`) plus hex lain, yang memang required | Dikoreksi total di U3 |
| U3: "seharusnya memakai token" untuk semua | Tidak untuk `notfound.ts`/`templates.ts` (HTML mandiri/email, CSS var tidak didukung) | Dikualifikasi |
| U4: root `/` placeholder tanpa daftar campaign & tanpa noindex | Benar. `src/pages/index.astro:1-9`; `noindex` hanya bila prop true (`src/layouts/PublicLayout.astro:25`) | Dipertahankan |
| U4: root orphan/tak terhubung | **Salah.** `href="/"` ada 10 kemunculan (header reward, `CampaignPaused.astro:28`, `notfound.ts:63`, `batal-berlangganan` 2x, `konfirmasi` 2x, `subscribe-again` 2x) | Dikoreksi; ditambah fakta root indexable & tidak ada di sitemap (`sitemap.xml.ts:33-46`) |
| U5: admin mobile tanpa drawer | Benar. `src/layouts/AdminLayout.astro:102-121,37-43`; DESIGN `.agents/DESIGN.md:213` | Dipertahankan |
| Verifikasi #1: tidak ada hex di luar token kecuali U3 | **Salah.** Ada hex di `notfound.ts` & `templates.ts` (standalone, wajar) | Dikoreksi |
| Verifikasi #2: shell 1200px terpasang | **Salah.** `--page-shell` (`tokens.css:61`) tidak dipakai di mana pun; padding desktop 40px (`--space-10`) juga tidak dipakai | Diganti jadi temuan U6 |
| Verifikasi #3: ikon gift SVG, bukan emoji | Benar. `src/components/RewardItemList.astro:17,21-26` | Dipertahankan |
| Verifikasi #5: server menegakkan 30 detik tanpa JS | Benar. `src/lib/timer.ts:4,31-32`; tombol dirender aktif `EmailForm.astro:71-80` | Dipertahankan |
| Verifikasi #7: cek-email error spesifik & resend ke campaign | Benar. `src/pages/cek-email.astro:15-23,37-40` | Dipertahankan |
| Verifikasi #11: semua empty state punya CTA | **Tidak akurat.** Hanya campaign/email punya tombol; domain pakai form inline; kontak/audit copy-only | Dikualifikasi |
| Verifikasi #12: `#form-error` diisi validasi browser | **Salah.** `src/components/EmailForm.astro:65` tidak pernah diisi kode mana pun; input tanpa `aria-describedby` | Dikoreksi jadi temuan U9 |
| Verifikasi #13: login/OTP disable saat kirim | Benar (`login.astro:71`, `otp.astro:100`), label loading ada di editor autosave | Dikualifikasi |
| Verifikasi #14: breakpoint 640/768/900/1024; KPI 3→2 kolom | **Sebagian salah.** Breakpoint nyata 480/640/768/900/1023 (1024 tidak dipakai); KPI 6→3→2 (`laporan.astro:373,377,378`) | Dikoreksi |
| Verdict "Verdict tahap 2" | Label tidak sesuai nomor file | Diganti "Verdict audit 02" |

## Addendum (2026-09-21): Penyempurnaan Affordance & UI Tab Refleksi
- **Temuan Lapangan / Evaluasi UX & UI**: 
  1. *Affordance*: Tab nonaktif awal berlatar transparan di atas card putih tanpa batas fisik, rawan disalahartikan sebagai teks statis.
  2. *Color Harmony & Elevation*: Menumpuk mint pastel di atas track krem pastel menimbulkan tabrakan suhu warna (*cool mint vs warm linen*) dan tampak datar.
- **Tindakan Penyempurnaan (Segmented Control Track + Elevated White Pill)**:
  - Wadah `role="tablist"` dibungkus track Linen Surface (`--color-surface-subtle` / `#F7F1E6`), border halus Paper Border, padding 4px (`--space-1`), radius 12px (`--radius-control`), dan lebar maksimal proporsional 440px (100% responsif di mobile).
  - Tab aktif berupa *elevated pill* berlatar White Surface (`--color-surface-raised` / `#FFFFFF`), teks Forest Action (`--color-primary` / `#176B5B`), border-radius 8px, serta bayangan taktil (`box-shadow: 0 2px 6px rgba(21, 59, 53, 0.08), 0 1px 2px rgba(21, 59, 53, 0.04)`).
  - Tab nonaktif transparan di dalam track dengan warna Body Moss (`--color-text`) dan hover Ink Forest (`--color-ink`).
- **Dampak Kepatuhan**: Memberikan ilusi kedalaman fisik (*recessed track vs elevated floating pill*), mengeliminasi tabrakan temperatur warna, serta mempertahankan kepatuhan penuh WAI-ARIA APG dan target sentuh minimum 44px.


