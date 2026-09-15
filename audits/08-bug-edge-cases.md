# Audit 08 — Bug & Edge Cases

Tanggal: 2026-09-14

Lingkup: input invalid, network gagal, data kosong, double submit, race condition.

Metode: read-only. Tidak ada perubahan kode. Catatan penomoran: file ini urutan `08-` pada daftar audit; pada rencana awal sempat dirujuk sebagai "tahap 5". Mulai revisi ini nomor internal diselaraskan menjadi **Audit 08** agar tidak bentrok dengan `audits/05-security.md`. Revisi ulang mandiri dilakukan dengan verifikasi tiap klaim terhadap kode saat ini (bukti `file:line`).

## Ringkasan

Penanganan edge case **matang dan defensif berlapis**. Validasi di kedua sisi (client + server sebagai otoritas), seluruh `request.json()` dalam try/catch (15 route), UUID/slug/email divalidasi dengan regex sebelum menyentuh DB pada jalur yang disebut, race condition ditutup dengan primitif atomik (`onConflictDoNothing`, `UPDATE ... RETURNING`, transaksi, `FOR UPDATE SKIP LOCKED`), token sekali pakai dikonsumsi atomik, double submit diblokir di JS dengan server idempoten sebagai jaring, empty state admin tersedia (sebagian tanpa CTA), dan halaman status ramah untuk campaign paused/tautan kedaluwarsa.

Revisi ulang mengoreksi lima klaim yang tidak akurat pada versi lama: (a) B1 menyebut `getObject` R2 yang **tidak ada** di repo; (b) klaim "bootstrap admin pakai `onConflictDoNothing`" hanya benar di jalur reset password login, tidak di `ensureAdmin`; (c) alasan timer `expired`/`wrong-campaign` tidak pernah sampai ke user (dipetakan ke `bad-request`); (d) halaman `/akses` dengan token invalid **redirect**, bukan menampilkan pesan ramah dengan unduhan dinonaktifkan; (e) resubscribe **tidak** idempoten terhadap event consent. Ditambah temuan baru: path param non-UUID tanpa guard di beberapa route (berpotensi 500), `changeSlug` check-then-act, dan empty state kontak tanpa CTA.

Tidak ada bug fungsional kritikal. **Verdict audit 08: LULUS (dengan koreksi)** — B1 tetap disarankan sebagai hardening satu baris; N2/N3 minor.

## Temuan

### B1 — Tidak ada timeout eksplisit pada fetch keluar (Emailit, R2 PUT)
- Status: **MINOR (robustness).** (Klaim lama sebagian salah: `getObject` tidak ada di repo.)
- Bukti: `sendViaEmailit` memakai `fetchImpl` langsung tanpa signal — `src/lib/emailit.ts:14`. `putObject` R2 memakai `fetch` langsung tanpa signal — `src/lib/storage.ts:41`. Tidak ada `AbortSignal`/`AbortController` di seluruh repo (pencarian read-only: nol hasil, di luar `node_modules`/`dist`). `presignDownloadUrl` (`src/lib/storage.ts:45-59`) hanya menandatangani URL — **tidak** melakukan fetch, jadi tidak relevan untuk timeout. Fungsi `getObject` **tidak pernah ada** di `src/lib/storage.ts` (grep: nol hasil) — koreksi tegas terhadap versi lama.
- Fetch keluar lain: client `fetch("/api/timer-token")` di `src/components/EmailForm.astro:109` (same-origin, tanpa timeout — risiko rendah). `src/pages/api/subscribe.ts:39` memakai `request.formData()` dan `src/pages/api/webhooks/emailit.ts:26` memakai `request.text()` — keduanya **inbound**, bukan fetch keluar.
- Dampak: bila provider menggantung koneksi, worker tick ikut menggantung hingga batas platform (Vercel `maxDuration`). Probabilitas rendah, dampak sedang (satu tick terbuang; tick berikutnya pulih karena idempoten).
- Rekomendasi: `signal: AbortSignal.timeout(30_000)` pada `src/lib/emailit.ts:14` dan `src/lib/storage.ts:41`. Satu baris per call site.

### B2 — Double submit tanpa JS tetap mungkin (residual, merujuk U2)
- Status: **MINOR (UX, duplikat U2 dari sudut berbeda).**
- Bukti (client): tombol dirender aktif di server (`src/components/EmailForm.astro:76-80`); script men-disable saat timer (`:99`) dan unlock saat `elapsed >= TOTAL` (`:120-126`, `:136-139`). Handler submit hanya mencegah bila token kosong — `src/components/EmailForm.astro:145-147`.
- Bukti (server idempoten): kontak di-upsert atomik `onConflictDoNothing` pada `emailNormalized` — `src/lib/subscribe.ts:63-67`; klaim unik per (contact, campaign) via `upsertClaim` `onConflictDoNothing` — `src/lib/access.ts:12-21` + index `claim_contact_campaign_uq` di `src/lib/schema.ts:72`; outbox idempoten via `idempotencyKey` unique — `src/lib/schema.ts:112` + `src/lib/outbox.ts:24`.
- Nuansa yang perlu dikoreksi dari versi lama: idempotency key email **bergantung pada raw token** — `src/lib/subscribe.ts:96` (`confirm-${claimId}-${raw.slice(0,12)}`) dan `src/lib/subscribe.ts:82` (`access-${claimId}-${raw.slice(0,12)}`). Jadi dua submit dari **halaman berbeda** (dua token berbeda) menghasilkan dua email; dedupe outbox hanya berlaku untuk submit berulang dengan token yang sama. Ini bukan data ganda (claim tetap satu baris) dan terbatas rate limit per email 5/jam (`src/lib/subscribe.ts:45-47`), serta secara fungsional adalah jalur "kirim ulang". Jadi klaim "outbox idempoten" tidak boleh dipakai untuk menyimpulkan cross-page-load dedupe.
- Dampak: tidak ada data ganda; email ganda potensial (dua `reward_access`/`confirmation`) hanya bila request berasal dari token berbeda; jendela terbatas rate limit.
- Rekomendasi: sama dengan U2 — tambah loading state/disable pada form klaim publik. Tidak ada perbaikan server yang dibutuhkan.

### N1 — `ensureAdmin` select-then-insert tanpa `onConflictDoNothing` (bootstrap)
- Status: **MINOR (robustness, race admin-only).**
- Bukti: `ensureAdmin` membaca baris dulu (`src/lib/admin/bootstrap.ts:22`) lalu `insert` tanpa `onConflictDoNothing` (`src/lib/admin/bootstrap.ts:35`). Jalur bootstrap lain **sudah** atomik: `requestPasswordReset` memakai `onConflictDoNothing({ target: adminUsers.email })` + fallback select — `src/lib/admin/login.ts:116-124`. Klaim lama "Race bootstrap admin. `onConflictDoNothing` pada email" benar hanya untuk jalur login ini, tidak untuk `ensureAdmin`.
- Dampak: dua pemanggilan `ensureAdmin` konkuren pada boot pertama bisa menabrak unique `admin_user.email` → error (500 pada pemanggil), meski tidak menghasilkan admin ganda. `bootstrap.ts` dipakai scripts/seed, bukan request publik.
- Rekomendasi: pakai pola atomik yang sama seperti `login.ts:116-124`.

### N2 — Path param non-UUID tidak dijaga sebelum query (berpotensi 500, bukan 403/404)
- Status: **MINOR (input invalid).** (Melengkapi klaim lama #3 yang menyebut token malformed selalu → `invalid`.)
- Bukti: `UUID_RE` hanya dipakai di OTP (`src/pages/admin/api/otp.ts:29`, `src/lib/admin/login.ts:145`), audience (`src/lib/broadcast/audience.ts:21,55`), dan klik link (`src/lib/broadcast/links.ts:6,23`). Jalur berikut **tidak** memvalidasi UUID sebelum query `uuid`:
  - `/api/download/<session>/<assetId>` → `eq(rewardAssets.id, assetId)` di `src/lib/download.ts:18-19` (route tanpa try/catch: `src/pages/api/download/[session]/[assetId].ts:14-21`). Butuh session token valid lebih dulu (`src/lib/download.ts:13`).
  - `DELETE /admin/api/assets/[id]` → `removeAsset(id)` (`src/pages/admin/api/assets/[id].ts:21-23`) → `eq(rewardAssets.id, assetId)` (`src/lib/admin/assets.ts:110,112`).
  - `POST /admin/api/contacts/[id]/anonymize` → `anonymizeContact(contactId)` (`src/pages/admin/api/contacts/[id]/anonymize.ts:26-27`) → `eq(contacts.id, contactId)` (`src/lib/admin/contacts.ts:280`).
  - Route admin `[id]` lain memakai pola sama (mis. `getCampaignById` → `src/lib/admin/campaigns.ts:317`).
- Dampak: Postgres menolak literal non-UUID untuk kolom `uuid` (invalid input syntax) → error tak tertangkap → 500, bukan 403/404. Akses terautentikasi (sesi admin/claim) sehingga tidak bisa dipakai pre-auth, dan tidak ada kebocoran data.
- Rekomendasi: guard `UUID_RE.test(...)` di awal handler/lib (kembalikan 404/403), atau bungkus query dalam try/catch.

### N3 — `resubscribeByToken` tidak idempoten terhadap event consent
- Status: **MINOR (data consent).** (Mengoreksi klaim lama #15.)
- Bukti: `unsubscribeByToken` idempoten — early-return bila status sudah `unsubscribed`, tanpa event ganda (`src/lib/broadcast/unsubscribe.ts:48-50`). Sebaliknya `resubscribeByToken` selalu menghapus suppression, upsert subscription, lalu `insert(consentEvents ... "resubscribed")` tanpa cek status saat ini — `src/lib/broadcast/unsubscribe.ts:96-110`. Tidak ada guard "current status harus `unsubscribed`".
- Dampak: POST `/api/unsubscribe/resubscribe` berulang (atau token link milik kontak yang sudah aktif) menambah baris `consent_event` `resubscribed` duplikat. Tidak mengubah status langganan secara salah, hanya riwayat consent yang berlebihan.
- Rekomendasi: early-return bila subscription sudah `active`/tidak `unsubscribed`, atau dedupe event berdasarkan status transisi.

### N4 — `changeSlug` check-then-act (race rename, admin)
- Status: **MINOR (race, admin-only).**
- Bukti: ketersediaan slug dicek dengan SELECT (`src/lib/admin/campaigns.ts:120-124`) lalu slug di-`UPDATE` di dalam transaksi tanpa `onConflictDoNothing`/guard (`src/lib/admin/campaigns.ts:131-132`). Bandingkan `createCampaign` yang atomik (`src/lib/admin/campaigns.ts:33-38`).
- Dampak: dua rename konkuren ke slug yang sama dapat menabrak unique `reward_campaign.slug` → error tak tertangani. Operasi admin, bukan jalur publik.
- Rekomendasi: gunakan `onConflictDoNothing`/`RETURNING` untuk pindah slug, atau tangani unique violation sebagai `slug-taken`.

### N5 — Tidak ada batas ukuran body JSON eksplisit
- Status: **MINOR (hardening).**
- Bukti: hanya route upload yang pre-check `Content-Length` (`src/pages/admin/api/campaigns/[id]/assets.ts:61-64`). Route JSON lain memanggil `request.json()` tanpa pre-check ukuran (daftar 15 route di Verifikasi per area #4); webhook membaca `request.text()` tanpa batas ukuran (`src/pages/api/webhooks/emailit.ts:26`) walau rate limit baru berlaku setelah verifikasi HMAC (`:28-46`).
- Dampak: body sangat besar dibuffer sebelum ditolak. Semua route JSON terautentikasi admin (kecuali `src/pages/api/timer-token.ts:24`), sehingga paparan terbatas; webhook dilindungi HMAC.
- Rekomendasi: set batas body di adapter/reverse proxy, atau pre-check `Content-Length` pada route JSON.

## Verifikasi per area (yang terverifikasi)

1. **Email.** `normalizeEmail`: `trim()` + `toLowerCase()` + batas total 254 + regex lokal maks 64 & TLD ≥2 — `src/lib/email.ts:1-8`. Invalid → `reason: "bad-request"`, bukan exception (`src/lib/subscribe.ts:38-39`). Domain dicek terhadap allowlist DB: `src/lib/subscribe.ts:49` → `src/lib/allowlist.ts:10-15` (default: `src/lib/allowlist.ts:5-8`).
2. **Slug.** `validateSlug`: `^[a-z0-9]+(-[a-z0-9]+)*$`, panjang 1–120 — `src/lib/admin/campaigns.ts:24-26`. Duplikat → `slug-taken` (bukan 500) via `onConflictDoNothing` + `RETURNING` — `src/lib/admin/campaigns.ts:33-38`. Slug unicode/invalid → tidak lolos validasi; pada route publik (`/r/[slug]`) slug asing hanya tidak cocok → 404 (`src/pages/r/[slug].astro:22-30`), bukan error DB.
3. **UUID.** `UUID_RE` dipakai sebelum query di OTP (`src/pages/admin/api/otp.ts:29`; `src/lib/admin/login.ts:145`), audience filter (`src/lib/broadcast/audience.ts:21,55`), dan klik link (`src/lib/broadcast/links.ts:6,23`). Token malformed → `invalid`, bukan error DB **pada jalur ini**. Jalur lain tidak dijaga — lihat N2.
4. **JSON body.** Tepat **15** route memakai `request.json()`, semuanya dalam try/catch dengan fallback 400 (kecuali `domains.ts` fallback `{}`):
   `src/pages/admin/api/campaigns/index.ts:24`, `campaigns/[id].ts:73`, `campaigns/[id]/assets.ts:115`, `campaigns/[id]/doa.ts:25`, `campaigns/[id]/status.ts:28`, `domains.ts:23`, `email-campaigns/[id].ts:43`, `email-campaigns/[id]/schedule.ts:31`, `email-campaigns/[id]/test-send.ts:27`, `email-campaigns/count.ts:23`, `login.ts:19`, `otp.ts:19`, `password/confirm.ts:18`, `password/request.ts:20`, dan `src/pages/api/timer-token.ts:24`. Body kosong/invalid tidak menyebabkan crash.
5. **Race klaim.** `upsertClaim` + `onConflictDoNothing` pada unique `(contact, campaign)` — `src/lib/access.ts:12-21`, index `claim_contact_campaign_uq` di `src/lib/schema.ts:72`. Upsert kontak atomik sebelum klaim — `src/lib/subscribe.ts:63-67`.
6. **Race konfirmasi.** Seluruh sekuen (konsumsi token → update contact → update claim → subscription → consent) dalam satu transaksi — `src/lib/access.ts:77-99`. Token dikonsumsi via `UPDATE ... WHERE usedAt IS NULL AND expiresAt > now() ... RETURNING` — `src/lib/access.ts:59-68`; dua klik hanya satu yang menang (baris kedua tidak mengembalikan row).
7. **Race OTP.** Cap 5 percobaan ada di klausa `WHERE` atomik, bukan baca-lalu-tulis — konsumsi: `src/lib/admin/otp.ts:42-49`; increment: `src/lib/admin/otp.ts:55-62`. Brute force konkuren tidak bisa melewati cap.
8. **Race broadcast.** `claimForSending` = `UPDATE ... SET status='sending' WHERE id AND status='queued' AND NOT EXISTS (sending lain) RETURNING` — `src/lib/broadcast/machine.ts:144-154` (guard `NOT EXISTS` di `:150`). Sisa risiko dua campaign berbeda konkuren tercatat di audit lain, bukan temuan baru di sini.
9. **Race bootstrap admin.** Jalur reset password: `onConflictDoNothing` + fallback select — `src/lib/admin/login.ts:116-124`. `ensureAdmin` belum atomik — lihat N1.
10. **Outbox idempoten.** `idempotencyKey` unique (`src/lib/schema.ts:112`) + `onConflictDoNothing` (`src/lib/outbox.ts:24`). Dimensi "per token" dijelaskan di B2. Pengambilan batch aman dari tick tumpang tindih via `FOR UPDATE SKIP LOCKED` — `src/lib/mailworker.ts:11-18`.
11. **Network gagal tertangani.** Emailit non-OK → `throw` body terpotong (`src/lib/emailit.ts:30-33`); outbox menaikkan `attempts`, backoff eksponensial, `lastError`, dan menandai `failed` setelah 5 percobaan — `src/lib/mailworker.ts:39-51`. R2 gagal → `throw` sebelum tulis DB; urutan `putObject` (`src/lib/admin/assets.ts:75`) **sebelum** `insert` asset (`:81`). Webhook idempoten via unique `(provider_message_id, event_type)` (`src/lib/schema.ts:257`) + `onConflictDoNothing` (`src/lib/broadcast/webhooks.ts:50-60`).
12. **Data kosong.** Empty state: campaign `src/pages/admin/campaigns/index.astro:60-64` (ber-CTA), email campaign `src/pages/admin/email-campaigns/index.astro:72-76` (ber-CTA), kontak `src/pages/admin/contacts/index.astro:145-148` (**tanpa** CTA — koreksi). Campaign paused → halaman ramah "jeda" bukan 404: `src/lib/campaign.ts:12-19`, `src/pages/r/[slug].astro:22-30,63-64`, `src/components/CampaignPaused.astro:9-31`. Konfirmasi invalid → halaman kedaluwarsa ramah (`src/pages/konfirmasi/[token].astro:8-12,14-25`); unsubscribe invalid → halaman invalid ramah (`src/pages/batal-berlangganan/[token].astro:11,16-24`). Token `/akses` invalid → **redirect 303 ke `/`** (`src/pages/akses/[token].astro:13`, `src/pages/en/akses/[token].astro:13`), bukan pesan + unduhan nonaktif (koreksi). Halaman akses tanpa asset tidak punya empty state (`src/pages/akses/[token].astro:24-34`).
13. **Timer edge.** `MAX_AGE_MS = 2 jam`, `MIN_AGE_MS = 30 detik` (produksi) — `src/lib/timer.ts:4-5,10-15`. Verifikasi: token invalid → `invalid`, campaign beda → `wrong-campaign`, terlalu cepat → `too-fast`, >2 jam → `expired` (`src/lib/timer.ts:26-33`). Namun `processSubscribe` memetakan semua selain `too-fast` ke `bad-request` — `src/lib/subscribe.ts:41-42`; `cek-email.astro` tidak punya kunci `expired`/`wrong-campaign` (`src/pages/cek-email.astro:17-23`). Tanpa token → token kosong ditolak sebagai `invalid` → `bad-request`; tanpa JS, tombol aktif dan server tetap menolak lewat verify.
14. **Upload edge.** `ALLOWED_MIME` berisi **8** tipe: `application/pdf`, `application/zip`, `...wordprocessingml.document` (docx), `...spreadsheetml.sheet` (xlsx), `...presentationml.presentation` (pptx), `image/png`, `image/jpeg`, `image/webp` — `src/lib/storage.ts:4-13`. Batas ukuran 100 MB (`src/lib/storage.ts:14`). Mismatch ekstensi-vs-MIME dan MIME tak diizinkan → `mime-not-allowed`; >100 MB → `too-large` — `src/lib/admin/assets.ts:21-45` (peta ekstensi `:21-31`). Semua divalidasi **sebelum** `putObject` (`src/lib/admin/assets.ts:64-69` lalu `:75`). Route juga menolak `Content-Length` berlebih lebih awal (413) — `src/pages/admin/api/campaigns/[id]/assets.ts:61-64`.
15. **Unsubscribe edge.** Token invalid → redirect halaman invalid ramah (`src/pages/api/unsubscribe/[token].ts:29-38`). Unsubscribe idempoten tanpa event ganda (`src/lib/broadcast/unsubscribe.ts:48-50`). Resubscribe mengaktifkan kembali + menghapus suppression `unsubscribe` saja (hard bounce/complaint tetap) — `src/lib/broadcast/unsubscribe.ts:96-107`; event consent `resubscribed` **tidak** dedupe (lihat N3).

## Yang belum diuji pada tahap ini

- Uji race aktual (N request konkuren ke klaim/konfirmasi/OTP/rename slug) — primitif atomik benar secara statis, belum dibuktikan runtime. Larangan tugas: tidak menjalankan DB/Playwright.
- Uji network chaos (provider timeout, R2 500, DB putus tengah transaksi) — rollback transaksi diasumsikan dari Drizzle/Postgres.
- Konfirmasi runtime bahwa path param non-UUID memang menghasilkan 500 (N2) — memerlukan DB; disimpulkan dari tipe kolom `uuid`.
- Fuzz input (email aneh, slug unicode, JSON besar) di luar regex yang ada.

## Rekomendasi prioritas

1. Tambah timeout pada fetch Emailit (`src/lib/emailit.ts:14`) + R2 PUT (`src/lib/storage.ts:41`) (B1). Catatan: `getObject` tidak ada, jadi hanya dua call site.
2. Loading state/disable pada form klaim publik (B2 = U2).
3. Guard UUID pada path param yang belum dijaga (N2) — cegah 500 jadi 404/403.
4. Idempotensi event consent pada resubscribe (N3).
5. Hardening kecil: `ensureAdmin` atomik (N1), `changeSlug` atomik (N4), batas ukuran body JSON (N5).
6. Pertimbangkan satu skrip uji race konkuren pra-launch untuk klaim + OTP (pembuktian, bukan perbaikan).

## Catatan revisi audit ulang

Berikut klaim versi lama → hasil verifikasi → tindakan (bukti `file:line`).

1. **B1 "`putObject`/`getObject` R2 tanpa timeout".** Verifikasi: `putObject` memang tanpa signal (`src/lib/storage.ts:41`), tetapi `getObject` **tidak ada** di repo (grep nol hasil; `storage.ts` hanya `putObject` + `presignDownloadUrl`, dan `presignDownloadUrl` tidak melakukan fetch — `src/lib/storage.ts:45-59`). Tindakan: koreksi B1, sebut hanya dua fetch keluar server (Emailit `src/lib/emailit.ts:14`, R2 PUT `src/lib/storage.ts:41`) plus catatan fetch client same-origin (`src/components/EmailForm.astro:109`).
2. **"15 route `request.json()` semua try/catch".** Verifikasi: tepat 15 route, semua terbungkus try/catch (daftar di Verifikasi per area #4; `domains.ts` fallback `{}` di `src/pages/admin/api/domains.ts:23-25`). Tindakan: dipertahankan.
3. **"UUID/slug/email divalidasi sebelum menyentuh DB" (implisit semua jalur).** Verifikasi: benar untuk OTP (`src/pages/admin/api/otp.ts:29`), reset (`src/lib/admin/login.ts:145`), audience (`src/lib/broadcast/audience.ts:21,55`), klik (`src/lib/broadcast/links.ts:6,23`); **tidak** untuk path param non-UUID di download/assets/anonymize (`src/lib/download.ts:18`, `src/lib/admin/assets.ts:110`, `src/lib/admin/contacts.ts:280`). Tindakan: klaim dipersempit; tambah N2.
4. **"Race bootstrap admin: `onConflictDoNothing` pada email".** Verifikasi: ada di `requestPasswordReset` (`src/lib/admin/login.ts:116-124`), **tidak** di `ensureAdmin` (`src/lib/admin/bootstrap.ts:22-35`, select-then-insert). Tindakan: koreksi atribusi; tambah N1.
5. **#13 "timer kedaluwarsa → `expired`; lintas campaign → `wrong-campaign`" sebagai alasan user.** Verifikasi: `verifyTimerToken` memang mengembalikan `wrong-campaign`/`expired` (`src/lib/timer.ts:29,32`), tetapi `processSubscribe` memetakan keduanya ke `bad-request` (`src/lib/subscribe.ts:41-42`) dan `cek-email.astro` tak punya kunci itu (`src/pages/cek-email.astro:17-23`). Tindakan: koreksi #13; alasan user-facing hanya `too-fast`, `rate-limited`, `domain-not-allowed`, `campaign-unavailable`, `bad-request`.
6. **#12 "halaman akses invalid → unduh dinonaktifkan + pesan".** Verifikasi: `/akses/[token]` invalid → `Astro.redirect("/", 303)` (`src/pages/akses/[token].astro:13`; EN `src/pages/en/akses/[token].astro:13`). Unduhan nonaktif muncul sebagai 403 pada route unduh (`src/pages/api/download/[session]/[assetId].ts:19`), bukan di halaman. Tindakan: koreksi #12; halaman ramah tetap ada untuk konfirmasi/unsubscribe (`src/pages/konfirmasi/[token].astro:14-25`, `src/pages/batal-berlangganan/[token].astro:16-24`).
7. **#12 "daftar admin (campaign, email campaign, kontak) empty state ber-CTA".** Verifikasi: campaign dan email campaign ber-CTA (`src/pages/admin/campaigns/index.astro:60-64`, `src/pages/admin/email-campaigns/index.astro:72-76`); kontak hanya pesan (`src/pages/admin/contacts/index.astro:145-148`). Tindakan: koreksi.
8. **#15 "resubscribe … event consent (bukan duplikat)".** Verifikasi: `unsubscribeByToken` idempoten (`src/lib/broadcast/unsubscribe.ts:48-50`), tetapi `resubscribeByToken` selalu insert event `resubscribed` tanpa guard (`src/lib/broadcast/unsubscribe.ts:96-110`). Tindakan: koreksi; tambah N3.
9. **B2 "outbox idempoten via `idempotencyKey` unique" sebagai jaring double submit.** Verifikasi: key bergantung raw token (`src/lib/subscribe.ts:82,96`), jadi dedupe hanya untuk token sama; cross-page-load tidak terdedupe (tetap dibatasi rate limit `src/lib/subscribe.ts:45-47`). Tindakan: klarifikasi cakupan idempotensi di B2.
10. **Temuan baru yang ditambahkan:** N4 `changeSlug` check-then-act (`src/lib/admin/campaigns.ts:120-147`), N5 tanpa batas body JSON (pre-check hanya di `src/pages/admin/api/campaigns/[id]/assets.ts:61-64`), serta catatan empty state `/akses` tanpa asset (`src/pages/akses/[token].astro:24-34`).
