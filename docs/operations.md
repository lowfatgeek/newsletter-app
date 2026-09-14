# Operations Runbook — KelasWFA Newsletter

Checklist dan prosedur operasional untuk launch dan pemeliharaan produksi
(PRD §10 reliability). Semua query dijalankan terhadap database produksi
(Neon) lewat SQL editor atau `psql "$DATABASE_URL_DIRECT"`.

Daftar isi:
1. [Checklist launch](#1-checklist-launch)
2. [Deliverability: SPF, DKIM, DMARC](#2-deliverability-spf-dkim-dmarc)
3. [Backup & restore drill (Neon PITR)](#3-backup--restore-drill-neon-pitr)
4. [Alert yang dipantau + SQL siap pakai](#4-alert-yang-dipantau--sql-siap-pakai)
5. [Prosedur pause/cancel darurat](#5-prosedur-pausecancel-darurat)
6. [Rotasi secret](#6-rotasi-secret)
7. [Kapasitas Emailit](#7-kapasitas-emailit)

---

## 1. Checklist launch

- [ ] Domain pengirim (`kelaswfa.my.id`) terverifikasi di Emailit; SPF/DKIM/DMARC lolos (§2).
- [ ] `PUBLIC_SITE_URL`, `ADMIN_EMAIL`, `CRON_SECRET`, `EMAILIT_WEBHOOK_SECRET`, `TOKEN_SECRET`, `IP_HASH_SALT` terpasang di Vercel Production.
- [ ] Migrasi terakhir sudah diterapkan ke database produksi (`npm run db:migrate` dengan direct URL).
- [ ] Cron `vercel.json` aktif dan kedua endpoint membalas 200 (cek log Vercel).
- [ ] Webhook Emailit menunjuk ke `https://<domain>/api/webhooks/emailit` dengan secret yang sama.
- [ ] Neon PITR aktif + restore drill pernah dijalankan (§3).
- [ ] Query alert dimasukkan ke dashboard/laporan terjadwal (§4).
- [ ] Kirim test-send ke beberapa mailbox (Gmail, Outlook, Yahoo) dan cek inbox/spam.
- [ ] Emergency pause/cancel diuji sekali di staging (§5).
- [ ] Semua secret produksi dirotasi dari nilai contoh (§6).

---

## 2. Deliverability: SPF, DKIM, DMARC

Kirim dari domain sendiri (bukan `gmail.com`). Verifikasi DNS domain pengirim
di Emailit, lalu pastikan record berikut ada.

### SPF
Satu record TXT di apex domain; Emailit menyertakan host yang harus
di-authorize:
```
kelaswfa.my.id.  TXT  "v=spf1 include:<emailit-spf-host> -all"
```
- Jangan lebih dari 10 DNS lookup dalam SPF.
- Gunakan `-all` (hard fail) setelah yakin semua pengirim terdaftar.

### DKIM
Tambahkan record TXT/CNAME yang diberikan Emailit (biasanya selector
`emailit._domainkey`):
```
emailit._domainkey.kelaswfa.my.id.  TXT  "v=DKIM1; k=rsa; p=<public-key>"
```
Cek: `dig +short TXT emailit._domainkey.kelaswfa.my.id`.

### DMARC
Mulai `p=none` dengan alamat laporan, tinjau 1–2 minggu, lalu naikkan:
```
_dmarc.kelaswfa.my.id.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@kelaswfa.my.id; fo=1"
# setelah bersih → p=quarantine → akhirnya p=reject
```

### Verifikasi
```sh
dig +short TXT kelaswfa.my.id
dig +short TXT emailit._domainkey.kelaswfa.my.id
dig +short TXT _dmarc.kelaswfa.my.id
```
Atau kirim ke `check-auth@verifier.port25.com` / mailbox Gmail lalu lihat
`Authentication-Results`. Broadcast produksi pertama HANYA setelah
SPF=pass, DKIM=pass, DMARC=pass.

---

## 3. Backup & restore drill (Neon PITR)

Neon menyimpan history WAL (Point-in-Time Restore). Aktifkan PITR pada branch
produksi (retention sesuai plan, mis. 7 hari) melalui Neon Console →
Project → Settings → Backups.

**Restore drill (lakukan minimal sekali sebelum launch, ulangi tiap kuartal):**

1. Catat waktu sekarang (`select now();`) sebagai titik referensi.
2. Neon Console → Branches → **Restore** branch produksi ke timestamp T
   baru (jangan ke produksi). Beri nama `restore-drill-YYYYMMDD`.
3. Ambil direct connection string branch hasil restore.
4. Verifikasi integritas data:
   ```sql
   select
     (select count(*) from contact)                as contacts,
     (select count(*) from email_campaigns)         as campaigns,
     (select count(*) from email_deliveries)        as deliveries,
     (select count(*) from admin_user)              as admins,
     (select max(received_at) from email_provider_events) as last_webhook;
   ```
   Bandingkan dengan produksi (toleransi: selisih hanya aktivitas setelah T).
5. Uji aplikasi singkat terhadap branch restore (opsional): set `DATABASE_URL`
   lokal ke branch restore, `npm run dev`, login admin, buka laporan.
6. Hapus branch drill agar tidak menagih storage.

**Restore sungguhan (insiden):** buat branch dari timestamp sebelum insiden →
verifikasi → arahkan `DATABASE_URL` produksi ke branch baru → redeploy. Simpan
branch lama sampai yakin.

---

## 4. Alert yang dipantau + SQL siap pakai

Jalankan tiap 5–15 menit (cron/reporting), alert bila melewati ambang.
Semua `now()` = waktu DB (UTC).

### 4a. Webhook gagal / tidak masuk

Emailit mengirim webhook ke `/api/webhooks/emailit`. Signature gagal → 401.
Sinyal utama: delivery yang sudah `sent` tetapi tak pernah mencapai status
terminal (`delivered`/`bounced`/`failed`).

```sql
-- Delivery baru-baru ini yang status masih accepted/sent (webhook belum update)
select count(*) as stale_deliveries
from email_deliveries
where email_type = 'broadcast'
  and status in ('accepted', 'sent')
  and coalesce(sent_at, created_at) < now() - interval '6 hours';
```
**Alert bila > 0.**

```sql
-- Aliran event webhook macet: tidak ada event 1 jam terakhir saat ada broadcast aktif
select count(*) as events_last_hour
from email_provider_events
where received_at > now() - interval '1 hour';
```
**Alert bila 0 padahal ada campaign `sending`/`queued`** (lihat 4d).

```sql
-- Event terakhir yang diterima (cek "frasa terakhir" aliran webhook)
select event_type, received_at
from email_provider_events
order by received_at desc
limit 10;
```

### 4b. Hard bounce rate

`email_suppressions.reason='hard_bounce'` otomatis diisi saat webhook bounce,
tetapi rate dihitung dari delivery terminal.

```sql
select
  count(*) filter (where status = 'bounced') as bounced,
  count(*) filter (where status in ('delivered', 'bounced', 'failed')) as attempted,
  round(
    100.0 * count(*) filter (where status = 'bounced')
    / nullif(count(*) filter (where status in ('delivered', 'bounced', 'failed')), 0),
    2
  ) as bounce_pct
from email_deliveries
where email_type = 'broadcast'
  and created_at > now() - interval '24 hours';
```
**Alert bila `bounce_pct` > 2%** (atau `bounced` > 20 dalam 24 jam). Tindakan:
hentikan broadcast berjalan (§5), bersihkan daftar (suppression hard bounce),
audit sumber kontak.

Suppression hard bounce terbaru:
```sql
select email_normalized, reason, created_at
from email_suppressions
where reason = 'hard_bounce'
order by created_at desc
limit 50;
```

### 4c. Antrean outbox transaksional tertahan

```sql
select
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'failed')  as failed,
  min(scheduled_at) filter (where status = 'pending') as oldest_pending
from email_outbox;
```
**Alert bila `oldest_pending` < `now() - interval '10 minutes'`** (cron outbox
tidak jalan / Emailit error) atau `failed` bertambah.

```sql
-- Pesan gagal terbaru + alasannya (untuk triage)
select id, email_type, to_email, attempts, left(last_error, 200) as last_error, created_at
from email_outbox
where status = 'failed'
order by created_at desc
limit 20;
```

### 4d. Job broadcast tidak maju (antrean tertahan)

```sql
-- Campaign macet di status non-final
select id, status, max_per_minute, max_per_hour,
       updated_at, now() - updated_at as stalled_for
from email_campaigns
where status in ('scheduled', 'queued', 'sending')
  and updated_at < now() - interval '15 minutes';
```
**Alert bila ada baris** (worker cron tidak mengeklaim / provider error).

```sql
-- Campaign dengan recipient pending menumpuk
select r.campaign_id, c.status, count(*) as pending_recipients,
       min(r.created_at) as oldest_pending
from email_campaign_recipients r
join email_campaigns c on c.id = r.campaign_id
where r.status = 'pending'
group by r.campaign_id, c.status
order by pending_recipients desc;
```

```sql
-- Kapasitas harian provider hampir habis (max EMAILIT_MAX_PER_DAY, default 5000)
select count(*) as sent_today
from email_deliveries
where email_type = 'broadcast'
  and sent_at >= date_trunc('day', now());
```
**Alert bila `sent_today` > 90% dari `EMAILIT_MAX_PER_DAY`.**

---

## 5. Prosedur pause/cancel darurat

Pause menghentikan batch berikutnya tanpa membatalkan recipient yang sudah
terkirim; cancel membatalkan sisa recipient.

### Lewat UI admin (disarankan)
1. Buka `/admin/email-campaigns/<id>/laporan`.
2. **Pause** untuk menghentikan sementara (status `sending` → `paused`);
   **Resume** untuk melanjutkan (`paused` → `queued`).
3. **Cancel** untuk membatalkan (`scheduled`/`queued`/`paused` → `cancelled`,
   recipient `pending` → `cancelled`).

### Lewat API (session admin)
```sh
curl -X POST https://<domain>/admin/api/email-campaigns/<id>/pause  -H "Cookie: <session>"
curl -X POST https://<domain>/admin/api/email-campaigns/<id>/resume -H "Cookie: <session>"
curl -X POST https://<domain>/admin/api/email-campaigns/<id>/cancel -H "Cookie: <session>"
```

### Fallback SQL (UI/API tak bisa diakses)
```sql
-- Pause campaign yang sedang sending
update email_campaigns
set status = 'paused', updated_at = now()
where id = '<campaign-id>' and status = 'sending';

-- Cancel campaign + sisa recipient
update email_campaigns
set status = 'cancelled', updated_at = now()
where id = '<campaign-id>' and status in ('scheduled', 'queued', 'paused');

update email_campaign_recipients
set status = 'cancelled'
where campaign_id = '<campaign-id>' and status = 'pending';
```

### Hentikan SEMUA pengiriman (kill switch)
Tidak ada flag global. Pilihan:
- Nonaktifkan cron di Vercel (Project → Settings → Cron Jobs → disable) atau
  ubah jadwal `vercel.json`; worker berhenti mengirim sampai cron diaktifkan.
- Pause setiap campaign `sending` dengan query di atas.
- Catatan: merotasi `CRON_SECRET` TIDAK menghentikan Vercel Cron — header
  `Authorization: Bearer <CRON_SECRET>` dihitung Vercel dari env terbaru, jadi
  cron tetap lolos. Rotasi hanya mencabut pemanggil cron eksternal.

Setelah insiden selesai, cek 4a–4d sebelum melanjutkan.

---

## 6. Rotasi secret

Aturan umum: perbarui di Vercel (dan layanan terkait) lalu redeploy. Catat
waktu rotasi. Gunakan nilai acak `openssl rand -base64 48`.

### `TOKEN_SECRET`
Menandatangani token timer funnel (HMAC). Rotasi:
1. Set `TOKEN_SECRET` baru di Vercel → redeploy.
2. Efek: token timer yang sedang beredar (form yang belum disubmit) menjadi
   invalid → user harus memuat ulang halaman reward. Sesi admin dan link
   unsubscribe/click TIDAK terpengaruh (memakai hash SHA-256, bukan HMAC).
3. Rotasi aman dilakukan saat trafik rendah.

### `CRON_SECRET`
Autentikasi endpoint cron (`Authorization: Bearer` / `x-cron-secret`).
1. Set nilai baru di Vercel → redeploy.
2. Vercel Cron otomatis memakai env terbaru, jadi cron internal tetap jalan.
   Bila ada pemanggil cron eksternal, perbarui secret-nya bersamaan.
3. Rotasi ini BUKAN kill switch — untuk menghentikan pengiriman lihat §5.

### `EMAILIT_WEBHOOK_SECRET`
HMAC signature webhook Emailit. Rotasi HARUS sinkron dengan dashboard Emailit
atau webhook akan gagal (401) dan provider melakukan retry.
1. Set nilai baru di Vercel.
2. Segera set nilai yang sama di dashboard Emailit (Webhook settings) → simpan.
3. Redeploy; pantau 4a selama 15 menit. Provider akan mengulang event yang
   gagal, jadi tidak ada data hilang.

### `IP_HASH_SALT`
Meng-hash IP untuk rate limit. Rotasi menghapus bucket rate-limit lama
(indikator: hash IP lama tak lagi cocok) — aman, lakukan saat trafik rendah.

---

## 7. Kapasitas Emailit

Batas akun Emailit yang diasumsikan aplikasi:

| Batas | Default | Env override |
| --- | --- | --- |
| Per detik | **2 email/detik** | `EMAILIT_MAX_PER_SECOND` |
| Per hari | **5.000 email/hari** | `EMAILIT_MAX_PER_DAY` |

`src/lib/broadcast/machine.ts` (`providerCaps()` + `validateLimits()`) memvalidasi
`max_per_minute` / `max_per_hour` setiap campaign terhadap kapasitas ini saat
submit; campaign yang melebihi akan ditolak dengan alasan `limits`.

**Mengubah kapasitas:** set `EMAILIT_MAX_PER_SECOND` / `EMAILIT_MAX_PER_DAY` di
Vercel sesuai plan akun, lalu redeploy. Perubahan hanya memengaruhi validasi
campaign baru; campaign yang sudah `queued` memakai pengaturan worker saat
diproses.

**Estimasi durasi broadcast:** `durasi ≈ jumlah_penerima / EMAILIT_MAX_PER_SECOND`
(worker berjalan satu batch per menit). Untuk audiens besar, bagi pengiriman
atau naikkan plan Emailit lebih dulu. Pantau `sent_today` (§4d) agar tidak
melewati batas harian; pengiriman yang gagal karena kuota akan tercatat di
`email_deliveries.error` dan bisa di-retry dari UI (`retry-failed`).
