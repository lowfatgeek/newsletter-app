# Audit 01 — Functional Correctness

Tanggal: 2026-09-14 (revisi audit ulang: 2026-09-14)
Lingkup: PRD v2 (`.agents/kelaswfa-newsletter-prd-v2.md`) §6–§7, §12 acceptance criteria, dan Plan 4 gap-closure. Metode: read-only, verifikasi statis kode (tanpa DB runtime, tanpa menjalankan server). Tidak ada perubahan kode. Setelah revisi ulang, seluruh klaim diverifikasi ulang terhadap kode saat ini (`git` HEAD `f8526f0`); nomor baris dicantumkan dan sudah dicek ulang.

Baseline yang dipakai:
- `src/lib/timer.ts`, `src/lib/subscribe.ts`, `src/pages/api/subscribe.ts`, `src/pages/api/timer-token.ts`
- `src/lib/access.ts`, `src/lib/access-page.ts`, `src/lib/download.ts`, `src/lib/storage.ts`
- `src/lib/campaign.ts`, `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`, `src/components/EmailForm.astro`, `src/components/LocaleSwitch.astro`
- `src/lib/broadcast/*` (audience, snapshot, machine, worker, webhooks, links, unsubscribe, stats, content, crud)
- `src/lib/admin/*`, `src/pages/admin/*`, `src/pages/api/sitemap.xml.ts`, `src/pages/cek-email.astro`
- Verifikasi revisi tambahan: `src/lib/admin/bootstrap.ts`, `src/lib/admin/login.ts`, `src/lib/admin/otp.ts`, `src/lib/admin/devices.ts`, `src/lib/admin/contacts.ts`, `src/pages/api/webhooks/emailit.ts`, `src/pages/api/cron/broadcast.ts`, `test/**`

## Ringkasan

Fungsional inti **terimplementasi dan koheren**: funnel reward, timer server-side, subscribe, double opt-in, klaim ulang, lifecycle campaign, proteksi file, CMS admin, broadcast dengan snapshot dan state machine, unsubscribe, click tracking, webhook idempoten, serta item Plan 4 (toggle bahasa, canonical, kirim-ulang, sitemap, dashboard funnel, audit viewer, badge fallback EN).

Satu temuan fungsional-gap (F1) dan satu risiko konkurensi sisa (F2). Sisanya minor/informatif. Tidak ada fitur PRD yang hilang total.

**Verdict audit 01: LULUS BERSYARAT** — lanjut ke tahap berikutnya dimungkinkan; F1 (kepatuhan consent re-subscribe) dan sisa risiko F2 sebaiknya ditindaklanjuti sebelum launch. Suite unit/integrasi `npm test` (vitest) dilaporkan lead hijau: 49 file / 326 test, ~66s (tidak dijalankan ulang oleh auditor).

## Temuan

### F1 — Persetujuan re-subscribe eksplisit tidak ada di form klaim (PRD §7.1 "Claim ulang setelah unsubscribe"; §12 "hanya bisa aktif lagi setelah persetujuan re-subscribe eksplisit dan terkonfirmasi")
- Status: **GAP / partial compliance.**
- Bukti (diverifikasi ulang):
  - `src/components/EmailForm.astro` selalu menampilkan copy newsletter generik yang sama (`copy.consent` = `t(locale, "consentCopy")`, baris 23 dan 67–69); tidak ada cabang/persetujuan tambahan untuk kontak yang sudah unsubscribe.
  - `consentCopy` di `src/lib/i18n.ts:25-28` hanya dua varian statis (id/en) tanpa nuansa re-subscribe.
  - `src/lib/subscribe.ts` `processSubscribe` untuk kontak `confirmed` (baris 73–87) langsung menerbitkan token `access` + email `reward_access` tanpa memeriksa status marketing subscription — benar untuk porsi "tanpa persetujuan hanya email transaksional", tetapi tidak ada jalur "dengan persetujuan" di form yang sama. Kontak `unsubscribed` tidak diaktifkan ulang di sini (`confirmContactByToken` juga tidak, `src/lib/access.ts:86-96`).
  - Jalur re-subscribe eksplisit ada dan benar, tetapi terpisah: halaman `/subscribe-again/<token>` (`src/pages/subscribe-again/[token].astro:36-54`, copy persetujuan eksplisit di baris 37–45; form POST ke `/api/unsubscribe/resubscribe`) memanggil `resubscribeByToken` (`src/lib/broadcast/unsubscribe.ts:86-113`), ditautkan dari `src/pages/batal-berlangganan/[token].astro:38`.
- Dampak: persyaratan "halaman form harus menampilkan persetujuan re-subscribe yang sangat jelas" belum dipenuhi di halaman form klaim itu sendiri. Alur hormat-consent tetap benar (tidak ada re-aktivasi diam-diam), jadi ini gap UX/kepatuhan, bukan kebocoran consent.
- Rekomendasi: tambah cabang di form klaim untuk email yang terdeteksi unsubscribed (atau teks + checkbox eksplisit yang selalu tampil saat relevan), yang mengarahkan ke `resubscribeByToken` setelah konfirmasi email. Pertahankan perilaku generik anti-enumerasi (jangan membocorkan status subscription lewat respons submit).

### F2 — Guard single-`sending` sudah SQL/DB-level dalam satu statement, tetapi belum ada constraint `UNIQUE` DB (PRD §7.4 "Hanya satu broadcast sending"; §12)
- Status: **RISIKO KONKURENSI SISA / partial** (bukan lagi "hanya level aplikasi").
- Bukti (diverifikasi ulang):
  - `claimForSending` di `src/lib/broadcast/machine.ts:144-153` memakai satu statement `UPDATE ... SET status='sending' WHERE id = ? AND status='queued' AND NOT EXISTS (select 1 from email_campaigns ec where ec.status='sending' and ec.id <> ?) RETURNING`. Guard single-sending-nya **SQL/level-DB dan atomik dalam satu statement** (commit `01e727b` "db-level single-sending guard and retry throttle"). Verifikasi klaim lama "hanya level aplikasi" **tidak akurat**.
  - `src/lib/broadcast/worker.ts:101` memanggil `claimForSending`, komentar single-flight di baris 13–17 dan 21.
  - **Belum ada partial unique index `WHERE status='sending'`**: `grep -n "sending" drizzle/*.sql` = 0 hasil (file 0000–0003). `src/lib/schema.ts` mendefinisikan kolom status `varchar` (`emailCampaigns.status`, baris 202) dan hanya unique index `campaign_recipient_uq` (baris 229), `provider_event_uq` (baris 257), dsb. — tidak ada constraint status.
- Dampak: di bawah READ COMMITTED, dua `UPDATE` konkuren pada **dua campaign berbeda** dapat sama-sama lolos `NOT EXISTS` karena masing-masing belum melihat perubahan yang belum commit, sehingga invariant "hanya satu sending" tidak dijamin DB. Skenario pemicu sempit (cron 1 menit, satu batch per tick) tetapi nyata.
- Catatan pengujian: ada unit test urutan (bukan race) `test/broadcast/machine.test.ts:191` ("refuses to claim while ANOTHER campaign is sending"), `:203`, dan `test/broadcast/worker.test.ts:261`. Tidak ada uji konkurensi paralel.
- Rekomendasi: tambah guard level DB yang keras — partial unique index `WHERE status='sending'` (atau advisory lock Postgres di worker) — plus uji konkurensi. Klaim Plan 4 T8 "Guard DB" sudah terpenuhi sebagai SQL statement; yang kurang adalah constraint-nya.

### F3 — Singleton admin ditegakkan secara operasional, bukan di jalur login (PRD §7.3; §12 "Hanya kelaswfa@gmail.com dapat login")
- Status: **MINOR.**
- Bukti (diverifikasi ulang):
  - `src/lib/admin/bootstrap.ts:21` memakai `env("ADMIN_EMAIL", "kelaswfa@gmail.com")` dan hanya membuat baris untuk email itu.
  - `startLogin` di `src/lib/admin/login.ts:35-54` menerima baris mana pun di `adminUsers` (baris 42), dengan dummy-hash anti-timing-enumeration yang baik (baris 24–25, 45).
  - Catatan koreksi: jalur **reset** password sudah membatasi `normalized !== adminEmail` → `{ ok: true }` generik (`src/lib/admin/login.ts:103-110`). Jadi pembatasan email ada di reset, tetapi tidak di login.
- Dampak: jika tabel `admin_users` suatu saat berisi baris kedua (mis. dibuat manual), kode tidak memblokir login-nya.
- Rekomendasi: tambah guard eksplisit di `startLogin` (tolak email selain allowlist, atau unique constraint/single-row check), atau dokumentasikan bahwa singleton dijamin prosedur deploy.

### F4 — Statistik funnel tanpa konversi visit→submit (PRD §6 "statistik funnel dasar")
- Status: **INFORMATIF / keterbatasan terdokumentasi.**
- Bukti: `src/lib/funnel.ts:33-37` (komentar eksplisit: page-view tidak pernah ditulis ke DB sehingga visit→submit tidak tersedia); `getFunnelStats` baris 38–69 menghitung dari tabel existing. Dipakai di `src/pages/admin/index.astro:13` dan ditampilkan sebagai kartu (baris 24–33, 48–60); helper halaman menyatakan "tanpa pelacakan page-view" (`admin/index.astro:39`).
- Rekomendasi: pertahankan sebagai batasan eksplisit, atau tambah event log page-view bila metrik konversi landing dibutuhkan.

### F5 — Pemetaan event webhook (terverifikasi lengkap)
- Status: **TERVERIFIKASI** (sebelumnya "belum diverifikasi").
- Bukti: `src/lib/broadcast/webhooks.ts`. `verifyEmailitSignature` HMAC-SHA256 atas raw body + timing-safe guard panjang (baris 15–24). Insert idempoten via unique `(provider_message_id, event_type)` → duplicate `"ignored"` (baris 50–60; constraint `src/lib/schema.ts:257`). Mapping `switch (event.type)`:
  - `email.delivered` → status `delivered` + `deliveredAt` coalesce (baris 72–78)
  - `email.bounced` → status `bounced` + `bouncedAt` coalesce + suppression `hard_bounce` bila email valid (baris 79–95)
  - `email.complaint` → status `suppressed` + suppression `complaint` (baris 96–110)
  - `email.failed` → status `failed`, kecuali delivery sudah terminal `delivered`/`bounced` (`isTerminal`, baris 27–29, 111–119)
  - default (tipe tak dikenal, mis. `accepted`/`email.sent`/`email.opened`) → event tetap tersimpan, delivery tidak diubah (baris 120–122)
- Tidak ada handler eksplisit untuk `accepted`; status itu berasal dari worker saat enqueue provider (`src/lib/broadcast/worker.ts:189-192`, `status: "accepted"`).
- Route `src/pages/api/webhooks/emailit.ts`: verifikasi signature sebelum parse (baris 26–30), rate limit 600 per identitas setelah HMAC (baris 42–46), selalu 200 untuk kondisi aplikatif (baris 55).
- Coverage test: `test/broadcast/webhooks.test.ts` menguji signature, delivered, duplicate→ignored, per-type unique, bounced+suppression, complaint, failed, unknown type (termasuk `email.sent`), terminal guard, coalesce.

### F6 — Personalisasi email tersamar di halaman cek-email tidak pernah terisi (`?m=` tanpa produsen)
- Status: **MINOR / dead branch.**
- Bukti: `src/pages/cek-email.astro:8-11` dan `src/pages/en/cek-email.astro:8-11` membaca `?m=` lalu `maskedEmail(raw)`; tetapi tidak ada satu pun pemanggil yang menuliskan `m=`. `cekEmailPath` di `src/pages/api/subscribe.ts:12-19,60` hanya menambahkan `?s=<slug>`/`?e=<reason>` dan notifikasi redirect. `grep -rn "?m=" src/` hanya menemukan pembaca di dua halaman cek-email (tidak ada penulis).
- Dampak: teks "Kami mengirim tautan ke {email}" selalu jatuh ke placeholder generik `"emailmu"` / `"your email"` (`cek-email.astro:11`). Bukan kebocoran (justru konservatif), tetapi personalisasi yang dimaksud tidak pernah aktif.
- Rekomendasi: hapus cabang `?m=` sebagai dead code, atau sadar-aktifkan dengan tetap mempertimbangkan anti-enumerasi (mis. hanya echo setelah submit valid pada sesi yang sama).

## Verifikasi per area (yang sudah diverifikasi ulang)

1. **Timer 30 detik server-side.** `issueTimerToken`/`verifyTimerToken` memuat `campaign_id` + nonce + `iat`; menolak `invalid`/`wrong-campaign`/`too-fast`/`expired` (`src/lib/timer.ts:19-34`). Ambang minimum 30 detik; `TEST_TIMER_MS` hanya dipakai non-prod (`timer.ts:7-15`), hasil `astro build` selalu 30 detik. Batas atas token 2 jam (`MAX_AGE_MS`, baris 5). `POST /api/timer-token` rate-limit 60/jam per IP, hanya campaign published (`src/pages/api/timer-token.ts:19,31`). Form me-render token server sebagai fallback no-JS (`src/components/EmailForm.astro:14,41`).
2. **Subscribe.** Honeypot (sukses palsu generik, `src/lib/subscribe.ts:36`), normalisasi email (baris 38), rate limit IP dan email dari env (baris 44–47), allowlist domain aktif (baris 49), tolak campaign non-published (baris 52–53), upsert kontak atomik `onConflictDoNothing` (baris 63–70), `upsertClaim` anti-duplikat `(contactId, campaignId)` (`src/lib/access.ts:12-21`). Respons POST selalu 303 generik ke cek-email dengan `Cache-Control: no-store` (`src/pages/api/subscribe.ts:31-35,60`).
3. **Double opt-in vs klaim ulang.** Kontak baru → token `confirm` 7 hari + email konfirmasi (subscribe.ts:89–100); kontak confirmed → token `access` 7 hari + email akses tanpa double opt-in ulang (subscribe.ts:73–87). Konstanta 7 hari: `src/lib/access.ts:6`. Token confirm/access sekali pakai via `UPDATE ... WHERE unused AND unexpired RETURNING`; token session reusable 1 jam (`access.ts:42-69`).
4. **Konfirmasi atomik.** `confirmContactByToken` dalam satu transaksi: konsumsi token, `confirmed`, claim `accessed`, upsert subscription `active` kecuali status `unsubscribed` (consent dihormati) (`src/lib/access.ts:71-100`, kondisi baris 89).
5. **Lifecycle campaign.** `draft`/`archived` → hidden/404 (+ redirect slug historis 301 via `resolveSlugRedirect`), `paused` → halaman ramah + tolak klaim baru, klaim lama tetap bisa diakses (`getCampaignContent` tanpa cek status) (`src/lib/campaign.ts:12-36`; `src/pages/r/[slug].astro:22-30`); `src/pages/en/r/[slug].astro:25` redirect 301 EN. Halaman `/akses` memakai `resolveAccess` → `getCampaignContent` tanpa status (`src/lib/access-page.ts:20-55`).
6. **Allowlist.** Default 9 domain sesuai PRD; cek `active=true` (`src/lib/allowlist.ts:5-15`).
7. **File.** `ALLOWED_MIME` 8 tipe + `MAX_UPLOAD_BYTES` 100 MB (`src/lib/storage.ts:4-14`); `presignDownloadUrl` 1 jam (`download.ts:7`); `resolveDownload` memvalidasi kepemilikan asset terhadap campaign claim (`src/lib/download.ts:9-27`); `resolveFeaturedImage` hanya untuk campaign published (baris 29–37); key traversal ditolak (`storage.ts:26,46`).
8. **Bilingual.** Route `/r/<slug>` + `/en/r/<slug>`, `LocaleSwitch` (`aria-current`), `canonical` + `hreflang` per locale (`src/pages/r/[slug].astro:41-54`, `src/components/LocaleSwitch.astro:17-19`), copy ID/EN di `i18n.ts`, badge/fallback EN di preview admin. Fallback konten EN→ID terverifikasi di `en/r/[slug].astro` dan `en/akses/[token].astro`.
9. **Cek-email kirim-ulang.** Query `?s=<slug>` dibawa dari `cekEmailPath` (`src/pages/api/subscribe.ts:12-19`); tombol menaut ke `/r/<s>` (`src/pages/cek-email.astro:16`) atau `/en/r/<s>` (`src/pages/en/cek-email.astro:16`), fallback `/`.
10. **Sitemap.** Hanya `published AND indexable`, dua URL per slug, escape XML; header cache `public, max-age=3600` (`src/pages/api/sitemap.xml.ts:33,48-54`; test `test/sitemap.test.ts:39`). **Koreksi:** `lastmod` = `publishedAt ?? createdAt` (baris 29–38), bukan `updatedAt ?? publishedAt`.
11. **Broadcast konten/segmentasi.** Filter tervalidasi (`all`/locale/claim IDs + `claimMode` ANY/ALL wajib bila ada claim IDs — `src/lib/broadcast/audience.ts:28-73`); eksklusi selalu: belum confirmed, subscription tidak active, suppression match, unsubscribe (`audience.ts:76-120`). **Koreksi atribusi:** fallback "locale tak dikenal → ID" ada di `selectedLocale` (`audience.ts:126-129`), bukan di worker; worker hanya memilih locale baris `en`/`id` (`worker.ts:154`).
12. **Snapshot.** Render-at-snapshot; baris recipient membawa HTML final + token klik/unsubscribe per recipient; `onConflictDoNothing` mempertahankan token/html lama sehingga subscriber belakangan tidak ikut (`src/lib/broadcast/snapshot.ts:68-135`, khusus baris 123–127).
13. **State machine.** `draft → scheduled/queued → sending → completed`, cabang `paused`/`cancelled`/`failed`; schedule hanya dari draft (baris 89); `scheduledAt` masa lalu ditolak (baris 112); audit `campaign_scheduled` (baris 122) / `campaign_sent` (baris 184) (`src/lib/broadcast/machine.ts`). Schema statuses `src/lib/schema.ts:202`.
14. **Worker.** Satu batch per tick (budget `maxPerMinute`/`maxPerHour`, `src/lib/broadcast/worker.ts:117-147`), tidak menyentuh `email_outbox` (prioritas transaksional terpisah secara jalur, komentar baris 26–29), limit provider dari env (`EMAILIT_MAX_PER_SECOND` default 2, `EMAILIT_MAX_PER_DAY` default 5000 — `machine.ts:27-36`), `validateLimits` menolak non-positif dan throughput melebihi kapasitas (`machine.ts:45-60`). Cron `src/pages/api/cron/broadcast.ts:13-19`.
15. **Test-send.** Hanya ke `TEST_SEND_ADDRESSES` (default `kelaswfa@gmail.com`), prefix `[TEST]`, `emailType broadcast_test`, tanpa baris recipients/deliveries, unsubscribe `test-not-linked` (`src/lib/broadcast/stats.ts:256-313`). Endpoint `src/pages/admin/api/email-campaigns/[id]/test-send.ts`.
16. **Retry/resend gagal.** Throttle 3/jam per campaign, `failed → pending`, campaign completed/failed → queued, audit `campaign_retry_failed` (`stats.ts:168-235`). Endpoint `.../retry-failed.ts`.
17. **Unsubscribe.** Satu klik via hash token, idempoten dalam transaksi (sudah unsubscribed → no-op sukses), menulis suppression + consent event (`src/lib/broadcast/unsubscribe.ts:41-75`); route `src/pages/api/unsubscribe/[token].ts`.
18. **Click tracking.** Hanya `https` (`content.ts:171`, `snapshot.ts:9`), `linkId` UUID-guarded, token dicocokkan ke hash, recipient harus satu campaign dengan link, `clickedAt` coalesce (klik pertama menang) (`src/lib/broadcast/links.ts:19-40`).
19. **Tanpa open pixel.** Tidak ditemukan pixel; laporan menyatakan tanpa open rate (`stats.ts:12-25`).
20. **CSV kontak.** Kolom hanya email, locale, status konfirmasi, status marketing, tanggal, claim slugs; tanpa token/IP/rahasia; ter-audit `contacts_exported` (`src/lib/admin/contacts.ts:244-266`); endpoint `src/pages/admin/api/contacts/export.ts` (text/csv attachment).
21. **Auth admin.** Password Argon2id (`src/lib/admin/password.ts`; verifikasi dummy-hash anti-enumerasi `login.ts:24-25,45`), OTP **terverifikasi**: 6 digit `randomInt`, hashed `hashToken`, TTL 10 menit, maksimum 5 percobaan, konsumsi atomik di `WHERE` (`src/lib/admin/otp.ts:9-10,19-25,37-60`). Rotasi sesi saat login (`login.ts:69`), trusted device 30 hari + revocable (`src/lib/admin/devices.ts:6,14`), reset password hanya untuk `ADMIN_EMAIL` (`login.ts:103-110`).

## Yang belum diuji pada tahap ini (bukan temuan, dicatat agar tidak diklaim)

- **Sudah diuji / terverifikasi pada revisi ini:**
  - Suite unit/integrasi `npm test` (vitest): 49 file / 326 test hijau (~66s, dilaporkan lead; tidak dijalankan auditor). Mencakup subscribe, timer, access, download, allowlist, sitemap (termasuk header cache), lifecycle, funnel, webhook mapping, machine/worker (urutan), unsubscribe/resubscribe, OTP, reset, devices, contacts.
  - Detail OTP, password reset, dan pemetaan webhook: sudah dibaca baris-per-baris dan didokumentasikan (F5, area 21).
  - Header cache sitemap dan konfirmasi eksplisit pra-kirim di UI `email-campaigns/[id].astro`: terverifikasi (modal review `[id].astro:283-297`; header cache `sitemap.xml.ts:53`).
- **Benar-benar belum diuji:**
  - Eksekusi runtime dengan DB sungguhan via Playwright (`npm run test:e2e`, terpisah dari `npm test`): spec tersedia — `test/e2e/funnel.spec.ts`, `test/e2e/launch.spec.ts`, `test/broadcast/e2e/broadcast.spec.ts`, `test/admin/e2e/admin.spec.ts`, `test/admin/e2e/dashboard.spec.ts` — tetapi tidak dijalankan pada audit ini (dilarang oleh aturan; tidak termasuk `npm test`).
  - Uji konkurensi paralel untuk invariant single-`sending` (F2): hanya ada uji urutan.
  - Verifikasi runtime kontak unsubscribe yang claim reward baru (apakah UI benar-benar menampilkan persetujuan re-subscribe di form klaim) — tidak ada spec yang menutup skenario ini.

## Rekomendasi prioritas

1. Putuskan desain consent re-subscribe di form klaim (F1) sebelum launch.
2. Tambah constraint DB keras untuk single-`sending` (partial unique index `WHERE status='sending'` atau advisory lock) dan uji race (F2); guard SQL statement-nya sudah ada.
3. Dokumentasikan/tegakkan singleton admin di kode (khusus `startLogin`) atau prosedur deploy (F3).
4. Bersihkan atau aktifkan cabang `?m=` yang dead di halaman cek-email (F6).

## Catatan revisi audit ulang

Semua klaim lama diverifikasi ulang terhadap kode saat ini (HEAD `f8526f0`). Ringkasan klaim lama → hasil verifikasi → tindakan:

| Klaim lama | Hasil verifikasi | Tindakan |
|---|---|---|
| F2: guard single-`sending` "hanya level aplikasi, bukan constraint DB" | **Salah.** `claimForSending` memakai satu statement `UPDATE ... WHERE status='queued' AND NOT EXISTS(...)` — guard SQL/level-DB dan atomik (`src/lib/broadcast/machine.ts:144-153`, commit `01e727b`). Yang benar: belum ada partial unique index; `grep "sending" drizzle/*.sql` = 0 (0000–0003) | F2 ditulis ulang: guard SQL statement sudah ada; sisa risiko = race dua UPDATE konkuren berbeda campaign di bawah READ COMMITTED |
| F2 merekomendasikan "tambah guard level DB" | Sebagian sudah terpenuhi (SQL statement); yang belum = constraint keras + uji race | Rekomendasi dipertajam: partial unique index/advisory lock + uji konkurensi |
| F5: "mapping accepted/failed belum diverifikasi" | **Terverifikasi lengkap.** `switch` menangani delivered/bounced/complaint/failed + default; tidak ada handler `accepted` (`webhooks.ts:72,79,96,111,120`) | F5 dinaikkan ke TERVERIFIKASI dengan daftar file:line |
| Area 10: `lastmod` = `updatedAt ?? publishedAt` | **Salah.** Aktual `publishedAt ?? createdAt`; `updatedAt` tidak di-select (`src/pages/api/sitemap.xml.ts:29-38`) | Dikoreksi |
| Area 10: "header cache sitemap belum dibaca" | **Terverifikasi** `public, max-age=3600` (`sitemap.xml.ts:53`; `test/sitemap.test.ts:39`) | Dipindah ke area terverifikasi; dihapus dari "belum diuji" |
| Area 11: "Locale tak dikenal → ID (komentar worker)" | **Atribusi salah.** Logika di `selectedLocale` (`audience.ts:126-129`), bukan worker | Dikoreksi atribusi |
| Area 20: OTP "detail tidak dibaca baris-per-baris" | **Terverifikasi**: 10 menit, 5 percobaan, hashed, konsumsi atomik (`src/lib/admin/otp.ts:9-10,37-60`) | Dikoreksi menjadi terverifikasi |
| F3: `startLogin` "menerima baris mana pun di adminUsers" | **Benar untuk login**, tetapi jalur reset sudah membatasi `ADMIN_EMAIL` (`login.ts:103-110`) | F3 dipersempit agar akurat |
| "Yang belum diuji": runtime e2e, OTP, webhook, sitemap header | **Sebagian kini terverifikasi**; spec Playwright ada tetapi tidak dijalankan (`test/e2e/*.spec.ts`, `test/broadcast/e2e/*.spec.ts`, `test/admin/e2e/*.spec.ts`) | Bagian belum-diuji ditulis ulang: pisahkan yang sudah terverifikasi vs benar-benar belum |
| Label akhir "Verdict tahap 1" | Format tidak sesuai nomor file | Diganti "Verdict audit 01" |
| F1 (consent re-subscribe) | **Masih valid.** EmailForm/i18n tidak punya cabang consent; re-subscribe hanya via `/subscribe-again/<token>` + `resubscribeByToken` | Dipertahankan, bukti file:line diperkuat |
| F4 (funnel visit→submit) | **Masih valid** (`funnel.ts:33-37`) | Dipertahankan |

Verifikasi recon tambahan (bukan klaim di laporan, untuk kelengkapan):
- `href="/"` ada 9 kemunculan di `src/` — root page **tidak orphan** (mis. `src/components/CampaignPaused.astro:28`, `src/pages/r/[slug].astro:60`, `src/pages/subscribe-again/[token].astro:24,32`). Laporan tidak pernah menyebut orphan; tidak ada perubahan.
- `src/pages/index.astro` masih stub 9 baris (scaffold `5af00b4`); tidak relevan fungsional-core.
- `#ffffff` hardcoded di `src/`: 9 kemunculan; `src/lib/notfound.ts` dan `src/lib/templates.ts` adalah dokumen HTML mandiri/email sehingga hardcoded wajar. Tidak diangkat sebagai temuan fungsional.
- `src/pages/akses/[token].astro:13` dan `src/pages/en/akses/[token].astro:13` sama-sama `Astro.redirect("/", 303)` untuk token invalid — terkonfirmasi.
- Temuan baru F6 (`?m=` tanpa produsen) ditambahkan dari revisi ini.
