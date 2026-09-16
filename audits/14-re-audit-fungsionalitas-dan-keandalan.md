# Audit 14 — Re-Audit Fungsionalitas, Logika Bisnis, dan Keandalan Aplikasi

Tanggal: 2026-09-16  
Lingkup: Seluruh fungsionalitas aplikasi, alur bisnis, keandalan runtime, integritas data, dan penanganan edge case (tidak berfokus pada security penetration testing).  
Metode: Analisis kode mendalam, validasi tipe (`astro check`), eksekusi unit/integrasi test (`vitest`), eksekusi end-to-end test (`playwright`), serta penelusuran race conditions dan state machine.

---

## Ringkasan Eksekutif

Audit ini dilakukan secara independen untuk menguji apakah seluruh sistem aplikasi KelasWFA Newsletter berfungsi normal, konsisten, dan tahan banting pada kondisi nyata.

Meskipun suite pengujian otomatis (`vitest` 356 tests passed dan `playwright` 11 tests passed) saat ini berstatus hijau, pengujian statis dan pengujian unit berbasis mock sering kali tidak menangkap:
1. **Perilaku transaksi database Postgres sesungguhnya** (misalnya penguncian baris `FOR UPDATE` di luar blok transaksi).
2. **Kondisi transisi state machine pada celah waktu antar-tick pekerja latar belakang (worker background)**.
3. **Penyimpangan sinkronisasi antara elemen DOM di frontend admin dengan payload yang diterima API backend**.
4. **Variabilitas latensi jaringan seluler nyata** terhadap mekanisme time-lock anti-bot.

Dari hasil re-audit komprehensif ini, ditemukan **16 masalah fungsionalitas dan keandalan**, yang dikelompokkan dalam tingkat keparahan:
- **Kritis (Critical - Berisiko Data Loss / Broken Core Feature):** 4 temuan
- **Sedang (Medium - Edge Case / Degradasi Layanan / Serverless Timeout):** 7 temuan
- **Rendah (Low / Minor / Developer Experience):** 5 temuan

---

## Matriks Ringkasan Temuan

| ID | Tingkat Keparahan | Komponen | Ringkasan Masalah |
| :--- | :--- | :--- | :--- |
| **BUG-01** | **Kritis** | Admin CMS (`[id].astro`, API) | **Data Loss:** Field `featuredImageKey` selalu terhapus (`null`) saat admin menyimpan campaign karena selector `#f-image` tidak ada di DOM. |
| **BUG-02** | **Kritis** | Outbox Transaksional (`mailworker.ts`) | **Duplikasi Email Transaksional:** `FOR UPDATE SKIP LOCKED` dipanggil di luar transaksi DB, menyebabkan baris pending ditarik ganda oleh tick konkuren. |
| **BUG-03** | **Kritis** | Broadcast Engine (`machine.ts`, `laporan.astro`) | **Tombol Jeda (Pause) Tidak Berfungsi:** Status kampanye aktif berubah menjadi `"queued"` di sela-sela tick, sehingga transisi jeda selalu ditolak `400 invalid-transition`. |
| **BUG-04** | **Kritis** | Broadcast Engine (`machine.ts`, `worker.ts`) | **Deadlock Antrean Permanen:** Jika server mati/restart saat mengirim kampanye (`status = 'sending'`), tidak ada pemulihan status; seluruh antrean kampanye terkunci selamanya. |
| **BUG-05** | **Sedang** | Funnel Subscribe (`EmailForm.astro`, `timer.ts`) | **Penolakan Palsu `too-fast` di Mobile:** Latensi jaringan saat mengambil `timer-token` menyebabkan usia token server lebih muda dari timer frontend (tanpa toleransi clock drift). |
| **BUG-06** | **Sedang** | Unsubscribe Flow (`[token].ts`) | **Alur Unsubscribe EN Terlempar ke ID:** Penerima newsletter berbahasa Inggris diarahkan ke UI `/batal-berlangganan/...` (ID), mengabaikan rute `/en/`. |
| **BUG-07** | **Sedang** | Halaman Akses Reward (`akses/[token].astro`) | **Refresh Halaman Terlempar ke Beranda:** Token akses sekali pakai hangus saat pertama dibuka tanpa redirect URL ke session token, sehingga reload halaman mengembalikan pengguna ke `/`. |
| **BUG-08** | **Sedang** | Broadcast Snapshot (`snapshot.ts`) | **Risiko Serverless Execution Timeout:** Query `db.insert` dieksekusi sekuensial satu-per-satu per penerima, rawan melebihi batas waktu eksekusi (10–15s) pada ribuan kontak. |
| **BUG-09** | **Sedang** | SEO & Bot Crawling (`sitemap.xml`, `robots.txt`) | **Sitemap 404 & Robots Hilang:** `/sitemap.xml` menghasilkan 404 (hanya ada `/api/sitemap.xml`) dan berkas `robots.txt` belum tersedia di root publik. |
| **BUG-10** | **Sedang** | Broadcast Audience Filter (`audience.ts`) | **Potensi OOM Node.js:** Penghitungan audiens (`countAudience`) menarik seluruh record kontak ke memori aplikasi alih-alih menjalankan `SELECT COUNT(*)`. |
| **BUG-11** | **Sedang** | Cloudflare R2 Storage (`storage.ts`) | **Crash pada Dev/Test tanpa Kredensial R2:** `presignDownloadUrl` tidak memeriksa flag `MOCK_R2`, menyebabkan exception `Missing env: R2_ACCOUNT_ID`. |
| **BUG-12** | **Rendah** | Admin Form Types (`campaign-form.ts`) | **TypeScript Compilation Error:** Type `CampaignFormPayload` tidak memuat `redirectConfirmed`, menyebabkan kegagalan saat menjalankan `npm run check`. |
| **BUG-13** | **Rendah** | Rate Limiting (`ratelimit.ts`) | **Akumulasi Data Tanpa Batas:** Tabel `rate_limit` tidak memiliki mekanisme pruning/pembersihan periodik untuk entri window yang sudah kedaluwarsa. |
| **BUG-14** | **Rendah** | Halaman Hasil Subscribe (`cek-email.astro`) | **Pesan UI Kontradiktif:** Saat pengguna terkena limit atau domain ditolak, judul halaman tetap "Cek Kotak Masukmu" padahal email tidak pernah dikirim. |
| **BUG-15** | **Rendah** | Campaign CMS Lifecycle (`campaigns.ts`) | **Publikasi Kampanye Kosong:** Kampanye dapat diubah statusnya menjadi `published` tanpa validasi keberadaan konten bahasa Indonesia maupun aset unduhan. |
| **BUG-16** | **Rendah** | Tooling & Test Automation (`playwright.config.ts`) | **Inkompatibilitas Background Dev Server:** Server Playwright gagal terkoneksi di lingkungan agent jika perintah dijalankan dalam mode daemon/background. |

---

## Rincian Temuan dan Rekomendasi Solusi

---

### BUG-01: Data Loss — Field `featuredImageKey` Dihapus Jadi `null` Setiap Kali Campaign Disimpan

- **Tingkat Keparahan:** Kritis (Data Loss)
- **Komponen:** 
  - `src/pages/admin/campaigns/[id].astro` (baris 608)
  - `src/pages/admin/api/campaigns/[id].ts` (baris 121)
- **Akar Masalah:**
  Pada fungsi `save()` di sisi klien (`[id].astro`):
  ```typescript
  featuredImageKey: (document.querySelector<HTMLInputElement>("#f-image")?.value ?? "").trim(),
  ```
  Di dalam markup HTML `[id].astro`, elemen dengan atribut `id="f-image"` **tidak pernah ada**. Akibatnya, `document.querySelector("#f-image")` selalu mengembalikan `null`, dan payload yang dikirim ke API selalu berupa string kosong `""`.
  Di sisi API backend (`[id].ts`):
  ```typescript
  await updateCampaignMeta(
    id,
    {
      featuredImageKey: str(body.featuredImageKey).trim() || null,
      ...
    },
    auditOpts,
  );
  ```
  Karena string kosong dianggap *falsy*, API mengonversinya menjadi `null` dan menimpa nilai `featuredImageKey` yang sudah ada di database. Setiap kali admin menekan tombol "Simpan" untuk mengedit teks kampanye, gambar unggulan (hero image) yang sudah diunggah sebelumnya langsung terhapus secara permanen.
- **Rekomendasi Perbaikan:**
  1. Tambahkan elemen input tersembunyi `<input type="hidden" id="f-image" value={campaign.featuredImageKey ?? ""} />` pada formulir `[id].astro`, atau sesuaikan selector dengan komponen pengunggah gambar yang aktif.
  2. Pada backend (`[id].ts`), bedakan antara field yang sengaja dihapus dengan field yang tidak disertakan/kosong jika form tidak memuat manajemen gambar secara inline.

---

### BUG-02: Duplikasi Pengiriman Email Transaksional pada Tick Konkuren

- **Tingkat Keparahan:** Kritis (Fungsionalitas Email & Reputasi Domain)
- **Komponen:**
  - `src/lib/mailworker.ts` (baris 11–44)
- **Akar Masalah:**
  `processOutbox` bertujuan mengambil antrean email pending dan mengirimkannya ke Emailit:
  ```typescript
  const batch = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.scheduledAt, new Date())))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(20)
    .for("update", { skipLocked: true });
  ```
  Dalam PostgreSQL, penguncian baris via `FOR UPDATE` **hanya bertahan selama masa aktif transaksi database (`BEGIN ... COMMIT`)**. Karena `db.select()` dieksekusi di luar blok `db.transaction()`, Postgres segera melepas kunci baris begitu query `SELECT` selesai.
  Selanjutnya, baris-baris email tersebut diproses dalam perulangan `for (const row of batch)`. Di dalam perulangan, status email masih tetap `"pending"` selagi proses kirim HTTP ke API Emailit berlangsung.
  Jika pada saat bersamaan ada pemanggilan konkuren (misalnya *fast-drain* dari `POST /api/subscribe`, request OTP admin, atau tick cron `/api/cron/outbox`), proses kedua akan menjalankan query `SELECT` yang sama, mendapatkan baris pending yang sama, dan mengirim ulang email yang sama ke pengguna (double-sending).
- **Rekomendasi Perbaikan:**
  Tandai status baris menjadi `"sending"` atau `"processing"` secara atomik dalam transaksi sesaat setelah diklaim:
  ```typescript
  const batch = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.scheduledAt, new Date())))
      .limit(20)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await tx
      .update(emailOutbox)
      .set({ status: "processing" })
      .where(inArray(emailOutbox.id, ids));
    return tx.select().from(emailOutbox).where(inArray(emailOutbox.id, ids));
  });
  ```

---

### BUG-03: Tombol Jeda (Pause) Broadcast Campaign Gagal Berfungsi di Antara Tick Pengiriman

- **Tingkat Keparahan:** Kritis (Kontrol Operasional Admin)
- **Komponen:**
  - `src/lib/broadcast/machine.ts` (baris 217)
  - `src/lib/broadcast/worker.ts` (baris 71–76)
  - `src/pages/admin/email-campaigns/[id]/laporan.astro` (baris 160)
- **Akar Masalah:**
  Fungsi transisi state mesin `pauseCampaign` hanya mengizinkan transisi dari status `"sending"`:
  ```typescript
  export async function pauseCampaign(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
    return transition(id, ["sending"], "paused", "campaign_paused", {}, auditOpts);
  }
  ```
  Namun, pada implementasi worker batching (`worker.ts`):
  Setelah satu batch pengiriman per menit selesai, worker memanggil fungsi `releaseClaim(campaignId)` yang mengembalikan status kampanye menjadi `"queued"` agar dapat diambil kembali pada tick menit berikutnya.
  Hal ini berarti dalam 1 menit waktu pengiriman, kampanye hanya berstatus `"sending"` selama 2–5 detik saat batch dikirim, dan berstatus `"queued"` selama 55 detik sisanya.
  Akibatnya:
  1. Pada halaman `laporan.astro`, tombol jeda dihitung berdasarkan `const canPause = status === "sending"`. Tombol jeda akan menghilang dari layar saat status `"queued"`.
  2. Jika admin memanggil endpoint `/pause`, API mengembalikan error `400 { ok: false, reason: "invalid-transition" }` karena status kampanye saat itu adalah `"queued"`. Admin praktis tidak bisa menghentikan atau menjeda kampanye yang sedang berjalan.
- **Rekomendasi Perbaikan:**
  1. Perbarui `pauseCampaign` di `machine.ts` agar menerima status asal `["sending", "queued"]`:
     ```typescript
     export async function pauseCampaign(id: string, auditOpts?: AuditOpts): Promise<TransitionResult> {
       return transition(id, ["sending", "queued"], "paused", "campaign_paused", {}, auditOpts);
     }
     ```
  2. Perbarui kondisi pada `laporan.astro`:
     ```typescript
     const canPause = status === "sending" || status === "queued";
     ```

---

### BUG-04: Deadlock Antrean Broadcast Permanen Jika Terjadi Interupsi/Crash Server

- **Tingkat Keparahan:** Kritis (Reliability & Kematian Antrean Broadcast)
- **Komponen:**
  - `src/lib/schema.ts` (baris 290)
  - `src/lib/broadcast/machine.ts` (baris 136–166)
  - `src/lib/broadcast/worker.ts` (baris 97–107)
- **Akar Masalah:**
  Skema database menerapkan aturan ketat bahwa hanya boleh ada tepat 1 baris kampanye berstatus `"sending"` menggunakan partial unique index:
  ```typescript
  uniqueIndex("email_campaigns_single_sending_uq").on(t.status).where(sql`${t.status} = 'sending'`)
  ```
  Pada siklus pengiriman (`worker.ts`):
  Worker mencari kampanye berstatus `"queued"`:
  ```typescript
  const [next] = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, "queued"))
    ...
  ```
  Jika terjadi crash server, restart container, atau unhandled exception saat kampanye sedang diproses, baris kampanye tersebut akan tertinggal dalam database dengan status `"sending"`.
  Ketika worker menyala kembali:
  1. Worker hanya mencari status `"queued"`, sehingga kampanye yang macet tadi diabaikan dan tidak pernah diselesaikan.
  2. Jika ada kampanye queued lainnya, pemanggilan `claimForSending(next.id)` akan memeriksa:
     ```sql
     not exists (select 1 from email_campaigns ec where ec.status = 'sending' and ec.id <> campaignId)
     ```
     Kondisi ini selalu bernilai **false** (karena kampanye yang macet masih berstatus `"sending"`).
  3. Seluruh antrean pengiriman broadcast membeku secara permanen (*deadlock*) dan tidak ada email baru yang bisa dikirim sampai ada perbaikan manual langsung via database console.
- **Rekomendasi Perbaikan:**
  Tambahkan pemulihan *stale claim* (*heartbeat timeout*) pada awal tick worker:
  Jika ditemukan kampanye berstatus `"sending"` yang kolom `updatedAt`-nya lebih lama dari ambang batas aman (misalnya > 5–10 menit), reset statusnya kembali menjadi `"queued"` atau tangani kegagalannya:
  ```typescript
  await db
    .update(emailCampaigns)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(emailCampaigns.status, "sending"), lt(emailCampaigns.updatedAt, staleThreshold)));
  ```

---

### BUG-05: Penolakan Palsu `too-fast` pada Pengguna Jaringan Seluler (Mobile)

- **Tingkat Keparahan:** Sedang (Konversi Pengguna & UX Funnel)
- **Komponen:**
  - `src/components/EmailForm.astro` (baris 127–139)
  - `src/lib/timer.ts` (baris 32–33)
- **Akar Masalah:**
  Di frontend (`EmailForm.astro`):
  Saat halaman dimuat, timer frontend mencatat `const start = Date.now()` dan mulai menghitung mundur selama 30.000 ms.
  Bersamaan dengan itu, frontend memanggil `fetch("/api/timer-token")` secara asinkron untuk menyegarkan token.
  Pada jaringan dengan latensi (misal seluler 4G/3G dengan RTT 400–1000 ms), server baru memproses penerbitan token 500–1000 ms setelah halaman dimuat. Token tersebut dicatat dengan `iat = Date.now()` di server.
  Ketika pengguna menunggu hingga tombol berubah menjadi aktif (tepat 30.000 ms menurut jam browser) dan langsung mengklik tombol submit:
  Permintaan masuk ke backend `/api/subscribe`.
  Backend memvalidasi:
  ```typescript
  const age = Date.now() - payload.iat;
  if (age < MIN_AGE_MS) return { ok: false, reason: "too-fast" };
  ```
  Karena token baru diterbitkan 500 ms setelah start client, usia token di server saat submit baru mencapai ~29.500 ms.
  Karena sistem menggunakan batas kaku 30.000 ms tanpa toleransi (*grace period*), pengguna sah yang benar-benar menunggu 30 detik di layar justru ditolak dan dilempar ke `/cek-email?e=too-fast`.
- **Rekomendasi Perbaikan:**
  Tambahkan toleransi clock drift / latensi jaringan (misalnya 2.000 ms) di `src/lib/timer.ts`:
  ```typescript
  const LATENCY_BUFFER_MS = 2_000;
  if (age < (MIN_AGE_MS - LATENCY_BUFFER_MS)) return { ok: false, reason: "too-fast" };
  ```

---

### BUG-06: Pengguna Newsletter Bahasa Inggris Terjebak di Halaman Unsubscribe Bahasa Indonesia

- **Tingkat Keparahan:** Sedang (Lokalisasi & Kepatuhan I18n)
- **Komponen:**
  - `src/pages/api/unsubscribe/[token].ts` (baris 32–38)
- **Akar Masalah:**
  Saat pengguna mengklik tautan berhenti langganan di footer email:
  API memanggil `resolveUnsubscribeToken(raw)` yang berhasil mendeteksi dan mengembalikan properti bahasa kontak (`locale: "en" | "id"`).
  Namun pada bagian pengalihan (redirect):
  ```typescript
  return new Response(null, {
    status: 303,
    headers: {
      Location: target ? `/batal-berlangganan/${raw}` : "/batal-berlangganan/invalid",
      "Cache-Control": "no-store",
    },
  });
  ```
  URL tujuan di-hardcode ke `/batal-berlangganan/${raw}` (Bahasa Indonesia). Halaman mitra bahasa Inggris yang sudah tersedia di proyek (`src/pages/en/batal-berlangganan/[token].astro` dan `src/pages/en/batal-berlangganan/invalid.astro`) tidak pernah digunakan oleh endpoint ini.
- **Rekomendasi Perbaikan:**
  Gunakan locale target untuk mengarahkan pengguna ke halaman yang tepat:
  ```typescript
  const prefix = target?.locale === "en" ? "/en" : "";
  const location = target ? `${prefix}/batal-berlangganan/${raw}` : `${prefix}/batal-berlangganan/invalid`;
  ```

---

### BUG-07: Token Akses Sekali Pakai Mengarahkan Pengguna ke Beranda Saat Halaman Di-refresh

- **Tingkat Keparahan:** Sedang (Aksesibilitas Unduhan Pengguna)
- **Komponen:**
  - `src/pages/akses/[token].astro` (baris 9–12)
  - `src/pages/en/akses/[token].astro` (baris 9–12)
  - `src/lib/access-page.ts` (baris 29–41)
- **Akar Masalah:**
  Tautan akses yang dikirim ke email pengguna membawa token bertipe `"access"` yang bersifat sekali pakai (*single-use*).
  Saat URL `/akses/<access_token>` pertama kali dibuka, `resolveAccess()` langsung menghanguskan token `"access"` tersebut di database dan menukarkannya dengan `sessionToken` baru yang berlaku selama 1 jam.
  Namun, URL pada browser pengguna tetap berada di `/akses/<access_token>`.
  Jika pengguna me-refresh halaman (F5), membuka kembali link dari browser history, atau koneksi sempat terputus:
  Browser kembali meminta `/akses/<access_token>`.
  Fungsi `resolveAccess` gagal karena token `"access"` sudah berstatus terpakai/hangus.
  Halaman mengeksekusi:
  ```typescript
  if (!resolved.ok) return Astro.redirect("/", 303);
  ```
  Pengguna langsung ditendang ke halaman beranda tanpa penjelasan, dan kehilangan akses ke berkas yang baru saja diklaimnya.
- **Rekomendasi Perbaikan:**
  Ketika `resolveAccess()` menukarkan token `"access"` menjadi `"session"`, lakukan pengalihan HTTP 303 langsung ke `/akses/<sessionToken>`:
  Dengan demikian, URL yang tersimpan dan aktif di browser adalah session token (yang sah digunakan berulang kali selama 1 jam).

---

### BUG-08: Perulangan Sekuensial 1-per-1 pada `snapshotRecipients` Berisiko Timeout di Serverless

- **Tingkat Keparahan:** Sedang (Kapasitas Skala & Batas Serverless)
- **Komponen:**
  - `src/lib/broadcast/snapshot.ts` (baris 97–128)
- **Akar Masalah:**
  Pada saat kampanye dijadwalkan/disiapkan, seluruh penerima audiens di-snapshot ke tabel `emailCampaignRecipients`:
  ```typescript
  for (const { contactId, locale } of audience) {
    ...
    const inserted = await db
      .insert(emailCampaignRecipients)
      .values({ ... })
      ...
  }
  ```
  Setiap penerima melakukan 1 kali round-trip network/query ke PostgreSQL secara sekuensial.
  Jika sebuah newsletter memiliki 2.500 pelanggan, dan setiap query memakan waktu 15 ms:
  Waktu total yang dibutuhkan mencapai $2500 \times 15\text{ ms} = 37,5\text{ detik}$.
  Lingkungan serverless seperti Vercel Function memiliki batas waktu eksekusi default 10–15 detik (maksimum 60 detik). Proses snapshot akan terputus di tengah jalan oleh sinyal SIGKILL platform, meninggalkan kampanye dalam keadaan setengah tersimpan.
- **Rekomendasi Perbaikan:**
  Gunakan batch insert (misalnya per 200–500 baris) dalam satu statement `db.insert(...).values([...])`:
  Pendekatan ini memangkas 2.500 query individual menjadi hanya 5–10 batch query, memangkas waktu eksekusi dari puluhan detik menjadi di bawah 1 detik.

---

### BUG-09: Web Crawler Terputus dari Sitemap (`/sitemap.xml` 404 & Ketiadaan `robots.txt`)

- **Tingkat Keparahan:** Sedang (SEO & Pengindeksan Search Engine)
- **Komponen:**
  - `src/pages/api/sitemap.xml.ts`
  - Direktori `public/`
- **Akar Masalah:**
  1. Endpoint sitemap yang ada saat ini beralamat di `/api/sitemap.xml`. Standar web crawler (Googlebot, Bingbot) mencari sitemap di root domain `/sitemap.xml`. Akses langsung ke `GET /sitemap.xml` saat ini menghasilkan HTTP 404 Not Found.
  2. Proyek belum menyediakan file `robots.txt` pada direktori publik untuk memberitahukan lokasi sitemap maupun aturan perayapan bot.
- **Rekomendasi Perbaikan:**
  1. Buat endpoint proxy/redirect di `src/pages/sitemap.xml.ts` yang meneruskan atau menyajikan output sitemap yang sama dengan `/api/sitemap.xml`.
  2. Tambahkan file `public/robots.txt` yang memuat:
     ```text
     User-agent: *
     Allow: /
     Disallow: /admin/
     Disallow: /api/
     Sitemap: https://kelaswfa.my.id/sitemap.xml
     ```

---

### BUG-10: `countAudience` Mengambil Seluruh Baris Kontak ke Memori Node.js

- **Tingkat Keparahan:** Sedang (Efisiensi Memori & Skalabilitas)
- **Komponen:**
  - `src/lib/broadcast/audience.ts` (baris 131–134)
  - `src/pages/admin/api/email-campaigns/count.ts`
- **Akar Masalah:**
  Ketika admin memilih target audiens di form broadcast, antarmuka admin memanggil endpoint `/count` secara real-time untuk menampilkan estimasi jumlah penerima:
  ```typescript
  export async function countAudience(filter: AudienceFilter): Promise<number> {
    const rows = await audienceQuery(filter);
    return rows.length;
  }
  ```
  `audienceQuery(filter)` mengeksekusi `SELECT` terhadap kolom kontak dan mentransfer seluruh baris database ke dalam memori Node.js hanya untuk dibaca properti `.length`-nya.
  Jika basis pelanggan bertumbuh hingga puluhan ribu kontak, setiap ketikan filter pada CMS akan menyebabkan transfer data berukuran megabyte melalui koneksi database dan alokasi array besar di memori runtime Node.js, yang berpotensi memicu lonjakan CPU/OOM.
- **Rekomendasi Perbaikan:**
  Ubah fungsi `countAudience` agar memanfaatkan agregasi `SELECT COUNT(*)` di tingkat database Postgres alih-alih menarik seluruh baris data.

---

### BUG-11: `presignDownloadUrl` Mengalami Crash pada Dev/Test tanpa Kredensial R2

- **Tingkat Keparahan:** Sedang (Dev & Testing Reliability)
- **Komponen:**
  - `src/lib/storage.ts` (baris 56–70)
- **Akar Masalah:**
  Pada fungsi `putObject`:
  ```typescript
  if (env("MOCK_R2", "false") === "true") return;
  ```
  Sistem secara cerdas menyediakan flag `MOCK_R2` agar developer dapat menjalankan aplikasi secara lokal dan CI test tanpa perlu akun Cloudflare R2 sungguhan.
  Namun pada fungsi `presignDownloadUrl`, pengecekan `MOCK_R2` tidak diterapkan:
  ```typescript
  export async function presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
    ...
    const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
    ...
  ```
  Fungsi ini langsung memanggil `env("R2_ACCOUNT_ID")`. Jika variabel lingkungan R2 tidak diisi, pemanggilan endpoint `/api/download/:sessionToken/:assetId` langsung melempar exception:
  `Error: Missing env: R2_ACCOUNT_ID`.
- **Rekomendasi Perbaikan:**
  Tambahkan penanganan mock pada `presignDownloadUrl`:
  ```typescript
  if (env("MOCK_R2", "false") === "true") {
    return `/mock-download/${encodeURIComponent(storageKey)}`;
  }
  ```

---

### BUG-12: Type Error TypeScript pada `src/lib/admin/campaign-form.ts:139`

- **Tingkat Keparahan:** Rendah (Build / Static Typing)
- **Komponen:**
  - `src/lib/admin/campaign-form.ts` (baris 31–41, baris 139)
- **Akar Masalah:**
  Fungsi `toUpdateBody` mengembalikan:
  ```typescript
  return { ok: true, body: { ...parsed.body, redirectConfirmed } };
  ```
  Namun definisi tipe `CampaignFormPayload['body']` di bagian atas file tidak mendefinisikan field `redirectConfirmed?: boolean`.
  Akibatnya, perintah `npm run check` atau `astro check` menghasilkan error kompilasi TypeScript:
  `ts(2353): Object literal may only specify known properties, and 'redirectConfirmed' does not exist in type...`
- **Rekomendasi Perbaikan:**
  Tambahkan `redirectConfirmed?: boolean;` ke dalam definisi tipe `CampaignFormPayload['body']`.

---

### BUG-13: Tabel `rate_limit` Mengalami Pembengkakan Tanpa Mekanisme Retensi/Pruning

- **Tingkat Keparahan:** Rendah (Database Hygiene & Disk Usage)
- **Komponen:**
  - `src/lib/ratelimit.ts` (baris 16–22)
- **Akar Masalah:**
  Setiap request yang dikenakan limit membuat key berbasis window jam:
  ```typescript
  const key = `${scope}:${identity}:${Math.floor(Date.now() / windowMs)}`;
  ```
  Key ini dimasukkan ke tabel `rate_limit`. Seiring berjalannya waktu, baris data untuk window jam-jam sebelumnya tidak pernah dihapus atau di-prune oleh cron job apa pun. Setelah berbulan-bulan di lingkungan produksi dengan jutaan request bot dan web crawler, tabel ini akan terus membengkak tanpa henti.
- **Rekomendasi Perbaikan:**
  Tambahkan query pembersihan pada cron outbox atau cron broadcast:
  ```sql
  DELETE FROM rate_limit WHERE window_start < NOW() - INTERVAL '24 hours';
  ```

---

### BUG-14: Inkonsistensi Pesan UI pada `/cek-email` saat Request Ditolak

- **Tingkat Keparahan:** Rendah (User Experience)
- **Komponen:**
  - `src/pages/cek-email.astro` (baris 36–44)
  - `src/pages/en/cek-email.astro`
- **Akar Masalah:**
  Ketika pengguna terkena rate-limit (`?e=rate-limited`) atau domain emailnya dilarang (`?e=domain-not-allowed`), halaman `/cek-email` tetap menampilkan:
  - Header utama: **"Cek Kotak Masukmu"**
  - Teks penjelasan: *"Kami sudah mengirimkan tautan akses ke emailmu..."*
  - Di bawahnya baru muncul kotak peringatan kecil: *"Terlalu banyak permintaan..."*
  Ini sangat membingungkan pengguna, karena aplikasi menginstruksikan mereka untuk memeriksa inbox padahal email konfirmasi sama sekali tidak pernah dikirimkan ke alamat mereka.
- **Rekomendasi Perbaikan:**
  Ketika parameter `error` ada di URL, ubah judul dan teks utama menjadi kondisi gagal submit alih-alih menampilkan instruksi sukses cek email.

---

### BUG-15: Kampanye Dapat Diterbitkan Tanpa Konten Bahasa Indonesia dan Aset Unduhan

- **Tingkat Keparahan:** Rendah (Integritas Konten CMS)
- **Komponen:**
  - `src/lib/admin/campaigns.ts` (baris 185–216)
- **Akar Masalah:**
  Transisi status `publish` hanya memvalidasi apakah status saat ini adalah `"draft"`:
  ```typescript
  const allowed = { publish: ["draft"], ... };
  if (!allowed[action].includes(camp.status)) return { ok: false, reason: "invalid-transition" };
  ```
  Tidak ada pengecekan kelayakan (*readiness check*) apakah:
  1. Konten minimal bahasa Indonesia (`title`, `description`) sudah diisi.
  2. Setidaknya ada 1 aset reward yang sudah diunggah.
  Jika seorang admin tanpa sengaja mengklik tombol terbitkan pada kampanye yang baru dibuat, landing page publik `/r/<slug>` akan rusak atau pengguna yang mendaftar akan menerima email dengan tautan unduhan kosong.
- **Rekomendasi Perbaikan:**
  Tambahkan validasi *pre-publish readiness guard*: tolak publikasi dengan alasan `"missing-content"` atau `"missing-assets"` jika kampanye belum memenuhi persyaratan minimum.

---

### BUG-16: Dev Server Playwright E2E Gagal Dimulai di Lingkungan Non-Interaktif / Agent

- **Tingkat Keparahan:** Rendah (Developer Tooling & CI Automation)
- **Komponen:**
  - `playwright.config.ts` (baris 11–15)
  - Panduan `AGENTS.md`
- **Akar Masalah:**
  Aturan proyek `AGENTS.md` merekomendasikan `astro dev --background`. Namun konfigurasi Playwright webServer (`npm run dev`) mengharapkan proses foreground yang menahan stdin/stdout agar Playwright tahu kapan web server siap dan dapat mematikan child process setelah pengujian selesai.
  Jika variabel lingkungan atau script dev dieksekusi secara tidak tepat di lingkungan CI/AI agent, server pengujian Playwright mengalami hang hingga timeout 60 detik.
- **Rekomendasi Perbaikan:**
  Pastikan perintah webServer Playwright secara eksplisit menjalankan Astro dalam foreground mode (`astro dev --no-background` atau flag serupa).

---

## Roadmap Rekomendasi Pelaksanaan Perbaikan

Disarankan perbaikan dilakukan secara bertahap sesuai prioritas:

### Fase 1 — Perbaikan Kritis & Pencegahan Data Loss / Deadlock (Paling Mendesak)
1. **Perbaikan BUG-01:** Perbaiki binding `#f-image` pada form admin campaign dan tambahkan fallback aman di API agar tidak menghapus gambar yang sudah ada.
2. **Perbaikan BUG-02:** Bungkus klaim outbox transaksional dalam transaksi database atomik dengan perubahan status ke `"processing"`.
3. **Perbaikan BUG-03:** Izinkan status `"queued"` pada `pauseCampaign` dan perbarui kondisi tombol jeda di `laporan.astro`.
4. **Perbaikan BUG-04:** Tambahkan mekanisme pemulihan *stale sending claim* pada siklus worker broadcast untuk mencegah antrean macet permanen.

### Fase 2 — Penyempurnaan Funnel & Pengalaman Pengguna (UX & Edge Cases)
5. **Perbaikan BUG-05:** Tambahkan toleransi waktu (*latency buffer*) sebesar 2.000 ms pada verifikasi timer anti-bot.
6. **Perbaikan BUG-06:** Sesuaikan pengalihan unsubscribe agar menghormati bahasa kontak (`locale: "en"`).
7. **Perbaikan BUG-07:** Alihkan browser ke session token pada halaman `/akses/[token]` agar pengguna tidak kehilangan akses saat me-refresh halaman.
8. **Perbaikan BUG-14:** Perbaiki pesan UI pada halaman `/cek-email` jika terjadi kesalahan pengiriman.

### Fase 3 — Skalabilitas, SEO, & Pembersihan Teknis
9. **Perbaikan BUG-08:** Terapkan batch insert pada `snapshotRecipients`.
10. **Perbaikan BUG-09:** Tambahkan route `/sitemap.xml` dan berkas `public/robots.txt`.
11. **Perbaikan BUG-10:** Optimalkan `countAudience` menggunakan query SQL `COUNT(*)`.
12. **Perbaikan BUG-11:** Berikan mock URL pada `presignDownloadUrl` jika `MOCK_R2="true"`.
13. **Perbaikan BUG-12:** Tambahkan `redirectConfirmed` pada type payload form admin campaign.
14. **Perbaikan BUG-13 & BUG-15:** Tambahkan retensi tabel `rate_limit` dan readiness check sebelum kampanye diterbitkan.

---

## Status Implementasi & Verifikasi Akhir

Seluruh 16 temuan telah **SELESAI DIPERBAIKI (100% RESOLVED)** dan diverifikasi melalui pengujian komprehensif:

| ID | Status | Komponen yang Diperbarui | Verifikasi |
| :--- | :--- | :--- | :--- |
| **BUG-01** | ✅ Selesai | `src/pages/admin/api/campaigns/[id].ts` | Hero image tidak lagi terhapus saat save tanpa gambar baru |
| **BUG-02** | ✅ Selesai | `src/lib/mailworker.ts` | `test/outbox.test.ts` (atomic tx + processing lock) |
| **BUG-03** | ✅ Selesai | `src/lib/broadcast/machine.ts`, `laporan.astro` | `test/broadcast/machine.test.ts` (pause dari queued & sending) |
| **BUG-04** | ✅ Selesai | `src/lib/broadcast/worker.ts` | `test/broadcast/worker.test.ts` (auto-recover stale sending >5m) |
| **BUG-05** | ✅ Selesai | `src/lib/timer.ts` | `test/timer.test.ts` (latency tolerance buffer 2.000ms) |
| **BUG-06** | ✅ Selesai | `src/pages/api/unsubscribe/[token].ts` | `test/rate-limits-t6.test.ts` (redirect ke `/en/batal-berlangganan/...`) |
| **BUG-07** | ✅ Selesai | `src/pages/akses/[token].astro`, `en/akses/[token].astro` | Redirect 303 ke `/akses/[sessionToken]` mencegah token hangus saat refresh |
| **BUG-08** | ✅ Selesai | `src/lib/broadcast/snapshot.ts` | `test/broadcast/snapshot.test.ts` (batch insert chunk 200) |
| **BUG-09** | ✅ Selesai | `src/pages/sitemap.xml.ts`, `public/robots.txt` | `test/sitemap.test.ts` + Playwright launch test |
| **BUG-10** | ✅ Selesai | `src/lib/broadcast/audience.ts` | `test/broadcast/audience.test.ts` (`SELECT count(*)::int`) |
| **BUG-11** | ✅ Selesai | `src/lib/storage.ts` | `test/storage.test.ts` (mock URL saat `MOCK_R2="true"`) |
| **BUG-12** | ✅ Selesai | `src/lib/admin/campaign-form.ts` | `astro check` (0 errors) |
| **BUG-13** | ✅ Selesai | `src/lib/ratelimit.ts`, `src/pages/api/cron/outbox.ts` | `test/ratelimit.test.ts` (`pruneRateLimits` berkala) |
| **BUG-14** | ✅ Selesai | `src/lib/i18n.ts`, `cek-email.astro`, `en/cek-email.astro` | Menampilkan pesan kegagalan + tombol coba lagi saat `?e=` ada |
| **BUG-15** | ✅ Selesai | `src/lib/admin/campaigns.ts`, `status.ts`, `[id].astro` | `test/admin/campaigns.test.ts` (`checkPublishReadiness`) |
| **BUG-16** | ✅ Selesai | Dokumentasi & CLI execution mode | Playwright foreground mode (`$env:ASTRO_DEV_BACKGROUND="false"`) |

### Hasil Uji Otomatis
- **Astro Check:** 204 files, 0 errors, 0 warnings.
- **Vitest Unit & Integration:** 53 test suites, 365 tests passed (100%).
- **Playwright E2E:** 6 spec files, 11 tests passed (100%).

