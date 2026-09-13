# PRD v2 — KelasWFA Newsletter & Reward Campaigns

**Status:** Siap untuk desain dan implementasi MVP  
**Produk:** KelasWFA Newsletter  
**Domain publik:** `https://kado.kelaswfa.my.id`  
**Versi:** 2.0  
**Tanggal:** 13 September 2026

## 1. Ringkasan

KelasWFA Newsletter adalah web app internal untuk mengubah penonton YouTube KelasWFA menjadi kontak newsletter yang terkonfirmasi. Pengunjung membuka halaman hadiah (*reward campaign*), meluangkan 30 detik untuk membaca doa atau harapan baik, memasukkan email, lalu menerima tautan aman ke hadiah digital.

Email wajib untuk claim reward. Copy pada form menyatakan secara eksplisit bahwa claim reward juga mendaftarkan pengunjung ke newsletter KelasWFA. Konfirmasi email pertama berfungsi sebagai double opt-in dan pembuka akses reward. Jika email yang sama sudah pernah terkonfirmasi, pengunjung tidak didaftarkan ulang: sistem membuat riwayat claim reward baru dan langsung mengirim email akses reward yang aman.

Produk memiliki dua jenis campaign yang berbeda:

- **Reward campaign**: landing page publik untuk satu hadiah, doa, file, dan atribusi sumber subscriber.
- **Email campaign**: broadcast satu kali ke subscriber terkonfirmasi dengan segmentasi, jadwal, batas kirim, dan pelaporan delivery.

Ini bukan SaaS. Aplikasi single-tenant dengan satu akun admin, dibangun untuk operasional KelasWFA.

## 2. Keputusan Produk yang Sudah Dikunci

| Area | Keputusan |
|---|---|
| Domain aplikasi | `kado.kelaswfa.my.id` |
| Pengirim email | `KelasWFA <admin@kelaswfa.my.id>` |
| Reply-to | `admin@kelaswfa.my.id`, mailbox harus dipantau |
| Login admin dan OTP | `kelaswfa@gmail.com` |
| Identitas kontak | Satu email normalisasi = satu kontak global |
| Claim kedua dan seterusnya | Tidak ada double opt-in ulang; kirim email akses reward baru |
| Newsletter | Claim reward sekaligus mendaftarkan ke newsletter, dengan copy yang jelas di form |
| Unsubscribe | Menghentikan broadcast marketing; email transaksional reward tetap boleh dikirim |
| Reward file | Admin mengunggah file ke object storage aplikasi, bukan menempel URL file publik |
| Proteksi file | Tautan akses dari email berlaku 7 hari; signed download URL berlaku 1 jam |
| Bahasa | ID dan EN diisi admin secara manual; fallback ke ID; AI translation pasca-MVP |
| Doa | Satu preset Doa Muslim dan satu preset Harapan Baik per reward campaign |
| Broadcast | Satu kali saja: kirim sekarang atau terjadwal; tanpa drip/automation pada MVP |
| Audience broadcast | Filter global subscriber, locale, dan reward campaign dengan mode ANY/ALL |
| Snapshot audience | Dibekukan saat campaign dikirim atau dijadwalkan |
| Broadcast concurrency | Hanya satu email campaign boleh berstatus `sending` dalam satu waktu |
| Sending limit | Admin menentukan limit per menit dan per jam untuk setiap email campaign; sistem memvalidasi terhadap kapasitas provider |
| Prioritas email | Email transaksional tidak menunggu antrean broadcast dan selalu memiliki prioritas lebih tinggi |
| Email analytics | Sent, delivered, failed, bounced, unsubscribed, dan link click; tidak ada open tracking pixel |
| Admin | Satu akun, password + email OTP, perangkat tepercaya 30 hari |

## 3. Masalah yang Diselesaikan

KelasWFA memiliki trafik YouTube tetapi belum memiliki jalur komunikasi langsung yang dimiliki sendiri. Reward gratis berpotensi menjadi alasan alami bagi penonton untuk meninggalkan kontak, tetapi distribusinya perlu cepat, inklusif, aman, dan dapat dikelola tanpa developer.

Produk ini menyelesaikan lima masalah utama:

1. Mengubah trafik YouTube menjadi kontak newsletter yang terkonfirmasi.
2. Mengelola banyak reward tanpa membuat landing page baru lewat kode.
3. Menjaga satu profil kontak global sambil mempertahankan atribusi reward campaign secara utuh.
4. Mengirim broadcast newsletter secara terkendali tanpa mengganggu email akses reward.
5. Melindungi file reward dari URL permanen yang dapat dibagikan bebas.

## 4. Tujuan dan Metrik Keberhasilan

### 4.1 Tujuan 90 hari setelah launch

| Tujuan | Target |
|---|---:|
| Kontak newsletter terkonfirmasi | >= 1.000 kontak |
| Visit ke `email_submitted` | >= 35% dari unique landing-page view |
| Submit ke `email_confirmed` untuk kontak baru | >= 70% |
| Hard bounce | < 2% dari email yang diterima provider untuk dikirim |
| LCP p75 mobile | < 2,0 detik |
| Lighthouse performance landing page | >= 95 |
| Pembuatan reward campaign oleh admin | < 10 menit tanpa developer |

### 4.2 Definisi funnel dan event

Metrik harus menggunakan definisi berikut agar tidak ada angka conversion yang saling bertentangan.

```text
unique_page_view
  → timer_eligible
  → email_submitted
  → confirmation_sent
  → email_confirmed             (hanya kontak baru)
  → reward_access_opened
  → signed_download_issued
```

Untuk kontak yang sudah terkonfirmasi, langkah `email_confirmed` tidak berulang. Alurnya adalah:

```text
unique_page_view → timer_eligible → email_submitted
  → reward_access_sent → reward_access_opened → signed_download_issued
```

Rumus utama:

- **Visit → submit rate** = `email_submitted / unique_page_view`.
- **Submit → confirm rate** = `email_confirmed / confirmation_sent` untuk kontak baru.
- **Reward access rate** = `reward_access_opened / email sent` per tipe email.
- **Timer completion rate** = `timer_eligible / unique_page_view`.
- **North Star Metric** = jumlah kontak dengan marketing subscription aktif yang terkonfirmasi per bulan.

Event analytics tidak boleh menyertakan alamat email atau data pribadi lain.

## 5. Pengguna dan Prinsip Produk

### 5.1 Visitor funnel

Penonton KelasWFA—terutama pengguna mobile dari YouTube app—datang untuk mengklaim hadiah gratis. Mereka harus memahami nilai reward, konsep doa/harapan baik, dan langkah claim dalam beberapa detik.

### 5.2 Admin KelasWFA

Satu pemilik operasional yang mengelola reward, subscriber, dan newsletter. Admin tidak perlu mengubah kode, DNS, atau database untuk aktivitas rutin.

### 5.3 Prinsip

1. **Jujur terhadap pertukaran nilai.** Form menyatakan bahwa claim reward juga mendaftarkan visitor ke newsletter.
2. **Inklusif tanpa mengaburkan identitas.** Visitor dapat memilih Doa Muslim atau Harapan Baik; keduanya setara secara visual dan mudah ditemukan.
3. **Timer adalah pengalaman, bukan bukti.** Server memvalidasi jeda 30 detik, tetapi produk tidak mengklaim dapat membuktikan pengunjung benar-benar membaca.
4. **Satu orang, satu kontak.** Email yang sama tidak menciptakan subscriber duplikat.
5. **Reward boleh mudah diklaim, bukan mudah dicuri.** File dilayani lewat URL sementara yang hanya diterbitkan setelah akses terautentikasi oleh email.
6. **Transactional first.** Email konfirmasi dan reward tidak boleh tertunda oleh broadcast.

## 6. Ruang Lingkup MVP

### Termasuk

- Landing page reward dinamis, mobile-first, dan bilingual ID/EN.
- Doa Muslim dan Harapan Baik dari preset terkurasi.
- Timer 30 detik dengan validasi server, honeypot, dan rate limit submit.
- Global contact, double opt-in pertama, newsletter subscription, unsubscribe, dan riwayat claim reward.
- Unggah dan penyimpanan reward hingga 100 MB per file, serta signed download URL satu jam.
- Dashboard satu admin: reward campaign, kontak, file, preset selection, export CSV, dan statistik funnel dasar.
- Email campaign satu kali: draft, test send, schedule, recipient snapshot, segmentasi, limit per campaign, pause/resume/cancel, dan delivery reporting.
- Email delivery melalui Emailit API; mailbox reply-to dapat di-host pada MXroute.
- Auth admin dengan password dan OTP email, device trust 30 hari, audit log penting.
- SEO dasar, accessibility, observability, backup, dan hardening launch.

### Tidak termasuk

- SaaS, multi-tenant, multi-admin, role/permission terpisah, atau undangan admin.
- Automation email sequence, recurring campaign, drip campaign, dan A/B test.
- Open tracking pixel.
- Editor drag-and-drop atau WYSIWYG kompleks.
- Terjemahan otomatis AI; masuk roadmap pasca-MVP.
- Payment, e-commerce, aplikasi native, atau hosting video.

## 7. Kebutuhan Fungsional

### 7.1 Reward campaign publik

**URL dan bahasa**

- Bahasa Indonesia: `https://kado.kelaswfa.my.id/r/<slug>`.
- Bahasa Inggris: `https://kado.kelaswfa.my.id/en/r/<slug>`.
- Bahasa default adalah Indonesia. Toggle bahasa selalu terlihat; locale URL dipertahankan pada form dan email berikutnya.
- Judul, deskripsi, item reward, meta title, meta description, dan copy email tersedia dalam ID/EN. Jika EN kosong, aplikasi memakai konten ID sebagai fallback yang eksplisit di admin preview.

**Konten landing page**

- Menampilkan featured image, judul, deskripsi, daftar item reward, serta tab Doa Muslim dan Harapan Baik.
- Setiap campaign harus memiliki tepat satu template untuk masing-masing tab.
- Nama tab, teks doa, serta terjemahannya hanya berasal dari preset terkurasi. Admin memilih preset, bukan mengedit teks bebas.
- Form email memiliki label yang jelas, copy newsletter, privacy notice, dan link kebijakan privasi.

**Timer dan submit**

1. Saat halaman dibuka, server menerbitkan token timer bertanda tangan yang memuat `campaign_id`, nonce, dan waktu terbit.
2. Timer 30 detik berjalan pada client. Tombol submit nonaktif sampai waktu habis.
3. Endpoint subscribe menolak token yang tidak valid, salah campaign, kadaluarsa, atau usia kurang dari 30 detik.
4. Honeypot, rate limit IP, rate limit email, normalisasi email, dan validasi allowlist domain berjalan di server.
5. Jika JavaScript gagal, form tetap dapat dioperasikan setelah menunggu; server tetap menjadi sumber kebenaran untuk 30 detik.

Token timer mencegah bypass instan, bukan bot yang rela menunggu 30 detik. Perlindungan spam lain tetap wajib.

**Aturan domain email**

- Hanya domain pada allowlist aktif yang dapat submit.
- Default allowlist: `gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `live.com`, `yahoo.com`, `icloud.com`, `me.com`, dan `proton.me`.
- Admin dapat menambah, menghapus, atau menonaktifkan domain dari dashboard; perubahan dicatat pada audit log.
- Pesan penolakan tidak membocorkan detail keamanan, tetapi menjelaskan bahwa domain email belum didukung.

**Alur kontak baru**

1. Visitor memenuhi timer dan memasukkan email valid.
2. Sistem membuat atau memperbarui global contact dengan status belum terkonfirmasi, lalu membuat `reward_claim` untuk campaign tersebut.
3. Sistem mengirim email konfirmasi newsletter dan akses reward.
4. Visitor membuka tautan opaque satu kali yang berlaku tujuh hari.
5. Server mengonfirmasi email dan mengaktifkan marketing subscription; halaman akses reward muncul.
6. Sistem menerbitkan signed download URL berdurasi satu jam untuk file reward yang relevan.

**Alur kontak yang sudah terkonfirmasi**

1. Visitor memasukkan email yang sudah dikenal setelah menyelesaikan timer.
2. Sistem membuat atau memperbarui `reward_claim` untuk reward campaign baru tanpa membuat subscriber kedua.
3. Sistem mengirim email akses reward baru dan menampilkan halaman generik “Cek email”.
4. Tautan akses berumur tujuh hari membuka halaman reward, lalu menghasilkan signed download URL satu jam.

Respons submit selalu generik agar tidak mengungkap apakah sebuah email sudah ada di database.

**Claim ulang setelah unsubscribe**

Jika contact sudah unsubscribe lalu claim reward baru, halaman form harus menampilkan persetujuan re-subscribe yang sangat jelas. Status marketing hanya aktif kembali setelah contact menyelesaikan konfirmasi email untuk persetujuan baru tersebut. Tanpa persetujuan itu, sistem hanya mengirim email transaksional akses reward.

**Siklus hidup reward campaign**

- `draft`: hanya dapat dipreview admin.
- `published`: dapat diklaim publik dan muncul pada URL publik.
- `paused`: claim baru ditolak dengan halaman ramah; akses reward untuk claim lama yang masih valid tetap berfungsi.
- `archived`: tidak dapat diklaim baru, tidak muncul pada daftar operasional default, dan riwayat tetap tersimpan.

### 7.2 Reward asset dan proteksi file

- Admin dapat mengunggah PDF, ZIP, DOCX, XLSX, PPTX, PNG, JPG/JPEG, dan WebP hingga 100 MB per file.
- File disimpan privat pada object storage S3-compatible; object key tidak pernah diekspos sebagai URL tetap.
- Sebuah reward campaign memiliki satu atau lebih reward asset dengan nama, deskripsi ID/EN, urutan, ukuran, tipe MIME, checksum, dan object key.
- Tautan dalam email adalah token akses opaque, disimpan di database hanya sebagai hash, berlaku tujuh hari, dan sekali pakai untuk membuat sesi akses singkat.
- Dari sesi akses, server menerbitkan signed download URL per asset yang hanya berlaku satu jam.
- Ketika token atau URL kadaluarsa, visitor dapat meminta akses baru dari landing page dengan email yang sama; URL lama tidak diperpanjang.
- Admin dapat mengganti asset pada campaign. Asset lama tidak dihapus otomatis apabila masih dibutuhkan audit atau claim aktif; penghapusan memerlukan konfirmasi eksplisit.

### 7.3 Dashboard admin

**Authentication**

- Hanya `kelaswfa@gmail.com` dapat menjadi admin MVP.
- Login memakai password kuat yang disimpan sebagai hash Argon2id, diikuti OTP enam digit yang dikirim ke email Gmail admin.
- OTP kedaluwarsa dalam 10 menit, disimpan sebagai hash, dan dibatasi percobaannya.
- Browser dapat diberi status trusted device selama 30 hari dengan cookie httpOnly, Secure, SameSite, dan token yang dapat dicabut.
- Login dari perangkat baru selalu membutuhkan OTP. Reset password hanya dikirim ke alamat Gmail admin.
- Perubahan keamanan, login gagal, publish reward campaign, perubahan allowlist, dan aksi broadcast dicatat pada audit log.

**Reward campaign CMS**

Admin dapat membuat, mengedit, preview, publish, pause, archive, dan menduplikasi reward campaign. Field minimum:

- slug, status, featured image, dan urutan;
- judul/deskripsi ID dan EN;
- metadata SEO ID dan EN;
- daftar reward asset ID dan EN;
- preset Doa Muslim dan Harapan Baik;
- preview URL sebelum publish.

Slug harus unik, URL-safe, dan tidak bisa diubah secara diam-diam setelah publish. Jika perlu diubah, sistem meminta konfirmasi dan dapat membuat redirect historis.

**Kontak dan subscriber**

Admin dapat melihat satu profil global per contact: email, locale terakhir, status konfirmasi, status marketing subscription, campaign attribution, riwayat claim, delivery status, dan unsubscribe. Export CSV harus dapat difilter tanpa mengekspor token, IP hash, atau rahasia internal.

### 7.4 Email campaign (broadcast)

**Pembuatan dan konten**

- Email campaign adalah broadcast satu kali, bukan automation.
- Admin membuat subject, preheader, dan rich-text body sederhana untuk ID dan EN.
- Editor menyediakan template branded, variable aman yang terbatas, preview desktop/mobile, serta preview per bahasa.
- Terjemahan konten diisi manual dalam MVP; status missing translation terlihat sebelum campaign dapat dijadwalkan.
- Test send hanya dapat dikirim ke alamat admin yang diizinkan dan tidak masuk statistik audience campaign.

**Segmentasi**

Penerima selalu dikecualikan bila belum confirmed, marketing subscription tidak aktif, berada dalam suppression list, atau sudah unsubscribe. Filter yang tersedia:

- semua subscriber terkonfirmasi;
- locale ID, EN, atau seluruh locale;
- claim satu atau beberapa reward campaign;
- mode claim `ANY` (setidaknya satu campaign) atau `ALL` (seluruh campaign yang dipilih).

Campaign dengan konten bilingual mengirim versi sesuai locale contact. Contact tanpa locale yang dikenali menerima versi Indonesia.

**Snapshot dan status**

Pada tindakan `send now` atau `schedule`, sistem menghitung audience, menampilkan jumlahnya, dan membekukan recipient snapshot. Subscriber yang masuk setelah itu tidak ditambahkan otomatis.

Status campaign:

```text
draft → scheduled → queued → sending → completed
                         ↘ paused ↗
                         ↘ cancelled
                         ↘ failed
```

- Hanya satu campaign dapat berada pada `sending`.
- Campaign lain tetap `scheduled` atau `queued` sampai slot tersedia.
- Admin dapat pause, resume, atau cancel. Cancel tidak membatalkan email yang sudah diterima provider.
- Sebelum kirim, admin melihat summary audience, limit, subject, bahasa, dan harus mengonfirmasi tindakan eksplisit.

**Limit dan antrean**

- Admin menentukan `max_per_minute` dan `max_per_hour` untuk setiap campaign.
- Nilai tersebut harus positif dan dibatasi oleh konfigurasi kapasitas provider yang tersimpan di server.
- Worker broadcast mengirim berdasarkan limit campaign, menyimpan status setiap recipient, dan dapat melanjutkan proses setelah deploy atau kegagalan worker.
- Email transaksional memakai priority queue terpisah. Jika kapasitas provider bersaing, worker broadcast mengalah dan memprioritaskan email konfirmasi, akses reward, OTP, serta reset password.
- Untuk Emailit, konfigurasi awal perlu mempertimbangkan batas workspace 2 pesan/detik dan 5.000 pesan/hari; angka provider harus dapat diubah melalui konfigurasi tanpa perubahan kode. [Emailit API rate limits](https://emailit.com/docs/api-reference/)

**Unsubscribe dan click tracking**

- Setiap broadcast memiliki link unsubscribe satu klik yang terautentikasi oleh token opaque.
- Unsubscribe segera menghentikan pengiriman broadcast mendatang dan menandai contact pada suppression list lokal.
- Broadcast tidak memakai open tracking pixel.
- Link click boleh dilacak melalui redirect aman milik aplikasi. URL tujuan tervalidasi ketika campaign dipublish untuk mencegah open redirect.

### 7.5 Email dan delivery provider

**Provider utama: Emailit**

Emailit dipakai melalui REST API sebagai jalur utama karena menyediakan SMTP/API, event delivery, webhook, suppression, dan dukungan email transaksional maupun marketing. SMTP adapter dapat dipertahankan sebagai fallback teknis, tetapi bukan sumber kebenaran delivery status. [Emailit](https://emailit.com/) mendokumentasikan REST API, SMTP, API key, serta webhook-nya di [dokumentasi resminya](https://emailit.com/docs/api-reference/).

**Mailbox balasan: MXroute (opsional)**

MXroute dapat digunakan untuk meng-host mailbox `admin@kelaswfa.my.id`, menerima balasan, dan mengelola inbox. Ia tidak menjadi engine broadcast aplikasi. MXroute menawarkan email hosting dengan SMTP/IMAP/POP3 dan menyatakan limit 400 email/jam per akun pada paketnya. [MXroute](https://mxroute.com/)

**Konfigurasi domain**

- From: `KelasWFA <admin@kelaswfa.my.id>`.
- Reply-to: `admin@kelaswfa.my.id`.
- Return-path/bounce address dikelola provider delivery dan dipisahkan dari inbox balasan.
- SPF, DKIM, dan DMARC wajib dikonfigurasi dan diverifikasi sebelum production send diaktifkan.
- Secret API, SMTP credential, dan webhook secret disimpan sebagai environment secret, tidak pernah di browser atau database biasa.

**Tipe email**

| Tipe | Jalur | Tujuan |
|---|---|---|
| Konfirmasi awal | Transaksional prioritas | Mengonfirmasi email dan mengaktifkan newsletter |
| Akses reward | Transaksional prioritas | Mengirim link aman untuk claim baru/ulang |
| OTP admin | Transaksional prioritas | Verifikasi login admin |
| Reset password | Transaksional prioritas | Recovery akun admin |
| Broadcast | Campaign queue | Newsletter satu kali sesuai segment |

Webhook Emailit harus diverifikasi signature-nya, diproses idempoten, dan dipetakan ke status `accepted`, `delivered`, `bounced`, `failed`, atau `suppressed`. Event provider mentah disimpan untuk audit tanpa mengekspos secret.

## 8. Model Data

### 8.1 Prinsip data

Alamat email bukan milik landing page; ia milik `CONTACT`. Hubungan contact dengan reward disimpan di `REWARD_CLAIM`, dan status newsletter di `MARKETING_SUBSCRIPTION`. Dengan demikian satu contact dapat memiliki banyak reward claim tanpa tercipta duplikasi email.

### 8.2 Entitas utama

```mermaid
erDiagram
    ADMIN_USER ||--o{ AUTH_OTP_CHALLENGE : requests
    ADMIN_USER ||--o{ TRUSTED_DEVICE : owns
    ADMIN_USER ||--o{ ADMIN_AUDIT_LOG : performs
    REWARD_CAMPAIGN ||--o{ REWARD_CAMPAIGN_LOCALE : translates
    REWARD_CAMPAIGN ||--o{ REWARD_ASSET : contains
    REWARD_CAMPAIGN ||--o{ REWARD_CLAIM : attributes
    REWARD_CAMPAIGN ||--o{ DOA_SELECTION : uses
    DOA_TEMPLATE ||--o{ DOA_SELECTION : selected_by
    CONTACT ||--o{ REWARD_CLAIM : makes
    CONTACT ||--|| MARKETING_SUBSCRIPTION : has
    CONTACT ||--o{ CONSENT_EVENT : records
    REWARD_CLAIM ||--o{ ACCESS_TOKEN : authorizes
    EMAIL_CAMPAIGN ||--o{ EMAIL_CAMPAIGN_RECIPIENT : snapshots
    CONTACT ||--o{ EMAIL_CAMPAIGN_RECIPIENT : receives
    EMAIL_CAMPAIGN_RECIPIENT ||--o{ EMAIL_DELIVERY : produces
    CONTACT ||--o{ EMAIL_DELIVERY : receives

    ADMIN_USER {
        uuid id PK
        varchar email UK
        varchar password_hash
        timestamp created_at
        timestamp last_login_at
    }
    CONTACT {
        uuid id PK
        varchar email_normalized UK
        varchar locale
        varchar confirmation_status
        timestamp confirmed_at
        timestamp created_at
    }
    MARKETING_SUBSCRIPTION {
        uuid contact_id PK_FK
        varchar status
        timestamp subscribed_at
        timestamp unsubscribed_at
        varchar source
    }
    REWARD_CAMPAIGN {
        uuid id PK
        varchar slug UK
        varchar status
        varchar featured_image_key
        timestamp published_at
    }
    REWARD_CLAIM {
        uuid id PK
        uuid contact_id FK
        uuid reward_campaign_id FK
        varchar status
        timestamp first_claimed_at
        timestamp last_access_sent_at
    }
    REWARD_ASSET {
        uuid id PK
        uuid reward_campaign_id FK
        varchar storage_key
        varchar mime_type
        bigint size_bytes
        varchar checksum
    }
    ACCESS_TOKEN {
        uuid id PK
        uuid reward_claim_id FK
        varchar type
        varchar token_hash
        timestamp expires_at
        timestamp used_at
    }
    EMAIL_CAMPAIGN {
        uuid id PK
        varchar status
        jsonb audience_filter
        integer max_per_minute
        integer max_per_hour
        timestamp scheduled_at
        timestamp snapshot_at
    }
    EMAIL_CAMPAIGN_RECIPIENT {
        uuid id PK
        uuid email_campaign_id FK
        uuid contact_id FK
        varchar locale_selected
        varchar status
    }
    EMAIL_DELIVERY {
        uuid id PK
        uuid contact_id FK
        uuid campaign_recipient_id FK
        varchar provider_message_id
        varchar email_type
        varchar status
        timestamp sent_at
        timestamp delivered_at
        timestamp bounced_at
    }
```

### 8.3 Constraint penting

- `CONTACT.email_normalized` unik secara global. Normalisasi mencakup trim, lowercase domain, dan validasi sintaks; tidak mengubah alamat secara agresif di luar aturan yang aman.
- `REWARD_CLAIM` memiliki unique constraint `(contact_id, reward_campaign_id)`; claim ulang memperbarui riwayat dan membuat token baru, bukan baris duplikat.
- `MARKETING_SUBSCRIPTION` memiliki tepat satu status aktif per contact; `CONSENT_EVENT` menyimpan sejarah subscribe/unsubscribe/re-subscribe.
- `DOA_SELECTION` memiliki unique constraint `(reward_campaign_id, variant)`, dengan `variant` bernilai `muslim` atau `universal`.
- `EMAIL_CAMPAIGN_RECIPIENT` adalah snapshot yang tidak berubah setelah campaign dijadwalkan.
- Semua token rahasia disimpan sebagai hash SHA-256 atau hash yang sesuai; token mentah hanya muncul sekali pada URL email.
- `EMAIL_DELIVERY.provider_message_id` unik jika disediakan provider untuk mencegah pemrosesan webhook ganda.

## 9. Arsitektur Teknis

| Lapisan | Pilihan MVP | Catatan |
|---|---|---|
| Web | Astro SSR/hybrid dengan island minimal | Landing page cepat; interaksi hanya timer, tab, form |
| Runtime/API | Astro server endpoints pada Node runtime | Subscribe, token, admin API, webhook, signed URL |
| Database | Neon PostgreSQL | Source of truth untuk contact, claim, campaign, queue, dan audit |
| ORM | Drizzle ORM | Migrasi dan query type-safe |
| Object storage | S3-compatible private bucket, direkomendasikan Cloudflare R2 | Mendukung upload privat dan signed URL satu jam |
| Email delivery | Emailit REST API | Webhook delivery dan suppression; SMTP fallback opsional |
| Mailbox reply-to | MXroute opsional | Untuk inbox `admin@kelaswfa.my.id` |
| Hosting | Vercel atau platform Node serverless setara | Harus mendukung worker/cron dan inbound webhook HTTPS |
| Queue | Tabel outbox/queue di Postgres + worker/cron idempoten | Priority lane untuk transactional dan broadcast |
| Analytics | Plausible atau Vercel Analytics + event server-side | Tanpa email/PII pada analytics publik |

Landing page SSR/hybrid boleh di-cache dengan hati-hati. Endpoint yang menerbitkan token timer, menerima email, mengonfirmasi token, menerbitkan signed URL, atau menerima webhook tidak boleh di-cache publik.

## 10. Keamanan, Privasi, dan Reliability

### Keamanan

- Semua koneksi HTTPS; HSTS dan CSP ketat pada aplikasi publik maupun admin.
- Password menggunakan Argon2id; tidak ada password plaintext, password recovery manual via database, atau OTP yang tersimpan mentah.
- Session admin memakai cookie httpOnly, Secure, SameSite, rotasi session saat login, dan invalidasi trusted device saat password berubah.
- Endpoint login, OTP, submit email, resend access, signed-download, dan webhook memiliki rate limit serta validasi input.
- Token akses menggunakan random CSPRNG minimal 256 bit, sekali pakai, hashed at rest, scope-terikat ke claim, dan kedaluwarsa.
- Webhook Emailit diverifikasi signature-nya dan dicatat idempoten.
- URL redirect campaign divalidasi terhadap allowlist/protokol HTTPS untuk mencegah open redirect.
- Upload file memvalidasi MIME, ekstensi, ukuran, checksum, serta dipindai malware bila layanan storage/scan tersedia.

### Privasi dan pengelolaan data

- Landing page menyediakan privacy notice dan halaman kebijakan privasi sebelum form disubmit.
- Contact dapat unsubscribe satu klik dari email broadcast tanpa login.
- Permintaan penghapusan contact ditangani dari dashboard: profil dan riwayat yang tidak wajib dianonimkan; hash suppression minimal dapat dipertahankan untuk mencegah pengiriman ulang yang tidak diinginkan.
- IP hanya disimpan sebagai hash untuk anti-abuse, dengan retensi terbatas dan tidak diekspor ke CSV.
- CSV export hanya berisi field yang diperlukan secara operasional dan setiap export tercatat pada audit log.

### Reliability dan observability

- Outbox email ditulis ke database sebelum pengiriman provider. Retry memakai exponential backoff dan idempotency key per delivery.
- Gagal kirim tidak menghapus contact/claim. Admin dapat melihat error dan resend sesuai throttle.
- Backup Neon PITR aktif sebelum produksi; object storage memakai versioning atau prosedur backup yang dapat diuji.
- Alert untuk webhook gagal, peningkatan hard bounce, antrean tertahan, delivery failure, dan job broadcast yang tidak maju.
- Target uptime MVP: 99,5%.

## 11. Aksesibilitas, Performa, dan SEO

### Aksesibilitas

Target: WCAG 2.1 Level AA.

- Doa dan teks reward memiliki kontras minimal 4.5:1, font minimal 16px, serta line-height nyaman.
- Tab memakai pola ARIA `tablist`, navigasi keyboard, dan state `aria-selected`.
- Countdown diumumkan dengan `aria-live="polite"` pada momen penting, bukan setiap detik.
- Semua form mempunyai label, pesan error terkait, fokus yang jelas, dan dapat dioperasikan keyboard.
- `lang="id"` atau `lang="en"` benar pada halaman dan konten yang relevan.
- Animasi menghormati `prefers-reduced-motion`.

### Performa

- LCP p75 mobile < 2,0 detik, INP < 200 ms, CLS < 0,1.
- JavaScript critical path landing page < 50 KB gzip jika memungkinkan.
- Featured image memakai AVIF/WebP responsif, dimension explicit, dan CDN.
- Timer/tab dibuat sebagai island kecil; tidak ada editor/admin bundle pada landing page publik.

### SEO

- Meta title, description, OG image, canonical, dan `hreflang` tersedia per locale.
- Reward campaign memiliki opsi `indexable`; default MVP adalah `noindex` bila tujuan utamanya hanya trafik YouTube. Admin dapat mengaktifkan index setelah copy SEO direview.
- Sitemap hanya memasukkan reward campaign yang published dan indexable.

## 12. Acceptance Criteria MVP

### Funnel dan contact

- [ ] Visitor tidak dapat submit sebelum token timer berumur 30 detik.
- [ ] Contact baru hanya memiliki satu baris `CONTACT` walau claim beberapa reward.
- [ ] Contact baru menerima email konfirmasi dan status marketing baru aktif setelah token berhasil dibuka.
- [ ] Contact terkonfirmasi yang claim reward baru menerima email akses tanpa double opt-in ulang.
- [ ] Email yang sama pada reward campaign sama tidak menciptakan claim duplikat.
- [ ] Unsubscribe menghentikan broadcast berikutnya tetapi tidak menghalangi email akses reward.
- [ ] Contact yang unsubscribe hanya bisa aktif lagi setelah persetujuan re-subscribe yang eksplisit dan terkonfirmasi.

### Asset dan akses

- [ ] Admin dapat mengunggah format file yang didukung hingga 100 MB.
- [ ] Object storage key dan URL permanen tidak terlihat oleh visitor.
- [ ] Token akses kedaluwarsa setelah tujuh hari dan tidak dapat digunakan dua kali.
- [ ] Download URL hanya berlaku satu jam dan ditolak setelah kedaluwarsa.
- [ ] Campaign paused/archived menolak claim baru tetapi tidak merusak akses claim lama yang masih valid.

### Broadcast

- [ ] Admin dapat membuat draft, test-send, schedule, send now, pause, resume, dan cancel.
- [ ] Recipient snapshot tidak berubah sesudah schedule/send confirmation.
- [ ] Filter locale dan reward campaign mendukung mode ANY/ALL.
- [ ] Hanya satu broadcast `sending`; campaign berikutnya berstatus queued.
- [ ] Limit per menit/jam campaign diterapkan dan tidak melampaui konfigurasi provider.
- [ ] Email konfirmasi/reward/OTP tetap diproses sebelum worker mengambil item broadcast berikutnya.
- [ ] Semua broadcast memiliki unsubscribe link; tidak ada open pixel.
- [ ] Delivery, failure, bounce, unsubscribe, dan click yang tersedia dicatat idempoten.

### Admin dan operasi

- [ ] Hanya `kelaswfa@gmail.com` dapat login; login baru wajib password + OTP email.
- [ ] Trusted device berlaku maksimal 30 hari dan dapat dicabut.
- [ ] Semua aksi admin berisiko tercatat pada audit log.
- [ ] Domain `kelaswfa.my.id` telah lulus verifikasi SPF, DKIM, dan DMARC sebelum broadcast production.
- [ ] Backup database dan prosedur restore diuji sebelum launch.

## 13. Rencana Implementasi Enam Minggu

| Minggu | Fokus | Deliverable |
|---|---|---|
| 1 | Fondasi | Astro, Neon, Drizzle, schema v2, private bucket, DNS Emailit/MXroute, desain UI, preset doa, copy ID/EN |
| 2 | Funnel publik | Reward campaign render, i18n, tab doa, timer server-side, allowlist email, contact dan claim flow |
| 3 | Email dan asset | Emailit API/webhook, double opt-in, access token, signed download satu jam, upload asset, unsubscribe |
| 4 | Admin reward | Login password + email OTP, trusted device, CMS reward campaign, preset selection, global contact view, export CSV |
| 5 | Broadcast | Rich-text campaign editor, filtering ANY/ALL, snapshot, queue prioritas, per-campaign rate limit, test/schedule/pause/resume/cancel, reporting |
| 6 | Hardening dan launch | Accessibility, CWV, security review, retry/monitoring, UAT, backup restore test, deliverability test, production launch |

Checkpoint akhir minggu 3: reward campaign end-to-end dapat menerima claim, mengirim email, dan menerbitkan download URL aman.

Checkpoint akhir minggu 5: semua fungsi operasi admin dan broadcast MVP lengkap.

## 14. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Domain email belum autentik | Spam dan confirm rate rendah | SPF/DKIM/DMARC wajib; test deliverability sebelum launch |
| Batas provider terlampaui | Broadcast berhenti atau email tertunda | Validasi limit, provider capacity config, priority queue, retry backoff |
| Email provider webhook gagal | Status delivery tidak akurat | Signature verification, idempotency, retry endpoint, alerting |
| URL reward dibagikan | File tersebar selama masa berlaku | Token email tujuh hari, signed URL satu jam, asset privat; pahami bahwa file yang sudah diunduh tetap dapat dibagikan oleh penerima |
| Kontak duplikat | List dan atribusi tidak akurat | Unique global email dan unique contact-campaign claim |
| Salah kirim broadcast | Reputasi dan unsubscribe meningkat | Draft, test send, recipient snapshot, summary, explicit final confirmation, pause/cancel |
| Campaign tumpang tindih | Subscriber menerima banyak email sekaligus | Satu broadcast aktif, queued schedule, suppression dan subscriber filter |
| Konten doa dianggap eksklusif | Kepercayaan audiens menurun | Tab Doa Muslim dan Harapan Baik setara, preset terkurasi, copy jelas |
| Akun admin diambil alih | Broadcast/PII disalahgunakan | Password hash, email OTP, trusted-device expiry, rate limit, audit log |

## 15. Roadmap Pasca-MVP

1. Terjemahan konten otomatis melalui API AI OpenAI-compatible, selalu dengan preview dan persetujuan admin sebelum publish.
2. Multi-admin serta role terbatas apabila operasi tim berkembang.
3. Automation/drip campaign dan recurring newsletter bila kebutuhan sudah tervalidasi.
4. Segmentasi lanjutan berdasarkan engagement click dan tanggal claim.
5. Experiment/A-B test pada copy landing page dan email.
6. Integrasi email marketing eksternal bila workflow internal tidak lagi memadai.

## 16. Perubahan Utama dari PRD v1

- Mengganti model subscriber per landing page menjadi global contact + reward claim attribution.
- Memisahkan reward campaign dan email campaign.
- Menambahkan upload asset privat dan signed URL; menghapus ketergantungan pada link download eksternal permanen.
- Menambahkan broadcast dengan filter, snapshot, queue, per-campaign sending limit, dan jalur prioritas transactional.
- Menetapkan Emailit sebagai delivery provider utama dan MXroute sebagai mailbox balasan opsional.
- Mengganti domain menjadi `kelaswfa.my.id` dan domain app menjadi `kado.kelaswfa.my.id`.
- Menambahkan unsubscribe, re-subscribe eksplisit, security admin email OTP, privacy controls, dan audit log.
- Menjadikan timer sebagai pengalaman terukur yang divalidasi server, bukan klaim bahwa sistem dapat membuktikan visitor membaca doa.
