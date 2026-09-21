# Audit 06 — Accessibility

Tanggal: 2026-09-14 (audit ulang kontras + verifikasi klaim: 2026-09-14)
Lingkup: landmark, label, ARIA, keyboard, fokus, kontras, target sentuh, motion, tabel, error. Metode: read-only + perhitungan rasio kontras WCAG dari token (Node one-liner, formula relative luminance WCAG 2.x). Tanpa screen reader, tanpa axe/Pa11y runtime, tanpa uji keyboard manual di browser. Tidak ada perubahan kode.

## Ringkasan

Fondasi aksesibilitas **kuat**. Yang benar: satu H1 per halaman, `lang` mengikuti locale konten efektif, tabs memakai pola roving-tabindex + panah kiri/kanan, tabel memakai `scope="col"`, error memakai `role="alert"` dan status memakai `role="status"` + `aria-live`, `prefers-reduced-motion` mematikan transisi/animasi, target sentuh primer 44–48px, kontras teks utama 8,4–12,3:1. Focus ring juga ternyata sudah global sejak awal (koreksi A11y6).

Temuan kontras/teks: A11y1 (badge gold di **satu** lokasi admin), A11y2 (muted kecil, termasuk permukaan publik), A11y3 (link info), A11y4 catatan lulus. Navigasi: A11y5 (skip link tidak ada) tetap valid; A11y6 (focus publik) **tidak berlaku**. Semua terukur dari nilai token, bukan tebakan.

**Verdict audit 06: LULUS BERSYARAT** — A11y2 (muted kecil, tampil di permukaan publik: form klaim, privacy, 404, overline hero) sebaiknya diperbaiki sebelum launch; A11y1 dan A11y3 hanya di permukaan admin, sisanya backlog wajar.

## Temuan

### A11y1 — Teks gold `#D99020` di atas gold-subtle `#FFF2D6` hanya 2,38:1 (gagal AA) — terbatas satu lokasi
- Status: **UTAMA (dipersempit).** Setelah verifikasi ketiga kemunculan `.fallback-badge`, hanya **satu** yang memakai pasangan gold dan benar-benar gagal.
- Bukti (terhitung):
  - `src/pages/admin/campaigns/[id].astro:401-403` — `.fallback-badge { background: var(--color-gold-subtle); color: var(--color-gold); }`: **2,38:1** → GAGAL AA teks normal (4,5:1). Badge ditampilkan via `hidden` + JS (`#en-fallback`, `:150`; toggle `:552`).
  - `src/pages/admin/email-campaigns/[id].astro:354-356` — `.fallback-badge` memakai `--color-warning-subtle` + `--color-warning`: **4,53:1** → LULUS tipis.
  - `src/pages/admin/preview/[id].astro:66-68` (dan `<p class="fallback-badge" role="status">` di `:85`) — `--color-warning-subtle` + `--color-warning`: **4,53:1** → LULUS tipis.
- Dampak: satu badge "EN kosong — fallback ID" di editor campaign sulit dibaca pengguna low-vision. Permukaan admin, bukan publik.
- Rekomendasi: ganti warna teks badge `campaigns/[id].astro` ke emas gelap `#8A5A10` — **5,33:1** di atas `#FFF2D6` (terhitung). **Jangan** memakai `--color-warning` `#9A6514` di atas gold-subtle: terhitung **4,46:1** (di bawah 4,5), meski di atas warning-subtle ia lulus 4,53:1. Ukur ulang bila token berubah.

### A11y2 — Teks muted kecil di bawah ambang AA di beberapa permukaan
- Status: **UTAMA (parsial).**
- Bukti (terhitung):
  - `--color-text-muted` `#6C7E79` di atas putih/raised: **4,29:1** — gagal AA normal (4,5:1), lulus AA large (3:1).
  - Sama di atas `--color-surface-subtle` `#F7F1E6`: **3,81:1**; di atas kanvas `--color-canvas` `#FFFCF5`: **4,18:1**. (Keduanya gagal AA teks normal.)
  - Dipakai pada ukuran kecil (`--text-body-sm` 14px), termasuk permukaan publik:
    - Consent + link privasi form klaim: `src/components/EmailForm.astro:67`.
    - Deskripsi format/ukuran item: `src/components/RewardItemList.astro:31`.
    - Overline hero (uppercase 14px) di atas kanvas: `src/components/RewardHero.astro:11`.
    - Halaman Kebijakan Privasi (seluruh body text): `src/pages/privacy.astro:9`.
    - Halaman 404 (paragraf, muted `#6C7E79` di kanvas `#FFFCF5`): `src/lib/notfound.ts:42`.
    - Locale switch non-aktif: `src/components/LocaleSwitch.astro:12`.
    - Helper/hint admin (contoh): `src/pages/admin/domains.astro:102,148,162`, `src/pages/admin/audit.astro:106`, `src/pages/admin/campaigns/[id].astro:359,439`, `src/pages/admin/campaigns/new.astro:31,70`.
    - Badge `tone-muted` / `badge-inactive` (muted di surface-subtle, 3,81:1): `src/pages/admin/campaigns/index.astro:178`, `src/pages/admin/email-campaigns/index.astro:198`, `src/pages/admin/domains.astro:180`.
- Catatan: JS menonaktifkan tombol klaim dengan muted di surface-subtle (`src/components/EmailForm.astro:101-102`) — ini kontrol `disabled`, dikecualikan WCAG 1.4.3, bukan temuan.
- Dampak: teks sekunder — termasuk copy consent newsletter di form klaim — di bawah ambang baca AA untuk teks normal.
- Rekomendasi: gelapkan token muted satu langkah (mis. `#566662` → **6,05:1** di atas putih, **5,38:1** di atas surface-subtle, **5,90:1** di atas kanvas — terhitung) lalu verifikasi ulang seluruh pemakaian; atau batasi muted hanya untuk teks besar/≥18px. Satu perubahan token memperbaiki semua pemakaian sekaligus.

### A11y3 — Link info `#2D87B8` di atas putih 3,99:1 (gagal AA untuk teks kecil)
- Status: **MINOR.**
- Bukti: link "kebijakan privasi" di consent form (`src/components/EmailForm.astro:68`, warna `var(--color-info)`): **3,99:1** di atas putih, **3,89:1** di atas kanvas. `.tone-info` laporan (`src/pages/admin/email-campaigns/[id]/laporan.astro:458`, info di atas info-subtle): **3,52:1** — juga gagal.
- Dampak: link kebijakan privasi — bagian dari consent — di bawah ambang AA.
- Rekomendasi: gelapkan info untuk teks (mis. `#24709A` → **5,44:1** di atas putih, **4,81:1** di atas info-subtle — terhitung). Token info-subtle tetap untuk latar.

### A11y4 — Pasangan tone lain lulus; pola aman (dicatat agar tidak diuji ulang)
- Status: **INFORMATIF (lulus).**
- Bukti (terhitung): danger/white **5,66:1**; success/white **5,27:1**; danger/danger-subtle **4,95:1**; success/success-subtle **4,73:1**; warning/white **4,95:1**; warning/warning-subtle **4,53:1**; primary/white **6,38:1**; primary/primary-subtle **5,55:1**; teks/white **8,62:1**, teks/kanvas **8,42:1**; ink/white **12,29:1**, ink/gold-subtle **11,07:1**, ink/warning-subtle **11,25:1**.
- Catatan: warning 4,53:1 dan success-subtle 4,73:1 dekat ambang — jangan menggelapkan latarnya tanpa mengukur ulang. **Warning di atas gold-subtle hanya 4,46:1 (gagal)** — pasangan ini tidak tercatat di audit lama, sebaiknya dihindari.

### A11y5 — Tidak ada skip link; landmark sebenarnya ada
- Status: **MINOR (bukti dikoreksi).**
- Bukti: grep `skip` di `src/` hanya menemukan `skipLocked` di `src/lib/mailworker.ts:18` dan counter `skipped` di `src/lib/broadcast/worker.ts:39` — tidak ada skip link. Namun klaim lama "tanpa `<nav>`" **salah**: halaman reward memuat `<nav aria-label="Pilih bahasa">` (`src/components/LocaleSwitch.astro:14`, dirender di `src/pages/en/r/[slug].astro:66` dan `src/pages/r/[slug].astro:61`), dan `<header>` banner di `src/pages/en/r/[slug].astro:61` / `src/pages/r/[slug].astro:56`. Landmark yang ada tidak salah; yang hilang hanya jalan pintas lompat ke form.
- Rekomendasi: tambah skip link "Lewati ke form klaim" di halaman reward (murah, pola standar). Bukan penghalang — tab order halaman pendek dan logis.

### A11y6 — ~~Tidak ada gaya `:focus-visible` di permukaan publik~~ (TIDAK BERLAKU / LULUS)
- Status: **MINOR → DICABUT.** Klaim lama tidak akurat.
- Bukti: ada aturan global `:focus-visible { outline: none; box-shadow: var(--focus-ring); }` di `src/styles/tokens.css:72`, dengan token `--focus-ring: 0 0 0 3px rgba(23, 107, 91, 0.24)` di `src/styles/tokens.css:59`. Aturan ini berlaku ke seluruh dokumen (selektor universal). `src/layouts/PublicLayout.astro:7` dan `src/layouts/AdminLayout.astro:6` sama-sama mengimpor `tokens.css`, jadi permukaan publik sudah mendapat focus ring dari satu aturan global itu. Form admin hanya menambah override border-color pada elemen yang sama (`src/pages/admin/campaigns/[id].astro:438`, `:489`; `src/pages/admin/domains.astro:147`; dst.).
- Rekomendasi: tidak ada tindakan. (Catatan minor non-temuan: karena berbasis `box-shadow`, ring bisa tak terlihat pada elemen yang sudah melukis box-shadow di lapisan sama — tidak ditemukan kasus nyata.)

## Verifikasi per area (yang terverifikasi)

1. **Heading.** Satu H1 per halaman (reward via `src/components/RewardHero.astro:12`; halaman status/404 juga satu). Tidak ditemukan H1 ganda.
2. **Bahasa.** `html lang` mengikuti locale konten efektif — `/en/r/<slug>` yang fallback ke konten ID memakai `lang="id"` (`src/pages/en/r/[slug].astro:39` menghitung `locale`, `:56` meneruskan `lang={locale}` ke `PublicLayout`; layout `src/layouts/PublicLayout.astro:19`). Benar untuk screen reader.
3. **Tabs refleksi.** `role=tablist/tab/tabpanel`, `aria-selected/controls/labelledby`, roving `tabindex`, panah kiri/kanan dengan wrap, klik tidak mencuri fokus: `src/components/ReflectionTabs.astro:16-49` dan skrip `:52-84`. Pola APG yang benar.
4. **Tabel admin.** `<th scope="col">` konsisten (contoh `src/pages/admin/domains.astro:60-63`, `src/pages/admin/audit.astro:68-71`, `src/pages/admin/contacts/index.astro:155-159`, `src/pages/admin/email-campaigns/[id]/laporan.astro:227-232`).
5. **Error & status.** `role="alert"` untuk error (`src/pages/admin/login.astro:15`, `otp.astro:26`, `reset.astro:16,30`, `campaigns/new.astro:22`, `campaigns/[id].astro:86`), `role="status"` + `aria-live="polite"` untuk status async (`campaigns/[id].astro:80,207,275`, `email-campaigns/[id].astro:82,278`, `domains.astro:32`). Timer memakai live region hemat (hanya "10 detik lagi" + "selesai"): `src/components/EmailForm.astro:44-48,131-135`.
6. **Label.** Form publik berlabel permanen (`for="email"` di `src/components/EmailForm.astro:54`, input `:55-63`); form admin berlabel; 45 `<label>` + 50 `aria-label` di `src/`. Honeypot `aria-hidden` + `tabindex="-1"` (`src/components/EmailForm.astro:38`).
7. **Gambar.** Hero `alt` = judul + `width`/`height` eksplisit (`src/components/RewardHero.astro:15-20`); ikon gift SVG `aria-hidden` (`src/components/RewardItemList.astro:17,23`).
8. **Motion.** `prefers-reduced-motion` mematikan semua transisi/animasi (`src/styles/tokens.css:73-75`); tidak ada konten berkedip/autoplay.
9. **Target sentuh.** Primer 44–48px (tab `ReflectionTabs.astro:23,32`; input email `EmailForm.astro:62`; CTA `:79`; nav admin `AdminLayout.astro:85`). Sekunder 36px: `.btn-small` (`src/pages/admin/campaigns/[id].astro:388`, `domains.astro:126`, `contacts/index.astro:249,262`); link nav sidebar `min-height: 24px` (`src/layouts/AdminLayout.astro:74`, teks). Dapat diterima, bukan temuan.
10. **404.** Dokumen mandiri `lang="id"` + viewport + CTA jelas: `src/lib/notfound.ts:11-16,43-53,63` (dipakai `src/pages/404.astro:4`).

## Yang belum diuji pada tahap ini

- Screen reader nyata (NVDA/VoiceOver), navigasi keyboard manual, axe/Pa11y otomatis, zoom 200%, mode kontras tinggi Windows.
- Disarankan sebagai acceptance pra-launch: satu putaran axe + tab-through halaman reward dan composer admin.

## Rekomendasi prioritas

1. Gelapkan token muted untuk teks (A11y2) — satu perubahan token, ukur ulang; dampak terbesar karena menyentuh form klaim, privacy, 404.
2. Perbaiki teks badge gold di `campaigns/[id].astro` (A11y1) — satu baris CSS, pakai `#8A5A10` (5,33:1).
3. Gelapkan token info untuk teks (A11y3) — `#24709A` (5,44:1), ukur ulang.
4. Tambah skip link halaman reward (A11y5). A11y6 dicabut (sudah lulus).

## Catatan revisi audit ulang

Ringkas: klaim lama → hasil verifikasi → tindakan.

| Klaim lama | Hasil verifikasi (file:line) | Tindakan |
|---|---|---|
| A11y1: `.fallback-badge` di `campaigns/[id].astro:403` pakai gold-subtle + gold, 2,38:1 | Benar isinya, nomor baris kurang tepat: kelas mulai `:401`, background `:402`, color `:403`. Pasangan gold-subtle + gold hanya di lokasi ini; dua `.fallback-badge` lain memakai warning dan LULUS: `email-campaigns/[id].astro:354-356` dan `preview/[id].astro:66-68,85` (4,53:1) | Persempit temuan ke satu lokasi; perbaiki sitasi ke `:401-403`; tambah catatan warning/gold-subtle 4,46:1 gagal |
| A11y1 rekomendasi: `--color-warning` `#9A6514` (4,53:1 di atas warning-subtle) sebagai alternatif | Benar di atas warning-subtle (4,53:1, `tokens.css:21-22`), tetapi di atas gold-subtle `tokens.css:13` hanya **4,46:1** (gagal) | Ganti rekomendasi utama ke `#8A5A10` (5,33:1); warning ditandai tidak aman di atas gold-subtle |
| A11y2: muted `#6C7E79` = 4,29:1 di putih, 3,81:1 di surface-subtle; contoh `EmailForm.astro:67`, `RewardItemList.astro:31` | Angka & contoh benar (`tokens.css:7`, `EmailForm.astro:67`, `RewardItemList.astro:31`, `RewardHero.astro:11`). Ditambah instance kanvas `#FFFCF5` = 4,18:1 yang belum tercatat: `privacy.astro:9`, `notfound.ts:42`, `LocaleSwitch.astro:12`, badge `tone-muted` `campaigns/index.astro:178`/`email-campaigns/index.astro:198`, `badge-inactive` `domains.astro:180` | Perluas daftar bukti; tambah angka muted/kanvas; kandidat `#566662` diverifikasi (5,90:1 di kanvas) |
| A11y3: info `#2D87B8` = 3,99:1 putih; `.tone-info` 3,52:1; contoh `EmailForm.astro:68` | Benar (`tokens.css:14-15`; `EmailForm.astro:68`; `laporan.astro:458`). Tambahan: info/kanvas 3,89:1. Kandidat `#24709A` = 5,44:1 putih, 4,81:1 info-subtle | Pertahankan, tambah angka kanvas & info-subtle kandidat |
| A11y4: danger/white 5,66; success/white 5,27; danger/danger-subtle 4,95; success/success-subtle 4,73; warning/warning-subtle 4,53; primary/white 6,38; teks 8–12:1 | Semua cocok (`tokens.css:5-22`). Verifikasi tambahan: primary/primary-subtle 5,55; ink/gold-subtle 11,07; ink/warning-subtle 11,25; warning/white 4,95; teks/kanvas 8,42 | Pertahankan, tambah pasangan yang diverifikasi |
| A11y5: tidak ada skip link; "halaman publik ... tanpa `<nav>`" | Skip link memang tidak ada (hanya `skipLocked` `mailworker.ts:18`, `skipped` `broadcast/worker.ts:39`). Tetapi ada `<nav aria-label="Pilih bahasa">` (`LocaleSwitch.astro:14`, dirender `en/r/[slug].astro:66`) dan `<header>` banner (`en/r/[slug].astro:61`) | Koreksi detail "tanpa nav"; temuan skip link tetap valid |
| A11y6: "nol kemunculan `:focus-visible` di `src/components/`, halaman publik, dan `PublicLayout`" | Salah. Ada aturan global `:focus-visible { outline:none; box-shadow: var(--focus-ring); }` (`tokens.css:72`, token `:59`), dan `PublicLayout.astro:7` + `AdminLayout.astro:6` mengimpor `tokens.css` | Cabut temuan; tandai LULUS dengan bukti |
| Verdict: "Verdict tahap 6" | Label tidak cocok dengan nomor file | Ganti menjadi "Verdict audit 06" |

## Addendum (2026-09-21): Verifikasi Aksesibilitas Segmented Control Track
- Implementasi Segmented Control Track pada `src/components/ReflectionTabs.astro` diverifikasi tetap memenuhi 100% persyaratan aksesibilitas WAI-ARIA APG:
  - **Role semantik**: `role="tablist"`, `role="tab"`, `role="tabpanel"`.
  - **State dinamis**: `aria-selected="true|false"`, `tabindex="0|-1"`, `aria-controls`, `aria-labelledby`.
  - **Navigasi keyboard**: ArrowLeft & ArrowRight dengan circular wrapping serta roving tabindex otomatis.
  - **Focus indicator**: Didukung penuh oleh `:focus-visible { outline: none; box-shadow: var(--focus-ring); }` sesuai token global.
  - **Target sentuh**: Memenuhi standar touch target minimum 44px (`min-height: 44px`) dengan lebar proporsional (`flex: 1`).

