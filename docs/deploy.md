# Panduan Deploy — KelasWFA Newsletter

Panduan langkah demi langkah untuk me-deploy aplikasi ke **VPS dengan Easypanel**
(direkomendasikan) atau ke **Vercel**. Ditulis untuk yang baru pertama kali
memakai keduanya — tidak ada langkah yang dilewat.

Aplikasi ini stateless: semua data ada di Postgres + R2. Jadi prinsip deploy di
mana pun sama: **(1)** siapkan database, **(2)** jalankan migrasi, **(3)** jalankan
aplikasi dengan environment variable yang benar, **(4)** jalankan cron tiap menit,
**(5)** verifikasi.

Daftar isi:
- [A. Persiapan yang sama untuk semua tujuan](#a-persiapan-yang-sama-untuk-semua-tujuan)
- [B. Deploy ke VPS dengan Easypanel](#b-deploy-ke-vps-dengan-easypanel)
- [C. Deploy ke Vercel](#c-deploy-ke-vercel)
- [D. Setelah deploy: checklist go-live](#d-setelah-deploy-checklist-go-live)
- [E. Kalau ada masalah (troubleshooting)](#e-kalau-ada-masalah-troubleshooting)

---

## A. Persiapan yang sama untuk semua tujuan

Lakukan ini sekali, dipakai untuk Easypanel maupun Vercel.

### A1. Siapkan secret acak

Jalankan di terminal (Linux/Mac/Git Bash Windows) untuk membuat 3 secret acak.
Simpan hasilnya di catatan sementara — akan dimasukkan ke Easypanel/Vercel nanti.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jalankan 3 kali sampai dapat 3 nilai berbeda, untuk:

| Secret | Dipakai untuk |
|---|---|
| `TOKEN_SECRET` | Menandatangani token timer, sesi download, dan link aman |
| `IP_HASH_SALT` | Mengacak hash IP untuk rate limit (privasi) |
| `CRON_SECRET` | Mengamankan endpoint cron supaya hanya scheduler yang bisa memanggil |

> Nilai contoh seperti `change-me` di `.env.example` TIDAK boleh dipakai di
> produksi. Kalau secret bocor, cara menggantinya ada di `docs/operations.md` §6.

### A2. Siapkan akun layanan email (Emailit)

1. Daftar di [emailit.com](https://emailit.com/) dan verifikasi domain pengirim
   `kelaswfa.my.id` mengikuti petunjuk di dashboard Emailit.
2. Buat **API key** → catat sebagai `EMAILIT_API_KEY`.
3. Buat **webhook secret** → catat sebagai `EMAILIT_WEBHOOK_SECRET`.
4. Pastikan record DNS **SPF, DKIM, DMARC** sudah terpasang (detail di
   `docs/operations.md` §2). Tanpa ini email masuk spam.

### A3. Siapkan object storage (Cloudflare R2)

1. Di dashboard Cloudflare → R2 → buat bucket, mis. `kelaswfa-rewards`.
2. Buat API token R2 → catat `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, dan nama bucket sebagai `R2_BUCKET`.
3. Di tahap awal boleh menunda ini: set `MOCK_R2=true` supaya upload dilewati.
   Tapi sebelum ada file reward asli, R2 wajib dikonfigurasi.

### A4. Daftar lengkap environment variable

Salin tabel ini sebagai contekan. Kolom "Contoh" JANGAN dipakai mentah-mentah
di produksi kecuali yang memang flag (`true`/`false`).

| Variable | Wajib | Contoh / nilai |
|---|---|---|
| `DATABASE_URL` | Ya | Diisi dari database yang dibuat di langkah B/C |
| `TOKEN_SECRET` | Ya | Acak 64 hex (A1) |
| `IP_HASH_SALT` | Ya | Acak 64 hex (A1) |
| `CRON_SECRET` | Ya | Acak 64 hex (A1) |
| `PUBLIC_SITE_URL` | Ya | `https://kado.kelaswfa.my.id` (tanpa garis miring di akhir!) |
| `ADMIN_EMAIL` | Ya | `kelaswfa@gmail.com` |
| `ADMIN_PASSWORD` | Ya (awal) | Password kuat ≥12 karakter, untuk bootstrap admin pertama |
| `R2_ACCOUNT_ID` | Ya* | ID akun Cloudflare (*bisa tunda dengan `MOCK_R2=true`) |
| `R2_ACCESS_KEY_ID` | Ya* | (*sama) |
| `R2_SECRET_ACCESS_KEY` | Ya* | (*sama) |
| `R2_BUCKET` | Ya* | `kelaswfa-rewards` (*sama) |
| `MOCK_R2` | Ya | `false` bila R2 sudah dikonfigurasi, `true` untuk menunda |
| `EMAILIT_API_KEY` | Ya | Dari dashboard Emailit |
| `EMAILIT_WEBHOOK_SECRET` | Ya | Dari dashboard Emailit |
| `MOCK_EMAILIT` | Ya | `false` di produksi (tidak ada email yang terkirim bila `true`) |
| `MO_BROADCAST` | Tidak | `true` bila mau mode hemat/uji broadcast (default `false`) |

> `ADMIN_PASSWORD` hanya dipakai sekali saat bootstrap akun admin pertama.
> Setelah login berhasil, boleh dihapus dari environment (password tersimpan
> sebagai hash Argon2id di database). Ganti password lewat halaman
> `/admin/reset` bila perlu.

---

## B. Deploy ke VPS dengan Easypanel

### B0. Yang perlu disiapkan

- VPS dengan Ubuntu 22.04/24.04, RAM minimal 2 GB (aplikasi + Postgres dalam
  satu VPS cukup untuk trafik awal).
- Easypanel sudah terinstal di VPS. Kalau belum: ikuti panduan instalasi resmi
  di [easypanel.io/docs](https://easypanel.io/docs) (satu perintah instalasi,
  lalu buka `http://<IP-VPS>:3000` dan buat akun admin).
- Domain `kado.kelaswfa.my.id` dengan akses kelola DNS.
- Repo GitHub project ini (push dulu semua commit ke GitHub).

### B1. Arahkan domain ke VPS

1. Buka pengaturan DNS domain `kelaswfa.my.id` (di registrar/DNS provider).
2. Tambah record **A**: host `kado`, value = alamat IP publik VPS, TTL 300.
3. Tunggu 5–30 menit, lalu cek dari terminal:
   ```bash
   nslookup kado.kelaswfa.my.id
   ```
   Pastikan menjawab dengan IP VPS.

### B2. Buat project di Easypanel

1. Buka panel Easypanel (`http://<IP-VPS>:3000`), login.
2. Klik **Create a Project** → beri nama mis. `kelaswfa` → **Create**.
3. Masuk ke project tersebut. Di sinilah semua service akan tinggal.

### B3. Buat database Postgres

1. Di dalam project, klik **+ Service** → pilih **Postgres** → beri nama `db`.
2. Biarkan versi default (16) → **Create**.
3. Klik service `db` → tab **Overview** → catat **Connection URL** internal
   (bentuknya seperti `postgres://postgres:<password>@db:5432/kelaswfa`).
   URL internal ini yang dipakai sebagai `DATABASE_URL` — jangan pakai URL
   publik bila ada, supaya trafik DB tidak keluar dari jaringan Docker.
4. (Opsional tapi disarankan) Di tab **Backups** service Postgres, aktifkan
   backup otomatis bila template Easypanel menyediakannya.

### B4. Deploy aplikasi dari GitHub

1. Di project yang sama, klik **+ Service** → pilih **App** → beri nama mis.
   `web`.
2. Tab **General / Source**:
   - **Source**: GitHub → hubungkan akun GitHub bila diminta → pilih repo
     `kelaswfa-newletter` → branch `main`.
   - **Build Method**: **Dockerfile** (repo ini sudah berisi `Dockerfile` +
     `.dockerignore` yang tervalidasi).
   - Biarkan Docker context `/` dan Dockerfile path `Dockerfile`.
3. Tab **Environment** → masukkan SEMUA variable dari tabel A4:
   - `DATABASE_URL` = connection URL internal dari langkah B3.
   - `PUBLIC_SITE_URL` = `https://kado.kelaswfa.my.id`.
   - `MOCK_EMAILIT=false`, `MOCK_R2=false` (atau `true` bila menunda R2).
   - Sisanya sesuai A1–A3.
4. Tab **Domains**:
   - Tambah domain → `kado.kelaswfa.my.id` → Easypanel otomatis menerbitkan
     sertifikat HTTPS (Let's Encrypt). Tunggu status **Active**.
   - Pastikan HTTPS redirect aktif (http → https).
5. Klik **Deploy**. Tunggu sampai status **Running** dan log menampilkan:
   ```
   [@astrojs/node] Server listening on ... :4321
   ```

> **Catatan port:** container menjalankan aplikasi di port `4321` (diatur lewat
> `ENV PORT=4321` di Dockerfile). Easypanel otomatis mendeteksi port ini dari
> `EXPOSE`. Kalau panel menanyakan port manual, isi `4321`.

### B5. Jalankan migrasi database (sekali saja)

Migrasi membuat semua tabel. Cara termudah: pakai fitur **Console/Terminal**
di service `web` (Easypanel menyediakan tombol terminal ke container):

1. Buka service `web` → cari tombol **Console** atau **Terminal**.
2. Jalankan:
   ```bash
   npm run db:migrate
   ```
   Tunggu sampai muncul `migrated`.
   > Perintah ini memakai `DATABASE_URL` yang sudah ada di environment service,
   > jadi tidak perlu mengetik URL manual. Script `tsx` dan folder `drizzle/`
   > sudah ikut di dalam image Docker.
3. (Sekali saja, untuk data awal) Jalankan seed contoh:
   ```bash
   npm run seed
   ```
   Ini membuat campaign contoh `starter-kit`, template doa, dan allowlist domain.
   Data contoh boleh dihapus/diedit lewat admin setelahnya.
4. (Sekali saja) Buat akun admin pertama:
   ```bash
   npm run admin:bootstrap
   ```
   Memakai `ADMIN_EMAIL` + `ADMIN_PASSWORD` dari environment. Setelah berhasil,
   login di `https://kado.kelaswfa.my.id/admin/login`.
   > Kalau `ADMIN_PASSWORD` lupa di-set sebelum deploy: tambah variable-nya di
   > tab Environment → **Redeploy/Restart** → jalankan bootstrap lagi.

### B6. Pasang cron tiap menit

Dua endpoint harus dipanggil tiap menit (pengirim outbox + worker broadcast).
Keduanya diamankan `CRON_SECRET`, jadi cron wajib mengirim header itu.

1. Di project, klik **+ Service** → pilih **Cron Job** (kalau template tidak
   ada, alternatifnya di bawah) → beri nama `cron-outbox`.
2. Isi:
   - **Schedule**: `* * * * *` (tiap menit).
   - **Command**: (sesuaikan format yang diminta panel; intinya HTTP GET
     dengan header)
     ```bash
     curl -fsS -H "x-cron-secret: $CRON_SECRET" https://kado.kelaswfa.my.id/api/cron/outbox
     ```
     dengan `CRON_SECRET` dimasukkan sebagai environment variable cron job itu.
3. Buat cron job kedua `cron-broadcast` dengan path `/api/cron/broadcast`.
4. Tunggu 2–3 menit → cek log cron job: harus respons HTTP 200.
   - **401** = `CRON_SECRET` di cron beda dengan di app → samakan.
   - **5xx** = lihat troubleshooting E3.

> **Alternatif tanpa Cron Job:** pakai layanan cron eksternal gratis
> (mis. cron-job.org) yang memanggil dua URL di atas tiap menit dengan header
> yang sama. Fungsinya identik.

### B7. Daftarkan webhook Emailit

1. Di dashboard Emailit → pengaturan webhook → URL:
   `https://kado.kelaswfa.my.id/api/webhooks/emailit`, secret =
   `EMAILIT_WEBHOOK_SECRET` yang sama.
2. Kirim satu email test → pastikan status delivery berubah di laporan
   broadcast (bukti webhook masuk).

### B8. Verifikasi akhir

Buka satu per satu, harus semua hijau:

- [ ] `https://kado.kelaswfa.my.id/api/health` → `{"status":"ok"}`.
- [ ] Halaman reward contoh: `https://kado.kelaswfa.my.id/r/starter-kit`.
- [ ] Toggle bahasa ID⇄EN berpindah halaman dengan benar.
- [ ] Submit email test → halaman "Cek email" → email konfirmasi diterima.
- [ ] Login admin → `/admin` menampilkan angka funnel → composer broadcast
      bisa test-send.
- [ ] Log kedua cron job 200 dalam 5 menit terakhir.

---

## C. Deploy ke Vercel

### C0. Yang perlu disiapkan

- Akun Vercel (gratis cukup untuk awal) + akun GitHub berisi repo ini.
- Database Postgres eksternal — Vercel tidak menyediakan Postgres sendiri.
  Pilihan termudah: **Neon** ([neon.tech](https://neon.tech), ada free tier +
  PITR untuk backup). Buat project + database `kelaswfa`, catat connection
  string-nya.
- Domain `kado.kelaswfa.my.id` (atau pakai dulu domain `*.vercel.app` gratis
  untuk staging).

### C1. Import project

1. Di dashboard Vercel → **Add New → Project** → pilih repo
   `kelaswfa-newletter` → **Import**.
2. Framework terdeteksi otomatis (**Astro**). Jangan ubah build command
   (`astro build`) dan output directory.
3. Node version: pastikan **22.x** (Project → Settings → General → Node.js
   Version). `package.json` sudah mensyaratkan `>=22.12.0`.

### C2. Isi environment variable

Project → **Settings → Environment Variables** → masukkan SEMUA variable dari
tabel A4 (pilih environment **Production**; ulangi untuk **Preview** bila mau
staging):

- `DATABASE_URL` = connection string Neon. Untuk migrasi diperlukan koneksi
  langsung (non-pooled); bila Neon memberi dua URL (pooled + direct), pakai
  yang **direct** untuk `DATABASE_URL`.
- `PUBLIC_SITE_URL` = `https://kado.kelaswfa.my.id` (atau URL
  `*.vercel.app` untuk staging).
- `MOCK_EMAILIT=false`, `MOCK_R2` sesuai kesiapan R2.
- Sisanya sesuai A1–A3.

### C3. Deploy + migrasi + bootstrap

1. Klik **Deploy** → tunggu status **Ready**.
2. **Migrasi harus dijalankan dari komputer sendiri** (Vercel tidak memberi
   terminal ke serverless):
   ```bash
   DATABASE_URL="<connection-string-neon-direct>" npm run db:migrate
   DATABASE_URL="<connection-string-neon-direct>" npm run seed
   DATABASE_URL="<connection-string-neon-direct>" npm run admin:bootstrap
   ```
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` dibaca dari `.env` lokal atau dari env
   shell — pastikan ter-set saat menjalankan bootstrap.
3. Buka `https://<project>.vercel.app/admin/login` dan login.

### C4. Cron otomatis (tanpa 설정 tambahan)

Repo ini sudah berisi `vercel.json` yang mendaftarkan kedua cron tiap menit.
Vercel akan menampilkannya di Project → Settings → Cron Jobs setelah deploy
pertama. Vercel otomatis mengirim `Authorization: Bearer $CRON_SECRET`
(app mendukungnya di `src/lib/cron-auth.ts`), jadi pastikan `CRON_SECRET`
terpasang di environment Production — tidak perlu membuat cron manual.

### C5. Pasang domain + webhook

1. Project → **Settings → Domains** → tambah `kado.kelaswfa.my.id` → ikuti
   instruksi record DNS yang diberikan Vercel (biasanya CNAME).
2. Update `PUBLIC_SITE_URL` ke domain final → **Redeploy** (env dibaca saat
   build untuk beberapa halaman).
3. Daftarkan webhook Emailit seperti langkah B7.

### C6. Verifikasi akhir

Sama seperti B8, ganti domain dengan domain Vercel, plus:

- [ ] Project → Settings → Cron Jobs: kedua cron **Enabled**, eksekusi terakhir
      sukses (200).

---

## D. Setelah deploy: checklist go-live

Lanjutan wajib ada di `docs/operations.md` §1 — ringkasnya:

1. Test-send ke Gmail, Outlook, Yahoo → cek inbox (bukan spam).
2. Uji emergency pause/cancel broadcast sekali (§5 runbook).
3. Aktifkan backup: snapshot/backup otomatis Postgres Easypanel, atau Neon
   PITR (§3 runbook).
4. Masukkan query alert §4 runbook ke pemantauan (minimal cek manual mingguan:
   antrean tertahan, hard bounce naik, webhook gagal).
5. Rotasi semua secret dari nilai contoh (§6 runbook) — untuk Easypanel:
   ubah di tab Environment → Redeploy.

## E. Kalau ada masalah (troubleshooting)

| Gejala | Kemungkinan penyebab | Perbaikan |
|---|---|---|
| `/api/health` → `{"status":"error"}` (503) | `DATABASE_URL` salah / DB belum bisa dijangkau | Cek URL, user, password; di Easypanel pakai URL internal (`@db`), bukan `localhost` |
| Halaman 500 semua | Secret belum lengkap / migrasi belum jalan | Cek log service; jalankan `db:migrate`; pastikan `TOKEN_SECRET` ter-set |
| Cron 401 | `CRON_SECRET` beda antara cron dan app | Samakan nilainya di kedua tempat |
| Cron 5xx | DB/R2/Emailit error | Baca log service `web` saat menit cron berjalan |
| Email tidak terkirim | `MOCK_EMAILIT=true` masih aktif | Set `false` + Redeploy; cek `EMAILIT_API_KEY` |
| Upload file gagal | `MOCK_R2=true` / kredensial R2 salah | Cek 4 variable `R2_*`; set `MOCK_R2=false` |
| Link di email salah domain | `PUBLIC_SITE_URL` masih localhost | Ubah ke domain final + Redeploy (Easypanel) / Redeploy (Vercel) |
| Sertifikat HTTPS belum aktif | DNS belum propagasi | Tunggu, cek `nslookup`; di Easypanel status domain harus **Active** |

---

*Catatan arsitektur: image Docker (~390 MB, `node:22-slim` multi-stage) sudah
di-smoke-test: build sukses, `GET /api/health` 200 dengan DB Postgres 16.
Cron Vercel didefinisikan di `vercel.json`; di Easypanel digantikan Cron Job
panel (B6) karena `vercel.json` hanya dibaca oleh Vercel.*
