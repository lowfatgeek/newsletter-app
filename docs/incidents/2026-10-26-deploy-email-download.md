# Postmortem — 26 Oktober 2026: Deploy 429, Email Senyap, Download 500

**Status:** resolved
**Dampak:** deployment gagal; email transaksional (OTP login admin, konfirmasi reward) tidak terkirim; tombol unduh reward menghasilkan HTTP 500.
**Commit terkait:** `d0a3b89`, `1fc2643`, `594941c`, `5f3f4eb`
**Dokumen terkait:** [deploy.md](../deploy.md), [operations.md](../operations.md)

## Ringkasan

Tiga kegagalan berbeda terjadi berurutan dan sempat terlihat seperti satu masalah:

1. Build Easypanel gagal karena Docker Hub membalas `429` saat mengambil metadata image dasar.
2. Setelah deploy berhasil, email tetap tidak terkirim karena Emailit sudah menonaktifkan API `/v1`. Setelah pindah ke `/v2`, backlog outbox dikirim beruntun hingga kena limit provider `2 pesan/detik` (`429`).
3. Unduhan reward gagal `500` karena middleware mencoba menulis header ke `Response` hasil `Response.redirect()` yang bersifat immutable.

Semua sudah diperbaiki dan diverifikasi di produksi.

## Timeline (UTC)

| Waktu | Kejadian |
|---|---|
| 02:47 | Deploy gagal: `429 Too Many Requests` dari `registry-1.docker.io` saat resolve `node:22-slim`. |
| 03:12 | Deploy ulang sukses memakai mirror ECR Public. Preflight melaporkan `MOCK_EMAILIT=false` dan provider Emailit terkonfigurasi. |
| 03:12+ | Login admin gagal menerima OTP. Log: `Emailit 502` dengan body kosong, attempt berulang sampai `5/5`. |
| 03:21 | Probe endpoint: `POST /v1/emails` → `502` (Caddy, body kosong); `POST /v2/emails` → `401 {"error":"UnauthorizedError","message":"API key required"}`. Disimpulkan v1 sudah tidak dilayani, v2 hidup. |
| 03:40 | Fix endpoint v2 + pacing commit `594941c`; CI green. |
| 03:47 | Unduh reward `500`: `TypeError: immutable` di `applySecurityHeaders` (middleware). |
| 03:52 | Fix middleware commit `5f3f4eb`; CI green. |
| Setelahnya | OTP diterima, konfirmasi reward diterima, tombol unduh berfungsi. |

## Akar masalah

### 1. Build gagal: Docker Hub 429

- `Dockerfile` memakai tag floating `node:22-slim` langsung dari Docker Hub.
- BuildKit selalu melakukan request metadata (HEAD manifest) setiap deploy; IP publik VPS kena rate/abuse limit Docker Hub (anonim 100 pull/6 jam; akun gratis 200/6 jam; `429` tanpa body mengindikasikan abuse limit berbasis IP).
- Error terjadi di tahap `load metadata`, sebelum kode proyek dijalankan — jadi bukan disebabkan commit yang sedang di-deploy.

**Perbaikan:** kedua stage (`build` dan `runtime`) memakai mirror resmi `public.ecr.aws/docker/library/node:22-slim`.

### 2. Email senyap: Emailit v1 mati, lalu backlog kena rate limit

- Aplikasi memanggil `https://api.emailit.com/v1/emails`. Emailit kini hanya melayani `/v2/emails`; edge Caddy membalas `502` kosong untuk v1.
- Log provider kosong karena request mati di edge, bukan karena kredensial atau sender salah.
- Setelah endpoint diganti ke v2, semua baris `email_outbox` berstatus `pending` menjadi bisa dikirim. `processOutbox` mengirim batch hingga 20 baris tanpa jeda, sedangkan Emailit membatasi **2 pesan/detik per akun** → request berikutnya `429` (`"limit":2,"current":2,"retry_after":1`).
- Baris yang sudah `failed` dengan `attempts=5/5` **tidak** di-retry. Baris `pending` di-retry; OTP dari percobaan login berulang bisa ikut terkirim tetapi sudah kedaluwarsa (10 menit). Hanya OTP dari login terbaru yang valid.

**Perbaikan:**

- Endpoint pindah ke `/v2/emails`; skema payload (`from`, `to`, `reply_to`, `subject`, `html`, `text`, `Idempotency-Key`) tetap kompatibel.
- Pacing global di adapter Emailit: semua pengiriman (transaksional + broadcast) berbagi satu antrean dengan laju `EMAILIT_MAX_PER_SECOND` (default 2/detik).
- Kegagalan fast-drain tidak lagi ditelan diam-diam; error tercatat di log container.

### 3. Download 500: header immutable

- Route download mengembalikan `Response.redirect(r.url, 302)`.
- Response hasil `Response.redirect()` (dan `fetch()`) memiliki header **immutable**.
- Middleware `applySecurityHeaders` memanggil `headers.set()` pada response tersebut → `TypeError: immutable` → 500 sebelum redirect ke R2 dikirim. R2 dan file tidak bermasalah.

**Perbaikan:** middleware meng-clone header ke `Headers` baru, menerapkan header keamanan ke salinan, lalu membangun ulang `Response` dengan status/body/header asli. Berlaku untuk semua response, bukan hanya route download.

## Perubahan yang dilakukan

| Commit | Area | Perubahan |
|---|---|---|
| `d0a3b89` | Deploy | Base image dari ECR Public (build + runtime); fast-drain outbox dipusatkan dengan logging error; tombol "Kirim uji" langsung drain; preflight mencetak status `MOCK_EMAILIT`, `EMAILIT_API_KEY`, `CRON_SECRET`; peringatan `MOCK_EMAILIT` di `.env.example`; troubleshooting 429 di `docs/deploy.md`. |
| `1fc2643` | Email | Adapter Emailit pindah ke `/v2/emails`; test endpoint diperbarui + regression guard. |
| `594941c` | Email | Pacing global `EMAILIT_MAX_PER_SECOND` (default 2/detik) untuk transaksional dan broadcast; test pacing (~510ms antar request pada limit 2/detik). |
| `5f3f4eb` | Middleware | Clone header sebelum menulis header keamanan; test `Response.redirect()` immutable dan preservasi multi `Set-Cookie`. |

File utama: [Dockerfile](../../Dockerfile), [src/lib/emailit.ts](../../src/lib/emailit.ts), [src/lib/mailworker.ts](../../src/lib/mailworker.ts), [src/middleware.ts](../../src/middleware.ts), [scripts/preflight.mjs](../../scripts/preflight.mjs).

## Verifikasi

- Probe langsung: v1 → `502` kosong; v2 → `401` (route hidup, hanya butuh API key).
- `npm run lint`, `npm run check` (0 error), `npm run build` sukses.
- Test adapter Emailit 4/4 lolos, termasuk pacing 510ms.
- Test middleware baru lolos (redirect immutable + multi `Set-Cookie`).
- CI GitHub Actions green untuk commit terkait.
- Produksi: OTP admin diterima, email konfirmasi reward diterima, tombol unduh berhasil.

## Pencegahan & runbook

- **Email senyap:** periksa `email_outbox.last_error` dan log container lebih dulu. Log provider yang kosong bisa berarti request mati di edge, bukan tidak pernah dikirim. Pastikan endpoint masih versi yang dilayani provider.
- **Rate limit:** jaga `EMAILIT_MAX_PER_SECOND` ≤ 2 kecuali limit akun dinaikkan. Worker transaksional dan broadcast memakai pacing yang sama.
- **Baris gagal permanen:** `failed` dengan `attempts=5/5` tidak dicoba lagi. Untuk OTP, login ulang agar challenge baru dibuat; untuk konfirmasi, submit ulang.
- **Cron Easypanel:** dua job (`/api/cron/outbox`, `/api/cron/broadcast`) tetap wajib ada untuk memproses antrean broadcast dan sisa backlog. Fast-drain hanya mempercepat OTP, subscribe, dan test-send.
- **Response immutable:** jangan menulis header langsung ke `Response.redirect()`/`fetch()`; middleware sekarang meng-clone, tetapi route baru tetap harus sadar aturan ini.
- **Build:** jangan kembali ke `node:22-slim` langsung dari Docker Hub tanpa kredensial/mirror. Pantau kuota Docker Hub bila memakai registry tersebut.

## Follow-up opsional

- Hormati `retry_after` dari `429` agar retry tidak memakai backoff menit.
- Prioritaskan `otp_admin` di urutan outbox bila backlog sering > 20 baris.
- Tambah alert untuk `oldest_pending` (query sudah ada di `docs/operations.md` §4c).
- Jalankan e2e dengan Postgres nyata di CI untuk menangkap regresi route (saat ini unit test ber-DB sudah berjalan di CI).
