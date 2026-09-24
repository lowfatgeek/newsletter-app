# Plan 6 — Redesign Halaman Reward: "The Progressive Modal Desk"

> **Status:** COMPLETED  
> **Tanggal Penyusunan:** 23 September 2026  
> **Metodologi:** Progressive Disclosure / Micro-Commitment Desk  
> **Target File:** `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`, `src/components/RewardClaimModal.astro`, `src/components/EmailForm.astro`.

---

## 1. Ringkasan Eksekutif & Keputusan Desain

User telah memilih arsitektur **"The Progressive Modal Desk"** untuk meredesain halaman reward publik (`/r/[slug]` dan `/en/r/[slug]`).

Arsitektur ini memisahkan pengalaman pengguna menjadi 2 tahap:
1. **Layar Utama (The Showcase — 1 Kolom Terfokus, `max-width: 740px`):**
   - Menghilangkan *split-column cognitive overload*.
   - Fokus murni pada nilai dan manfaat hadiah digital (Overline, Judul, Deskripsi, Cover image resolusi tinggi, dan Daftar Inventaris Paket Kado).
   - Diakhiri dengan Action Block terpadu: Tombol **"Download Kado"** (ID) / **"Download Gift"** (EN) didampingi subteks *"Cukup bayar dengan doa dan link akan dikirim via email"*.
2. **Layer Kedua (The Ritual Desk — On-Page Modal & Bottom Sheet):**
   - Muncul saat tombol "Download Kado" diklik.
   - Menggunakan model Center Modal pada Desktop dan Bottom Sheet modern pada Mobile.
   - **Timer 30 detik dimulai tepat saat modal dibuka** (bukan sejak halaman utama diakses).
   - Memuat tab Doa Muslim / Harapan Baik, panel status countdown, input email, checkbox consent, dan tombol submit `KIRIM LINK DOWNLOAD`.

---

## 2. Guardrails & Batasan Absolut

1. **Copywriting Tetap Utuh:**
   - Semua teks UI, doa, heading, label form, consent, dan tombol submit wajib dipertahankan persis tanpa modifikasi.
2. **Design Tokens & Filosofi `.agents/DESIGN.md`:**
   - Ivory Paper (`#fffcf5`), Linen Surface (`#f7f1e6`), White Surface (`#ffffff`), Ink Forest (`#153b35`), Forest Action (`#176b5b`), Gift Gold (`#d99020`), Paper Border (`#e7ded0`).
3. **Logika Bisnis & Keamanan Tetap 100%:**
   - Validasi `timer_token` anti-bot 30 detik di server, honeypot `website`, rate limit, email allowlist, dan route `/api/subscribe` tidak berubah.
4. **Bilingual Parity:**
   - Rute ID (`/r/[slug]`) dan EN (`/en/r/[slug]`) simetris sempurna.

---

## 3. Status Implementasi & Verifikasi (September 2026)

Rencana kerja ini telah **selesai 100% diimplementasikan dan diverifikasi**:
- Komponen `src/components/RewardClaimModal.astro` telah dibangun dan diintegrasikan ke halaman ID (`src/pages/r/[slug].astro`) dan EN (`src/pages/en/r/[slug].astro`).
- Logika timer 30 detik on-open, focus trap, drawer mobile, modal desktop, dan validasi server-side telah lolos build, unit test, dan verifikasi CI.
- Status: **COMPLETED**.
