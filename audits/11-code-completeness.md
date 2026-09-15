# Audit 11 — Code Completeness

Tanggal: 2026-09-14
Lingkup: placeholder, dummy data, TODO, mock, fitur setengah jadi, route stub API, mirror EN, seed. Metode: read-only (grep sweep + baca file). Tidak ada perubahan kode.

## Ringkasan

Kode **hampir sepenuhnya selesai**. Sweep mengonfirmasi nol `TODO/FIXME/XXX/HACK/PLACEHOLDER` di `src/`, `scripts/`, `test/`, `docs/`; nol `console.*` di `src/`; nol lorem/ipsum/asdf/qwerty/coming-soon di permukaan render; nol blok kode terkomentari; dan semua route API (`api/` + `admin/api/`) punya logika nyata — tidak ada handler stub. Semua mock (Emailit, R2, broadcast) default `false` di kode dan diperingatkan eksplisit di panduan deploy. Dua pola "dummy" (`DUMMY_PASSWORD_HASH`, `admin@example.com` di preview) adalah pola yang disengaja dan terdokumentasi — bukan sisa pekerjaan.

Satu temuan lama divalidasi tetapi **dikoreksi**: halaman root `/` (`src/pages/index.astro`) masih stub scaffold 9 baris (C1) — tidak berubah sejak commit scaffold `5af00b4`, tanpa mirror `/en/`, tanpa sitemap, tetap indexable. Namun klaim lama "root orphan / nol `href=\"/\"`" **salah**: ada 10 kemunculan `href="/"` di `src/` sehingga root di-link dari logo header halaman reward + halaman status. Temuan ini identik dengan U4 di `audits/02-ui-ux-quality.md` dan disinkronkan.

Audit ulang menemukan **tiga temuan nyata yang terlewat**: dead branch `?m=` di halaman cek-email (C3), dua celah mirror EN — `subscribe-again` dan `404` (C4), serta seed tanpa guard produksi (C5, memperkuat DEP3 audit 10). Semuanya minor dan tidak memblokir, tetapi C3 dan C4 adalah fitur setengah jadi yang sebenarnya mudah ditutup.

**Verdict audit 11: LULUS BERSYARAT** — C1 perlu diputuskan sebelum launch (redirect atau landing sungguhan + noindex sementara); C3/C4/C5 diselesaikan sebagai pembersihan pasca-launch atau sekalian sebelum launch (C3/C4 murah).

## Temuan

### C1 — Halaman root `/` masih stub scaffold dan indexable (bukan orphan)
- Status: **UTAMA. VALID, dikoreksi.**
- Bukti: `src/pages/index.astro:1-9` — hanya `<h1>KelasWFA Kado</h1>` + `<p>Halaman hadiah KelasWFA.</p>`. Tidak berubah sejak commit scaffold `5af00b4` (`git log --oneline -- src/pages/index.astro` → hanya commit itu). Tanpa mirror `/en/` (tidak ada `src/pages/en/index.astro`), tidak ada di sitemap (`src/pages/api/sitemap.xml.ts:36-46` hanya meng-emit `/r/<slug>` dan `/en/r/<slug>`), dan tanpa `noindex` (`src/pages/index.astro` tidak mengoper prop itu; default `noindex = false` di `src/layouts/PublicLayout.astro:16`, dirender hanya bila true di `:25`) → **indexable**.
- Koreksi klaim lama: root **TIDAK orphan**. `href="/"` muncul 10 kali dan di antaranya adalah logo header halaman reward (`src/pages/r/[slug].astro:60`, `src/pages/en/r/[slug].astro:65`), halaman status (`src/pages/konfirmasi/[token].astro:22`, `src/pages/en/konfirmasi/[token].astro:22`, `src/pages/batal-berlangganan/[token].astro:23`, `src/pages/en/batal-berlangganan/[token].astro:21`, `src/pages/subscribe-again/[token].astro:24,32`), `src/components/CampaignPaused.astro:28`, dan `src/lib/notfound.ts:63`. Klaim lama "nol `href=\"/\"` di seluruh `src/` (orphan)" salah.
- Root tetap terjangkau pengguna nyata: token invalid di `/akses/[token]` dan `/en/akses/[token]` me-redirect ke `/` (`src/pages/akses/[token].astro:13`, `src/pages/en/akses/[token].astro:13` — `Astro.redirect("/", 303)`).
- Sinkronisasi: identik dengan U4 di `audits/02-ui-ux-quality.md:45-50` (yang juga sudah mengoreksi klaim orphan).
- Dampak: pengguna dengan link hadiah rusak/kedaluwarsa mendarat di halaman nyaris kosong, bukan halaman bantuan. PRD tidak menspesifikasikan halaman root; alur produk selalu dimulai dari `/r/<slug>`.
- Rekomendasi (pilih satu sebelum launch):
  1. Redirect `/` ke campaign utama (atau campaign published pertama) — satu baris, konsisten dengan model "trafik masuk via landing reward"; atau
  2. Buat landing root sungguhan (daftar campaign published) bila diinginkan sebagai direktori; atau
  3. Minimal: tambah `noindex` + CTA kembali ke campaign contoh, agar tidak terindeks sebagai halaman kosong.

### C2 — Mock aman (dicatat lulus, bukan temuan)
- Bukti: default kode semuanya `false` bila env tak diset — `MOCK_EMAILIT` di `src/lib/mailworker.ts:23`, `MOCK_R2` di `src/lib/storage.ts:27`, `MO_BROADCAST` di `src/lib/broadcast/worker.ts:149` (pola `env("<NAME>", "false") === "true"`). `MO_BROADCAST=true` hanya mengganti `providerMessageId` menjadi `mo-<id>` tanpa mengubah status/audit — HtH test yang jujur. Panduan deploy memperingatkan eksplisit (`docs/deploy.md:83` "`false` di produksi", `:145`, `:267`, `:330-331`, `docs/deploy.md` troubleshooting).
- Catatan (bukan cacat): `.env.example` justru mengirim `MOCK_EMAILIT=true` (`.env.example:11`) dan `MOCK_R2=true` (`.env.example:12`) demi kenyamanan dev lokal, sedangkan `MO_BROADCAST=false` (`.env.example:22`). Jadi "default false" benar untuk **kode**, tidak untuk **contoh env**. Risiko hanya bila `.env.example` disalin mentah ke produksi; panduan deploy sudah menutup ini.
- Status: tidak ada tindakan. Satu-satunya saran prosedural: checklist go-live sudah mencakup verifikasi mock-off — pastikan dijalankan.

### C3 — Dead branch `?m=` (email masked) di halaman cek-email (temuan baru)
- Status: **MINOR / FITUR SETENGAH JADI.**
- Bukti: `src/pages/cek-email.astro:9-10` dan `src/pages/en/cek-email.astro:9-10` membaca `Astro.url.searchParams.get("m")`, memanggil `maskedEmail(raw)`, dan menaruhnya ke copy `checkEmailBody`; fallback `"emailmu"` / `"your email"` bila kosong.
- Pembaca ada, **produsen tidak ada**: `cekEmailPath` di `src/pages/api/subscribe.ts:12-19` hanya membangun `/${cek-email}` + `?e=<reason>` opsional + `&s=<slug>`; tidak pernah menambahkan `?m=`. Sweep `maskedEmail` hanya menemukan definisi (`src/lib/templates.ts:4`), pemakaian di kedua cek-email, dan re-export `src/lib/subscribe.ts:103` — tidak ada yang meng-encode `m=` ke URL. Tidak ada JS klien yang membangun URL itu.
- Konsekuensi: copy "kami mengirim email ke {email}" selalu jatuh ke teks generik; masking server tidak pernah aktif di produksi. Secara keamanan aman (anti-enumerasi), tetapi jalur mask sepenuhnya mati.
- Rekomendasi: hapus pembacaan `?m=` (dan komentarnya) agar tidak menyesatkan, **atau** produksi parameter dari `subscribe.ts` bila copy bermask memang diinginkan. Ini melengkapi temuan audit 01.

### C4 — Celah mirror EN: `subscribe-again` dan `404` (temuan baru)
- Status: **MINOR / KELENGKAPAN i18n.**
- Bukti kelengkapan: enam halaman ID punya pasangan EN — `cek-email` (`src/pages/en/cek-email.astro`), `konfirmasi` (`src/pages/en/konfirmasi/[token].astro`), `akses` (`src/pages/en/akses/[token].astro`), `batal-berlangganan` (`src/pages/en/batal-berlangganan/[token].astro`), `privacy` (`src/pages/en/privacy.astro`), `r` (`src/pages/en/r/[slug].astro`).
- Yang terlewat:
  1. **`subscribe-again` tanpa mirror.** Tidak ada `src/pages/en/subscribe-again/`. Padahal halaman konfirmasi unsubscribe EN menautkan "Subscribe again" ke `/subscribe-again/<token>` (halaman ID) — `src/pages/en/batal-berlangganan/[token].astro:10` dan `:36`. Pengguna EN mendarat di halaman berbahasa Indonesia.
  2. **404 berbahasa Indonesia.** `src/lib/notfound.ts:12` hardcode `<html lang="id">` dan copy `:61-63` ("Halaman tidak ditemukan" / "Kembali ke beranda"). Halaman reward EN memakai sumber tunggal ini via `notFoundResponse()` (`src/pages/en/r/[slug].astro:26,30,33`) sehingga 404 untuk pengguna EN ikut berbahasa Indonesia; tidak ada `src/pages/en/404.astro`.
- Koreksi klaim lama: verifikasi #7 lama ("mirror EN lengkap kecuali root") keliru — selain `index`, `subscribe-again` dan `404` juga tanpa padanan EN.
- Rekomendasi: tambah `/en/subscribe-again/[token]` (duplikasi copy EN) dan buat `notFoundHtml()` menerima opsi locale, lalu panggil dengan `"en"` dari `en/r/[slug].astro`. Terendah: minimal alihkan tautan EN ke halaman EN terdekat.

### C5 — Seed tanpa guard produksi (temuan baru, memperkuat DEP3 audit 10)
- Status: **MINOR / OPERASIONAL.**
- Bukti: `scripts/seed.ts` melakukan operasi destruktif ber-scope (`:172-201` hapus baris `[E2E]%` / `admin-e2e-%`; `:216-218` hapus rate limit `admin-login-*`) plus insert data contoh (`:89-164`), tetapi **tidak ada** guard `NODE_ENV`/`APP_ENV` — sweep `NODE_ENV` di file ini nol hasil. Menjalankan `npm run seed` di DB produksi akan meng-insert campaign contoh dan menghapus baris berprefix tersebut bila ada.
- Idempotensi sendiri **terverifikasi**: insert domain/doa/campaign/locale ber-guard eksistensi atau `onConflictDoNothing` (`scripts/seed.ts:92-140,155-160`), didukung constraint unik `reward_campaign_locale(campaign_id, locale)` (`src/lib/schema.ts:48`) dan `doa_selection(campaign_id, variant)` (`src/lib/schema.ts:97`); delete ber-scope ketat. Jadi klaim lama "seed aman dijalankan ulang" benar.
- Rekomendasi: tolak eksekusi bila `NODE_ENV === "production"` (dengan override eksplisit), atau pisahkan perintah seed e2e dari seed konten.

## Verifikasi per area (yang terkonfirmasi)

1. **Nol marker sisa kerja.** Grep `TODO|FIXME|XXX|HACK|PLACEHOLDER` di `src/ scripts/ test/ docs/` (di luar `audits/`) — nol hasil. Benar.
2. **Nol debug tertinggal.** `console.*` di `src/` — nol hasil (logging hanya di `scripts/`, mis. `scripts/seed.ts:48,94,111,190,201,209,220`, wajar untuk skrip operasional). Benar.
3. **Nol konten dummy.** Tidak ada lorem/ipsum/asdf/qwerty/test123 di permukaan render; kemunculan "placeholder" yang tersisa hanyalah atribut HTML form admin dan kelas CSS `.placeholder` (`src/pages/admin/campaigns/[id].astro:105,463`, `src/pages/admin/domains.astro:39`), bukan konten dummy. Data contoh (campaign `starter-kit`, PDF sample) hanya di `scripts/seed.ts` dan didokumentasikan boleh dihapus lewat admin. Benar.
4. **Dummy hash adalah pola keamanan.** `DUMMY_PASSWORD_HASH` di `src/lib/admin/login.ts:24-25` — verifikasi terhadap hash dummy untuk email tak dikenal agar timing seragam (anti-enumerasi), dikomentari di `:20-23`, dipakai di `:45`. Disengaja, benar.
5. **Recipient preview dummy terisolasi.** `admin@example.com` di `src/pages/admin/api/email-campaigns/[id]/preview.ts:61`, didokumentasikan di header `:15` ("tidak menyentuh recipient/data lain"). Benar.
6. **Nol route/API stub.** Semua handler punya logika: health ping DB (`src/pages/api/health.ts:8-15`), cron outbox/broadcast (`src/pages/api/cron/outbox.ts:12`, `src/pages/api/cron/broadcast.ts:17`), proxy obraz (`src/pages/api/image/[...key].ts:9-11`), unduhan ber-rate-limit (`src/pages/api/download/[session]/[assetId].ts:15-20`), click tracking (`src/pages/api/click/[linkId]/[token].ts:14-21`), logout revoke sesi+device (`src/pages/admin/api/logout.ts:30-42`). Respons generik di login/reset (`src/pages/admin/api/login.ts:32-36`, `src/lib/admin/login.ts:107,110,132`) adalah anti-enumerasi yang disengaja, bukan stub.
7. **Mirror EN — dikoreksi.** Enam halaman punya pasangan ID/EN (cek-email, akses, konfirmasi, batal-berlangganan, privacy, r). Tiga tidak: `index` (C1), `subscribe-again`, dan `404` (C4). Klaim lama yang hanya menyebut `index` tidak akurat.
8. **Komentar kode menjelaskan, bukan menonaktifkan.** Grep baris berawalan `// import|const|let|return|await|function|export` — nol hasil; sampel komentar yang diperiksa semuanya kalimat penjelas utuh. Benar.
9. **Seed idempoten.** Guard eksistensi + `onConflictDoNothing` + constraint unik; delete ber-scope `[E2E]%`/`admin-e2e-%`/rate-limit admin (lihat C5 untuk bukti). Benar; guard produksi tetap tidak ada.

## Yang belum dinilai pada tahap ini

- Apakah konten seed (teks campaign contoh, template doa) sudah layak tampil sebagai konten produksi bila operator lupa menghapus — keputusan konten, masuk tahap 13.
- Visual halaman root alternatif (tahap 2 tidak menilai `/` karena stub).
- Kelengkapan copy EN pada halaman ID yang sudah punya mirror (hanya dicek keberadaan file, bukan kualitas terjemahan).

## Rekomendasi prioritas

1. Putuskan nasib `/` sebelum launch (C1) — redirect ke campaign utama adalah opsi termurah dan paling konsisten.
2. Tutup dead branch `?m=` di cek-email (C3) dan tambah mirror EN `subscribe-again` + 404 (C4) — keduanya perubahan kecil dan menghilangkan fitur setengah jadi.
3. Tambah guard produksi pada `scripts/seed.ts` (C5), selaras DEP3 audit 10.
4. Pastikan checklist go-live memverifikasi ketiga mock dalam posisi off (sudah ada di `docs/deploy.md:145,267` — tinggal dijalankan).

## Catatan revisi audit ulang

| Klaim lama (sebelum revisi) | Hasil verifikasi | Tindakan |
|---|---|---|
| C1: root `/` stub + indexable | **Benar.** `src/pages/index.astro:1-9`; tanpa `noindex` (`PublicLayout.astro:16,25`); tidak masuk sitemap (`sitemap.xml.ts:36-46`) | Dipertahankan |
| C1: "nol `href=\"/\"` di seluruh `src/` (orphan — tidak di-link dari mana pun)" | **Salah.** Ada 10 kemunculan: `r/[slug].astro:60`, `en/r/[slug].astro:65`, `CampaignPaused.astro:28`, `notfound.ts:63`, `konfirmasi/[token].astro:22`, `en/konfirmasi/[token].astro:22`, `batal-berlangganan/[token].astro:23`, `en/batal-berlangganan/[token].astro:21`, `subscribe-again/[token].astro:24,32` | Dikoreksi di C1; disinkronkan dengan U4 `audits/02-ui-ux-quality.md:45-50` |
| C1: root terjangkau via redirect token invalid | **Benar.** `akses/[token].astro:13`, `en/akses/[token].astro:13` → `Astro.redirect("/", 303)` | Dipertahankan |
| C2: mock default `false` bila env tak diset | **Benar untuk kode.** `mailworker.ts:23`, `storage.ts:27`, `worker.ts:149` | Dipertahankan + catatan `.env.example:11-12` justru `true` (dev) |
| Verifikasi #7: "mirror EN lengkap kecuali root" | **Tidak akurat.** Selain `index`, `subscribe-again` dan `404` juga tanpa mirror (tidak ada `src/pages/en/subscribe-again/`, `src/pages/en/404.astro`) | Dikoreksi → temuan baru C4 |
| Verifikasi #9: seed idempoten | **Benar** (`seed.ts:92-140,155-160`; constraint `schema.ts:48,97`) | Dipertahankan + temuan baru C5 (tanpa guard produksi; `NODE_ENV` nol hasil di `seed.ts`) |
| Verifikasi #1/#2/#3/#4/#5/#6/#8 | **Benar**, bukti ditambah di tiap butir (lihat "Verifikasi per area") | Dipertahankan dengan file:line |
| Tidak ada temuan dead branch `?m=` | **Terlewat.** `cek-email.astro:9-10`, `en/cek-email.astro:9-10` membaca `m`; `subscribe.ts:12-19` tidak pernah memproduksinya | Temuan baru C3 |
| Verdict "Verdict tahap 11" | Label tidak sesuai nomor file | Diganti "Verdict audit 11" |
