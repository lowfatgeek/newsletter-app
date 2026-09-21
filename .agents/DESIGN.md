# Design System — KelasWFA Kado

> warm, credible, quietly celebratory — a digital gift desk for people building freedom through work

**Produk:** KelasWFA Newsletter & Reward Campaigns  
**Permukaan publik:** `kado.kelaswfa.my.id`  
**Mode:** light-first; dark mode tidak termasuk MVP

## 1. Visual Theme & Atmosphere

KelasWFA Kado harus terasa seperti membuka paket digital dari mentor yang tulus: **hangat, tenang, optimistis, dan kompeten**. Landing page memberi rasa dihargai sebelum meminta email; dashboard memberi rasa kontrol saat admin mengelola contact dan broadcast.

Sistem ini mengambil pelajaran dari Family.co berupa kanvas hangat, pemisahan permukaan yang halus, dan ritme whitespace yang lapang. Namun sistem ini tidak menyalin maskot, ilustrasi, palet, tipografi display, atau komponen Family. Bahasa visualnya sendiri adalah **warm editorial utility**: hadiah digital yang rapi, aman, dan manusiawi untuk audiens KelasWFA.

### Prinsip

1. **Hadiah lebih dulu, form kemudian.** Reward dan manfaatnya terbaca sebelum permintaan email.
2. **Ritual yang tenang.** Timer doa/harapan baik terasa sebagai jeda reflektif, bukan loading atau hukuman.
3. **Kepercayaan tanpa kekakuan.** Jelaskan format file, masa berlaku link, dan langkah berikutnya secara konkret.
4. **Satu aksi utama per state.** Hanya satu CTA terisi yang dominan pada layar atau card.
5. **Ornamen memiliki alasan.** Aksen mengingatkan pada hadiah, perjalanan kerja, atau apresiasi; tidak ada dekorasi acak.
6. **Admin adalah alat kerja.** Dashboard lebih padat dan lebih netral daripada landing page; data serta aksi kirim selalu lebih penting daripada estetika.

## 2. Color Palette & Roles

| Nama | Hex | Token | Peran |
|---|---:|---|---|
| Ivory Paper | `#FFFCF5` | `--color-canvas` | Background publik yang hangat dan terang |
| Linen Surface | `#F7F1E6` | `--color-surface-subtle` | Panel sekunder, area upload, empty state |
| White Surface | `#FFFFFF` | `--color-surface-raised` | Card reward, form, modal, tabel admin |
| Ink Forest | `#153B35` | `--color-ink` | Heading, navigasi, teks kontras tinggi |
| Body Moss | `#36514B` | `--color-text` | Body copy, label, deskripsi |
| Quiet Moss | `#6C7E79` | `--color-text-muted` | Helper text, metadata, placeholder |
| Paper Border | `#E7DED0` | `--color-border` | Divider, stroke card dan input |
| Forest Action | `#176B5B` | `--color-primary` | CTA primer, tab aktif, progress aktif |
| Forest Hover | `#105447` | `--color-primary-hover` | Hover/pressed CTA primer |
| Forest Tint | `#E5F2EE` | `--color-primary-subtle` | Selected state, success soft, row hover |
| Gift Gold | `#D99020` | `--color-gold` | Aksen hadiah dan timer, bukan CTA primer |
| Gold Tint | `#FFF2D6` | `--color-gold-subtle` | Reward highlight dan countdown panel |
| Open Sky | `#2D87B8` | `--color-info` | Link non-primer dan informasi delivery |
| Sky Tint | `#E6F3FA` | `--color-info-subtle` | Callout info dan pending state |
| Terracotta | `#B95943` | `--color-accent` | Penekanan editorial kecil dan aksen ilustrasi |
| Rose Error | `#B53C4A` | `--color-danger` | Error dan aksi destructive |
| Rose Tint | `#FCECEE` | `--color-danger-subtle` | Background error/destructive |
| Success Green | `#237A55` | `--color-success` | Confirmed, delivered, published |
| Success Tint | `#E8F6EE` | `--color-success-subtle` | Background sukses |
| Warning Amber | `#9A6514` | `--color-warning` | Pending, paused, expired |
| Warning Tint | `#FFF4DC` | `--color-warning-subtle` | Background warning |

### Aturan warna

- Forest Action adalah satu-satunya fill CTA primer. Jangan menggantinya dengan emas, biru, atau merah.
- Gift Gold adalah tanda hadiah dan progres. Gunakan sebagai accent kecil, ikon, badge, atau panel timer.
- Status harus selalu memiliki teks/ikon; warna bukan satu-satunya pembeda.
- Jangan gunakan gradient, glassmorphism, atau warna neon pada MVP.
- Ink Forest di Ivory/White dan putih di Forest Action harus memenuhi kontras minimal WCAG AA. Quiet Moss tidak boleh digunakan untuk informasi kritis atau teks kecil.

## 3. Typography Rules

Gunakan satu keluarga font untuk meminimalkan payload dan menjaga konsistensi pada browser in-app YouTube.

**Font utama:** `Plus Jakarta Sans`, fallback `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.

| Peran | Weight | Penggunaan |
|---|---:|---|
| Display / hero | 700 | Judul hero, maksimal 2–3 baris pada mobile |
| Page / section heading | 700 | Hierarki utama tanpa gaya dekoratif |
| Card title / control label | 600 | Reward title, tab, button, nav |
| Body / doa / email content | 400 | Copy panjang yang mudah dibaca |
| Overline / metadata | 600 | Ukuran kecil dengan letter-spacing positif tipis |

| Role | Desktop | Mobile | Line-height | Tracking |
|---|---:|---:|---:|---:|
| display | 56px | 40px | 1.08 | -0.04em |
| h1 | 40px | 32px | 1.12 | -0.032em |
| h2 | 30px | 26px | 1.18 | -0.024em |
| h3 | 22px | 20px | 1.28 | -0.016em |
| body-lg | 18px | 17px | 1.58 | -0.012em |
| body | 16px | 16px | 1.58 | -0.008em |
| body-sm | 14px | 14px | 1.5 | -0.004em |
| label | 13px | 13px | 1.35 | 0 |
| overline | 12px | 12px | 1.35 | 0.075em |

Teks doa atau Harapan Baik memakai `body-lg`, line-height 1.7, rata kiri, dan lebar maksimal 58 karakter. Timer memakai `font-variant-numeric: tabular-nums` agar angka tidak melompat saat berubah.

## 4. Layout, Spacing & Shapes

### Spacing scale

Base unit adalah 4px. Gunakan token, bukan nilai arbitrer.

| Token | Nilai | Pemakaian |
|---|---:|---|
| `--space-1` | 4px | Gap icon-teks |
| `--space-2` | 8px | Badge dan helper internal |
| `--space-3` | 12px | Gap field/list padat |
| `--space-4` | 16px | Padding card kecil |
| `--space-5` | 20px | Kelompok konten |
| `--space-6` | 24px | Padding card mobile |
| `--space-8` | 32px | Padding desktop / blok besar |
| `--space-10` | 40px | Jeda grup penting |
| `--space-12` | 48px | Section gap mobile |
| `--space-16` | 64px | Section gap desktop |
| `--space-20` | 80px | Hero breathing room |
| `--space-24` | 96px | Hero desktop saja |

### Lebar layout

| Area | Aturan |
|---|---|
| Public page shell | `max-width: 1200px`, padding 20px mobile / 40px desktop |
| Funnel content | `max-width: 680px`; satu kolom agar claim tetap fokus |
| Download page | `max-width: 760px` |
| Admin auth | `max-width: 440px` |
| Admin dashboard | `max-width: 1440px`; sidebar 240px desktop |

### Bentuk dan kedalaman

| Elemen | Radius | Aturan |
|---|---:|---|
| Input, button, tab | 12px | Ramah disentuh, bukan bubble UI |
| Featured image | 16px | Fokus konten reward |
| Reward/form card | 20px | Blok utama publik |
| Modal/drawer | 24px | Layer operasional baru |
| Status badge | 999px | Metadata ringkas |

Gunakan border `1px solid #E7DED0` sebagai pemisah utama. Shadow hanya memberi hierarchy kecil:

```css
--shadow-card: 0 1px 2px rgba(21, 59, 53, 0.04), 0 8px 24px rgba(21, 59, 53, 0.05);
--shadow-float: 0 16px 40px rgba(21, 59, 53, 0.12);
--focus-ring: 0 0 0 3px rgba(23, 107, 91, 0.24);
```

## 5. Component Stylings — Public Funnel

### App header

- Tinggi 64px mobile / 72px desktop.
- Logo KelasWFA di kiri, switch bahasa di kanan.
- Tidak ada menu rumit atau CTA kedua pada halaman funnel.
- Background transparan di atas Ivory Paper; border bawah tipis muncul saat scroll.

### Reward hero dan asset preview

- Overline kecil: `KADO DARI KELASWFA` atau padanan EN.
- H1 menjelaskan reward secara konkret, bukan slogan umum.
- Featured image adalah visual utama: screenshot template, cover e-book, preview checklist, atau mockup produktif.
- Aksen dekoratif terbatas pada 2–3 bentuk geometris kecil seperti pita, rute perjalanan, atau bintang empat-sudut dalam Gold Tint/Sky Tint/Forest Tint.
- Jangan gunakan maskot, koin, crypto visual, confetti penuh layar, atau stock photo generik orang bekerja di laptop.

### Reward item list

- Satu kolom dengan ikon `gift`, `file`, atau `check` outline sederhana.
- Tampilkan nama reward, manfaat singkat, serta metadata format/ukuran bila tersedia.
- White Surface, border Paper Border, radius 20px. Jangan memakai grid 3 kolom pada funnel mobile.
- Ikon memakai Gift Gold di atas Gold Tint atau Forest Action di atas Forest Tint.

### Reflection panel — Doa / Harapan Baik

- White atau Linen Surface, radius 20px, border halus, padding 24px mobile / 32px desktop.
- Heading: “Luangkan sejenak untuk doa atau harapan baik.”
- Tab setara: `Doa Muslim` dan `Harapan Baik`; lebar seimbang dan keyboard-accessible.
- **Track Tablist:** Segmented control track berlatar Linen Surface (`--color-surface-subtle`), border Paper Border halus (`1px solid rgba(231, 222, 208, 0.8)`), padding 4px (`--space-1`), radius 12px (`--radius-control`), dan lebar maksimal proporsional `440px` (responsif 100% di mobile).
- **Tab aktif:** White Surface (`--color-surface-raised` / `#FFFFFF`), teks Forest Action (`--color-primary` / `#176B5B`), border-radius 8px, elevated tactile shadow (`0 2px 6px rgba(21, 59, 53, 0.08), 0 1px 2px rgba(21, 59, 53, 0.04)`).
- **Tab nonaktif:** transparan di dalam track Linen Surface dengan warna Body Moss (`--color-text`), hover ke Ink Forest (`--color-ink`).
- Isi tab adalah teks utama, bukan caption. Jangan gunakan simbol agama sebagai dekorasi besar; bentuk abstrak netral diperbolehkan.
*(Catatan: Menggunakan pola Segmented Control Track dengan elevated white pill demi kejelasan affordance interaktif di layar sentuh/mobile dan desktop, mengeliminasi tabrakan temperatur warna pastel, dan menciptakan kedalaman taktil).*

### Timer panel

- Panel Gold Tint dengan angka Ink Forest dan tabular numerals.
- Pesan awal: “Tombol akan terbuka setelah 30 detik.”
- Pesan selesai: “Terima kasih sudah meluangkan waktu. Sekarang, masukkan emailmu.”
- Progress bar tipis memakai Forest Action di atas Paper Border. Tidak ada pulse/animasi alarm.
- Pembaca layar diumumkan pada awal, 10 detik tersisa, dan selesai—bukan setiap detik.

### Email form

- Label selalu terlihat: `Email untuk menerima hadiah`.
- Input minimum 48px tinggi, radius 12px, White Surface, Paper Border.
- Focus memakai Forest Action border + focus ring. Placeholder bukan label.
- Copy consent di bawah field, `body-sm`, dengan privacy policy yang bergaris bawah.
- CTA full width mobile: `Kirim tautan hadiah` / `Send my gift link`.
- Saat timer belum selesai, CTA masih terlihat tetapi disabled: Linen Surface, Quiet Moss text, dan penjelasan status yang jelas.
- Error dekat dengan field, menggunakan Rose Tint + ikon + teks spesifik. Jangan hanya memerahkah border.
- MVP tidak meminta nama, nomor telepon, atau data lain.

### Status pages

**Cek email:** gunakan envelope abstrak kecil; jelaskan cek inbox, buka email KelasWFA, lalu klik akses. Email boleh ditampilkan tersamarkan, misalnya `di**@gmail.com`. Resend adalah ghost button dengan cooldown jelas.

**Download reward:** heading “Kadonya siap dibuka.” Setiap asset tampil sebagai card dengan ikon file, jenis, ukuran, dan CTA `Unduh aman`. Selalu tampilkan “Link unduhan berlaku 1 jam.”

**Expired/paused:** jelaskan situasi dan tindakan berikutnya. Warning Tint untuk expiry; Rose Tint hanya untuk error yang tak dapat dipulihkan visitor.

### Button hierarchy

| Variasi | Tampilan | Penggunaan |
|---|---|---|
| Primary | Forest Action, teks putih, radius 12px | Submit, unduh, publish, kirim campaign |
| Destructive | Rose Error, teks putih | Hapus asset/campaign setelah konfirmasi |
| Secondary | White, Paper Border, Ink Forest | Preview, cancel, kembali |
| Ghost | Transparan, Forest Action, underline/icon | Language switch, resend, detail sekunder |
| Disabled | Linen, Quiet Moss, tanpa shadow | Timer atau validasi belum selesai |

Minimum touch target 44px; button form dan CTA utama 48px. Hover menggelapkan fill 6–10%, pressed maksimal `translateY(1px)`, dan focus ring tidak boleh dihapus.

## 6. Component Stylings — Admin

Dashboard menggunakan token yang sama dengan landing page, tetapi tidak memakai ilustrasi besar atau aksen hadiah berlebihan.

### Navigation dan page header

- Sidebar desktop Ink Forest dengan teks Ivory; active state memakai Forest Action/Forest Tint yang tetap berkontras.
- Mobile memakai topbar dan navigation drawer.
- Header halaman berisi H1 ringkas, helper text, dan satu primary action di kanan.
- Contoh primary action: `Buat reward campaign`, `Buat email campaign`, `Kirim campaign`.

### Form builder dan editor

- Group field dalam section card: Detail, Konten ID, Content EN, Reward files, Doa, SEO, dan Publish.
- Required field memakai label teks `Wajib`, bukan asterisk tanpa konteks.
- Field bilingual memperlihatkan kelengkapan dan fallback ID ketika EN kosong.
- Rich-text editor toolbar ringkas; jangan beri pilihan font/color bebas yang merusak email brand.
- Autosave memakai status kecil seperti `Tersimpan 14.32`, bukan toast berulang.

### Upload asset

- Dropzone Linen Surface dengan dashed Paper Border dan ikon upload Forest Action.
- Tampilkan jenis file dan batas 100 MB sebelum upload.
- Progress memakai bar horizontal + persentase; bukan spinner tanpa progres.
- File selesai menampilkan nama, tipe, ukuran, urutan, dan action menu.

### Tabel contact dan status

- Header tabel Linen Surface dengan label overline kecil.
- Row minimum 56px, divider Paper Border, hover Forest Tint sangat ringan.
- Email cukup jelas bagi operasi admin; jangan truncate tanpa tooltip.
- Badge wajib memiliki ikon + teks: `Confirmed`, `Unsubscribed`, `Bounced`, `Pending`, `Delivered`.
- Filter aktif berupa chip yang dapat dihapus.

### Composer email campaign dan send review

- Urutkan form: segment, audience estimate, bahasa, subject, preheader, body, jadwal, lalu rate limit.
- Panel “Audience snapshot” harus jelas: jumlah penerima dibekukan saat schedule atau send.
- Limit per minute/hour memakai input angka dan helper tentang kapasitas provider.
- Tombol kirim membuka review modal, bukan langsung mengirim.
- Review menampilkan nama campaign, recipient snapshot, segment, bahasa, schedule, limit, serta subject preview.
- CTA eksplisit: `Kirim ke 1.240 subscriber` atau `Jadwalkan campaign`.
- Pause memakai Warning Amber; cancel memakai dialog destructive dengan konfirmasi kedua.

### Delivery dan analytics

- KPI: Sent, Delivered, Failed, Bounced, Unsubscribed, Clicks. Jangan buat kartu Open Rate.
- Gunakan angka tabular. Perubahan angka harus memiliki label periode, bukan warna hijau/merah saja.
- Progress broadcast: `Mengirim 240 dari 1.000`, kecepatan aktif, estimasi sederhana, dan waktu update terakhir.
- Awali dengan KPI dan tabel; chart hanya dipakai bila membantu melihat tren yang nyata.

## 7. Imagery, Icons & Motion

### Imagery dan iconografi

- Featured image reward harus relevan dengan isi: preview template, cover e-book, screenshot spreadsheet, checklist, atau mockup produktif.
- Placeholder asset memakai pita hadiah geometris, grid kerja, atau garis rute perjalanan dalam tint sistem.
- Icon outline 1.75–2px dengan sudut rounded: `gift`, `mail`, `file`, `download`, `clock`, `shield-check`, `globe`, `send`, `pause`, `chart`, `users`.
- Icon tidak menggantikan label untuk aksi berisiko.

### Motion

- 160ms control, 220ms tab/panel, 280ms modal.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Motion hanya menjelaskan state: tab berubah, progress upload, modal, dan download ready.
- Tidak ada parallax, marquee, ilustrasi berulang, atau timer berdenyut.
- Hormati `prefers-reduced-motion: reduce` dengan menghapus transform dan transition non-esensial.

## 8. Responsive & Accessibility

| Lebar | Perilaku |
|---|---|
| < 640px | Funnel satu kolom; CTA full width; padding 20px; table admin scroll horizontal |
| 640–1023px | Landing tetap fokus satu kolom; dashboard sidebar menjadi drawer; grid maksimal dua kolom |
| >= 1024px | Hero dapat dua kolom tetapi area claim <= 680px; sidebar admin permanen |

Wajib diimplementasikan:

- Semua control, tab, filter, upload, modal, dan form dapat dioperasikan keyboard.
- Focus ring selalu terlihat.
- Error form terkait via `aria-describedby`; fokus berpindah ke error pertama.
- Toast bukan satu-satunya penyampai hasil tindakan.
- Status memakai label + ikon + warna.
- Semua text ID/EN memakai atribut `lang` yang benar.
- Uji pada 320px, 390px, 768px, 1024px, dan 1440px.

## 9. Do & Don't

### Do

- Gunakan Ivory Paper untuk halaman publik dan White Surface untuk blok aksi penting.
- Buat hadiah terasa nyata melalui preview, format, ukuran, dan benefit singkat.
- Gunakan satu CTA Forest Action per state.
- Gunakan Gold Tint untuk timer, badge reward, dan aksen kecil.
- Beri ruang baca yang cukup pada doa/harapan baik dan consent copy.
- Gunakan border dan shadow halus untuk hierarchy.
- Tulis copy langsung: “Cek emailmu”, “Kadonya siap dibuka”, “Link unduhan berlaku 1 jam.”

### Don't

- Jangan menyalin maskot, ilustrasi, typeface display, shape language, atau palet Family.co.
- Jangan memakai emoji sebagai ikon UI atau dekorasi besar.
- Jangan membuat dua CTA terisi dalam satu card/form state.
- Jangan menyamarkan timer, newsletter consent, privacy notice, atau masa berlaku link.
- Jangan memakai Gold/Warning sebagai primary CTA atau Rose sebagai accent biasa.
- Jangan mengubah dashboard menjadi landing page promosi yang penuh ornamen.

## 10. Agent Prompt Guide

**Quick reference:**

- Canvas `#FFFCF5`; primary action `#176B5B`; heading `#153B35`; body `#36514B`; border `#E7DED0`.
- Accent hadiah `#D99020` pada `#FFF2D6`.
- Plus Jakarta Sans di seluruh UI.
- Card putih, border tipis, radius 20px, shadow lembut.
- Mood: warm editorial utility, kredibel, manusiawi, dan tidak ramai.

**Contoh prompt:**

1. Buat reward landing hero KelasWFA Kado pada Ivory Paper `#FFFCF5`, dengan konten claim maksimal 680px. Tampilkan preview reward, tiga benefit konkret, heading Plus Jakarta Sans 700, dan satu CTA Forest Action `#176B5B`. Tambahkan maksimal dua aksen geometris kecil. Hindari mascot, crypto visual, gradient, dan confetti.

2. Buat panel Doa Muslim dan Harapan Baik dengan White Surface, radius 20px, border `#E7DED0`, padding 24px. Tablist menggunakan Segmented Control Track Linen Surface (`#F7F1E6`, max-width 440px) dengan padding 4px dan radius 12px; tab aktif berupa elevated pill White (`#FFFFFF`) dengan teks Forest Action (`#176B5B`) dan shadow halus. Teks doa memakai 18px/1.7. Tambahkan countdown Gold Tint dan CTA email disabled yang jelas sebelum 30 detik selesai.

3. Buat form claim mobile-first dengan label email permanen, input 48px, focus ring hijau, copy newsletter + privacy policy, dan satu button full-width “Kirim tautan hadiah”. Error memakai Rose Tint dengan teks spesifik.

4. Buat dashboard email campaign yang netral: sidebar Ink Forest, canvas Ivory, card putih, recipient snapshot, limit per menit/jam, KPI sent/delivered/failed/bounced/unsubscribed/clicks, dan progress broadcast. Hindari open-rate card dan chart dekoratif.

## 11. CSS Custom Properties

```css
:root {
  --color-canvas: #FFFCF5;
  --color-surface-subtle: #F7F1E6;
  --color-surface-raised: #FFFFFF;
  --color-ink: #153B35;
  --color-text: #36514B;
  --color-text-muted: #6C7E79;
  --color-border: #E7DED0;
  --color-primary: #176B5B;
  --color-primary-hover: #105447;
  --color-primary-subtle: #E5F2EE;
  --color-gold: #D99020;
  --color-gold-subtle: #FFF2D6;
  --color-info: #2D87B8;
  --color-info-subtle: #E6F3FA;
  --color-accent: #B95943;
  --color-danger: #B53C4A;
  --color-danger-subtle: #FCECEE;
  --color-success: #237A55;
  --color-success-subtle: #E8F6EE;
  --color-warning: #9A6514;
  --color-warning-subtle: #FFF4DC;

  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-weight-regular: 400;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --text-display: clamp(2.5rem, 5vw, 3.5rem);
  --text-h1: clamp(2rem, 4vw, 2.5rem);
  --text-h2: clamp(1.625rem, 3vw, 1.875rem);
  --text-h3: 1.375rem;
  --text-body-lg: 1.125rem;
  --text-body: 1rem;
  --text-body-sm: 0.875rem;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;

  --radius-control: 12px;
  --radius-image: 16px;
  --radius-card: 20px;
  --radius-modal: 24px;
  --radius-pill: 999px;
  --border-default: 1px solid var(--color-border);
  --shadow-card: 0 1px 2px rgba(21, 59, 53, 0.04),
    0 8px 24px rgba(21, 59, 53, 0.05);
  --shadow-float: 0 16px 40px rgba(21, 59, 53, 0.12);
  --focus-ring: 0 0 0 3px rgba(23, 107, 91, 0.24);

  --page-shell: 1200px;
  --funnel-content: 680px;
  --download-content: 760px;
  --auth-content: 440px;
  --admin-content: 1440px;
}
```

## 12. Implementation Checklist

- [ ] Muat Plus Jakarta Sans dengan subset Latin dan `font-display: swap`.
- [ ] Terapkan token semantik; jangan hardcode warna baru di komponen.
- [ ] Buat public shell dan admin shell terpisah yang berbagi token, type, dan status component.
- [ ] Uji state default, hover, focus, disabled, loading, success, dan error untuk setiap CTA.
- [ ] Uji keyboard navigation, timer screen reader, tab, form error, modal send-review, dan table overflow.
- [ ] Uji `prefers-reduced-motion` pada timer, tab, dialog, dan upload progress.
- [ ] Verifikasi seluruh status email/download memiliki label eksplisit, bukan warna saja.

## 13. Addendum & Keputusan Desain Lanjutan

### Addendum 2026-09: Affordance Tab Refleksi (Segmented Control Track)
- **Konteks & Masalah UX:** Pada spesifikasi awal (§5), tab nonaktif didefinisikan berlatar transparan di atas card putih (`--color-surface-raised`). Hal ini menyebabkan tab nonaktif kehilangan kontur fisik (*low click affordance*) dan rawan disalahartikan pengguna sebagai teks statis atau sub-heading, terutama pada perangkat mobile/layar sentuh yang tidak memiliki kursor/hover alami.
- **Penyempurnaan Visual (Elevated White Pill on Linen Track):** 
  - Wadah `role="tablist"` dibungkus dalam *track* bergaya *Segmented Control* dengan latar Linen Surface (`--color-surface-subtle` / `#F7F1E6`), border Paper Border halus (`1px solid rgba(231, 222, 208, 0.8)`), padding 4px (`--space-1`), radius 12px (`--radius-control`), dan lebar maksimal proporsional `440px` (responsif 100% di mobile).
  - **Tab aktif** berupa *pill* berlatar White Surface (`--color-surface-raised` / `#FFFFFF`) dengan teks Forest Action (`--color-primary` / `#176B5B`), border-radius 8px, dan elevated tactile shadow (`0 2px 6px rgba(21, 59, 53, 0.08), 0 1px 2px rgba(21, 59, 53, 0.04)`).
  - **Tab nonaktif** berlatar transparan di dalam track Linen Surface dengan teks Body Moss (`--color-text`), beralih ke Ink Forest (`--color-ink`) saat hover.
- **Rasional & Hasil:** Menghilangkan tabrakan temperatur warna (mint dingin vs krem hangat), menciptakan ilusi kedalaman fisik (*tactile elevation*) di mana tab aktif timbul alami di atas track yang cekung, serta menyeimbangkan proporsi panjang teks agar tidak kopong. Tetap 100% mematuhi spesifikasi aksesibilitas WAI-ARIA APG dan touch target 44px.


