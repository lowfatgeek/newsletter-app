# Plan 5 — Redesign Halaman Reward: "The Split Gift Desk"

> **Status:** COMPLETED  
> **Tanggal Penyusunan:** 21 September 2026  
> **Metodologi:** Hallmark Anti-AI-Slop (`references/macrostructures/15-split-studio.md`)  
> **Target Target File:** `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`, dan komponen landing terkait.

---

## 1. Ringkasan Eksekutif & Keputusan Desain

User telah memilih **Konsep No. 2: "The Split Gift Desk" (Macrostructure: Split Studio / Workbench Asymmetric)** untuk meredesain halaman reward publik (`/r/[slug]` dan `/en/r/[slug]`).

Tujuan redesign ini adalah mengeliminasi masalah *"Card Stacking Fatigue"* (kebosanan tumpukan 4-5 kartu kotak putih yang kaku) dan menggantikannya dengan tata letak asimetris premium di mana **hadiah yang ingin didapatkan selalu berada dalam pandangan visual pengguna (*the visual proof*) saat mereka membaca doa dan menyelesaikan ritual unlock 30 detik**.

---

## 2. Guardrails & Batasan Absolut (KONSISTENSI PENUH)

Coding Agent yang mengeksekusi rencana ini **DILARANG** melanggar guardrail berikut:

1. **Copywriting Tetap Utuh:**
   - Semua teks UI, label, heading ("Baca dulu buat unlock", "BAYAR DENGAN DOA", "Unlock setelah 30 detik. Baca doa dulu.", "KIRIM LINK DOWNLOAD", dsb.) **wajib dipertahankan persis tanpa perubahan kata**.
2. **Design System & Tokens Tetap:**
   - Tetap menggunakan CSS custom properties dari [`.agents/DESIGN.md`](../../.agents/DESIGN.md) dan `src/styles/tokens.css` (Ivory Paper `#FFFCF5`, Linen Surface `#F7F1E6`, White Surface `#FFFFFF`, Ink Forest `#153B35`, Forest Action `#176B5B`, Gift Gold `#D99020`, Paper Border `#E7DED0`).
   - Dilarang menambahkan warna hex hardcoded di komponen Astro.
3. **Logika Bisnis & Keamanan Tetap 100%:**
   - Validasi waktu 30 detik via server token (`timer_token`), honeypot `website`, double-submit lock, format domain email allowlist dinamis, dan route `/api/subscribe` tidak boleh dirusak.
4. **Bilingual Parity:**
   - Implementasi harus diterapkan identik pada versi Bahasa Indonesia (`src/pages/r/[slug].astro`) dan versi Bahasa Inggris (`src/pages/en/r/[slug].astro`).

---

## 3. Spesifikasi Arsitektur Visual: "The Split Gift Desk"

### A. Layout Desktop (Viewport $\ge$ 1024px)
- **Container / Page Shell:** `max-width: 1140px; margin: 0 auto; padding: var(--space-8) var(--space-6);`
- **Grid Pembagi (2 Kolom Asimetris):**
  ```css
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: var(--space-10);
  align-items: start;
  ```
- **Kolom Kiri — The Showcase (Bukti Visual Hadiah):**
  - Overline: `KADO DARI KELASWFA` (huruf kapital, tracking 0.075em, warna `--color-text-muted`).
  - H1 Judul Reward: Tipe Display/H1 tegas warna `Ink Forest` (`#153B35`).
  - Paragraf Deskripsi: `body-lg` mengalir dengan line-height 1.6.
  - Featured Image: Frame visual utama dengan `border-radius: var(--radius-image)` (16px), border Paper Border tipis, dan elevasi bayangan halus.
  - Daftar Item Hadiah (`RewardItemList`): Diletakkan di bawah gambar sebagai *manifest / inventaris paket digital*. Tidak lagi berupa kartu-kartu terpisah, melainkan daftar kurasi berikon outline `gift` emas di atas pembatas garis tipis yang rapi.
- **Kolom Kanan — The Unlock Ritual (Sticky Focus):**
  - Posisi: `position: sticky; top: var(--space-8);`
  - Kontainer: Satu kartu White Surface terpadu (`border-radius: var(--radius-card)`, `border: var(--border-default)`, `box-shadow: var(--shadow-card)`, `padding: var(--space-8)`).
  - Di dalam kartu:
    1. **Tab & Teks Doa:** Heading "Baca dulu buat unlock" + Editorial Underline Tabs ("Doa Muslim" & "Harapan Baik") + Teks Doa khidmat (line-height 1.7).
    2. **Divider Halus:** Pembatas horizontal tipis `1px solid var(--color-border)`.
    3. **Panel Timer & Form Klaim:** Status countdown Gold Tint tabular numerals + progress bar tipis + Input Email dengan placeholder domain dinamis + consent copy + Tombol CTA "KIRIM LINK DOWNLOAD" yang terkunci selama 30 detik lalu aktif.

### B. Layout Mobile & Tablet (Viewport < 1024px)
- Grid runtuh secara otomatis menjadi 1 kolom yang linear dan fokus (`max-width: 640px; margin: 0 auto;`):
  1. Header & Hero (Overline → H1 → Deskripsi → Cover Image).
  2. Daftar Item Hadiah (Item list ringkas).
  3. Kartu Ritual (Doa + Timer + Form Klaim).

---

## 4. Komponen yang Terlibat & Rencana Modifikasi

| File Target | Peran & Perubahan yang Direncanakan |
|---|---|
| `src/pages/r/[slug].astro` | Mengubah `<main>` dari single column 680px menjadi grid 2-kolom desktop (Split Showcase & Ritual) yang responsif 1-kolom di mobile. |
| `src/pages/en/r/[slug].astro` | Menyelaraskan layout grid yang sama persis untuk halaman rute bahasa Inggris. |
| `src/components/RewardHero.astro` | Menyesuaikan hierarchy spasi dan tipografi agar pas di kolom showcase kiri. |
| `src/components/RewardItemList.astro` | Menata ulang item list dari kartu bertingkat terisolasi menjadi daftar inventaris paket yang menyatu anggun di bawah preview cover. |
| `src/components/ReflectionTabs.astro` | Menyesuaikan container agar pas menjadi bagian atas dari kartu ritual terpadu. |
| `src/components/EmailForm.astro` | Menyesuaikan styling container agar mengalir mulus di bawah panel doa tanpa nesting card ganda. |

---

## 5. Checklist Verifikasi Setelah Eksekusi

- [ ] Halaman reward render sempurna pada viewport 320px, 375px, 768px, 1024px, dan 1440px.
- [ ] Kolom kanan di desktop memiliki perilaku sticky yang halus saat pengguna membaca dan menunggu timer.
- [ ] Timer 30 detik tetap berjalan presisi dan membuka kunci tombol submit setelah selesai.
- [ ] Input email, placeholder domain, consent checkbox, dan penanganan error tetap berfungsi normal.
- [ ] Versi EN (`/en/r/[slug]`) dan ID (`/r/[slug]`) bekerja simetris.
- [ ] `npx astro check`, `npm run lint`, dan `npm run build` berhasil 100% dengan 0 error.
