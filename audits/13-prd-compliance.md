# Audit 13 — PRD Compliance (audit akhir)

Tanggal: 2026-09-14
Lingkup: apa yang diminta PRD v2 (`.agents/kelaswfa-newsletter-prd-v2.md`, 610 baris) vs apa yang dibuat — §6 ruang lingkup, §7 fungsional, §8 model data, §9 arsitektur, §10 keamanan/privasi/reliability, §11 a11y/perf/SEO, §12 acceptance criteria.
Metode: read-only (verifikasi ulang mandiri setiap klaim + 12 laporan tahap 01–12). Tidak ada perubahan kode. Tidak ada `npm test`/`build`/Playwright/Docker/DB/server yang dijalankan (aturan tugas); nomor baris diverifikasi ulang, termasuk `grep` checkbox §12, `grep` scope creep, dan pembacaan langsung `package.json`/`package-lock.json`/`Dockerfile`/`vercel.json`/`docs/deploy.md`/`astro.config.mjs`.

## Keputusan akhir audit 13: GO BERSYARAT

Kode **memenuhi PRD secara substansial**: arsitektur sesuai §9 (Astro SSR + Node + Neon + Drizzle + R2 + Emailit + outbox Postgres + cron), model data sesuai §8, nol scope creep §6 (multi-admin/role, drip/automation, A/B, open pixel, WYSIWYG, payment, video, app native — semua tidak ditemukan di kode; hasil `grep` read-only).

§12 **berisi 25 checkbox, bukan 28** (koreksi aritmetika besar — lihat catatan revisi). Rincian: **20 checkbox terverifikasi penuh di kode, 3 terverifikasi sebagian di kode, 2 pekerjaan operator pra-launch** (verifikasi SPF/DKIM/DMARC dan drill restore backup). Audit lama menulis "26 dari 28"; angka itu tidak cocok bahkan dengan penjumlahan seksi di laporannya sendiri (7+5+8+5 = 25).

Verdict tetap **GO BERSYARAT**, dengan nol temuan yang membatalkan PRD, tetapi sekarang dengan **dua blocker ops yang terverifikasi** (bukan satu): `10-DEP1`/`12-DOC4` (migrasi/bootstrap gagal di image runtime Easypanel) dan `10-DEP4`/`12-DOC2` (target Vercel didokumentasikan detail tetapi adapter `@astrojs/vercel` tidak ada sehingga tidak fungsional apa adanya). Dua blocker ini saling duplikat antar-tahap dan hanya memblokir *cara deploy yang didokumentasikan*, bukan kode aplikasi.

## Syarat launch (revisi, 10 item urut prioritas)

| # | Item | Sumber | Usaha |
|---|------|--------|-------|
| 1 | Perbaiki jalur migrasi/seed/bootstrap: pindahkan `tsx`+`dotenv` ke `dependencies` **dan** tambah `COPY --from=build /app/src ./src`, ATAU ubah `docs/deploy.md` B5 agar migrasi dari lokal (meniru C3) | 10-DEP1 = 12-DOC4 | Satu keputusan + beberapa baris |
| 2 | Putuskan target Vercel: tambah `@astrojs/vercel` + langkah C1b ganti adapter, ATAU tandai Vercel "belum didukung" | 10-DEP4 = 12-DOC2 | Satu keputusan |
| 3 | Tambah `typescript` + `@astrojs/check` + script `check` (tanpa ini **tidak ada type-check otomatis** di dev maupun CI) | 03-C4 | Satu dependency + script |
| 4 | Tutup celah race single-`sending`: partial unique index `WHERE status='sending'` atau advisory lock + uji konkurensi | 04-A1 = 01-F2 | Satu migrasi + satu test |
| 5 | Putuskan nasib `/` (root): redirect ke campaign utama, landing sungguhan, atau minimal `noindex` + CTA | 11-C1 = 02-U4 | Satu keputusan |
| 6 | Satukan ekstraksi IP admin ke `clientIp()`; hapus `x-forwarded-for.split(",")[0]` di route admin (`otp.ts`, `password/request.ts`, dst.) | 05-S4 | Beberapa baris |
| 7 | Tutup AC §12 yang belum harfiah: persetujuan re-subscribe di form klaim (01-F1) dan/atau drain outbox di awal tick broadcast (04-N3) | 01-F1, 04-N3 | Satu cabang UI / satu guard |
| 8 | Verifikasi SPF/DKIM/DMARC domain pengirim + test-send lintas mailbox | PRD §12 (PRD:560), runbook | Operator, ±1 jam |
| 9 | Jalankan drill restore PITR Neon | PRD §12 (PRD:561), runbook | Operator, ±30 mnt |
| 10 | Tambah index jalur panas (07-N1), guard UUID path param (08-N2), guard singleton login (01-F3); samakan keputusan Neon pooled/direct (12-DOC1) | 07-N1, 08-N2, 01-F3, 12-DOC1 | Backlog ringan |

## §12 Acceptance criteria — hasil verifikasi

**Total checkbox §12: 25** (`grep "^\- \[ \]" .agents/kelaswfa-newsletter-prd-v2.md` → 25 baris, `:528-561`). Ringkasan: 20 penuh di kode + 3 sebagian di kode + 2 operator.

### Funnel dan contact (7 checkbox: 6 penuh, 1 sebagian)
- Visitor tidak dapat submit sebelum token timer 30 detik — **YA** (`DEFAULT_MIN_AGE_MS = 30_000`, HMAC, `MAX_AGE_MS` 2 jam; `src/lib/timer.ts:4-5,31-32`; PRD:528).
- Satu baris `CONTACT` walau multi-claim — **YA** (`email_normalized` unik `src/lib/schema.ts:5`; upsert `onConflictDoNothing` `src/lib/subscribe.ts:63-67`; PRD:529).
- Double opt-in mengaktifkan marketing — **YA** (`src/lib/subscribe.ts:89-100`; `src/lib/access.ts:71-100`; PRD:530).
- Klaim lanjutan tanpa opt-in ulang — **YA** (`src/lib/subscribe.ts:73-87`; PRD:531).
- Tanpa claim duplikat — **YA** (`claim_contact_campaign_uq` `src/lib/schema.ts:72`; `src/lib/access.ts:12-21`; PRD:532).
- Unsubscribe menghentikan broadcast, bukan email akses — **YA** (status marketing terpisah; `src/lib/broadcast/unsubscribe.ts:48-50`; `src/lib/access.ts:89`; PRD:533).
- Re-subscribe eksplisit + terkonfirmasi — **SEBAGIAN** (`src/pages/subscribe-again/[token].astro` + `resubscribeByToken` `src/lib/broadcast/unsubscribe.ts:86-113` ada dan benar, tetapi **form klaim tidak menampilkan persetujuan re-subscribe** — `src/components/EmailForm.astro:23,68` hanya copy generik; PRD:534). Ini `01-F1`, satu-satunya checkbox funnel yang belum penuh.

### Asset dan akses (5 checkbox: 5 penuh)
- Upload hingga 100 MB — **YA** (8 MIME allowlist + `MAX_UPLOAD_BYTES = 100 MB`, `src/lib/storage.ts:4-14`; `src/lib/admin/assets.ts:21-45`; PRD:538).
- Key/URL permanen tersembunyi — **YA** (bucket privat + signed URL; `src/pages/api/image/[...key].ts:11` 302 ke presigned, bukan key permanen; PRD:539).
- Token akses 7 hari sekali pakai — **YA** (`SEVEN_DAYS_MS` `src/lib/access.ts:6`; konsumsi atomik `UPDATE ... WHERE usedAt IS NULL` `src/lib/access.ts:42-69`; PRD:540).
- Download URL 1 jam — **YA** (`DOWNLOAD_URL_TTL_SEC = 3600`, `src/lib/download.ts:7`; PRD:541).
- Paused/archived menolak klaim baru, akses lama valid — **YA** (`src/lib/campaign.ts:12-36`; `src/lib/access-page.ts:20-55`; PRD:542).

### Broadcast (8 checkbox: 7 penuh, 1 sebagian)
- Draft/test-send/schedule/send-now/pause/resume/cancel — **YA** (`src/lib/broadcast/machine.ts`; endpoint `src/pages/admin/api/email-campaigns/[id]/`; PRD:546).
- Snapshot frozen — **YA** (`onConflictDoNothing` mempertahankan token/html lama; `src/lib/broadcast/snapshot.ts:68-135`; PRD:547).
- Filter ANY/ALL — **YA** (`AudienceClaimMode`, `src/lib/broadcast/audience.ts:28-73`; PRD:548).
- Single sending — **YA** (`claimForSending` atomik satu statement `src/lib/broadcast/machine.ts:144-153`; sisa race `04-A1`/`01-F2`; PRD:549).
- Limit per-campaign ≤ kapasitas provider — **YA** (`maxPerMinute/maxPerHour` + `validateLimits` `src/lib/broadcast/machine.ts:27-60`; PRD:550).
- **Email transaksional diproses sebelum worker mengambil broadcast berikutnya — SEBAGIAN (`04-N3`).** Outbox dan broadcast adalah **dua cron independen** (`vercel.json:2-5`, keduanya `* * * * *`); `processOutbox` tidak dipanggil di tick broadcast, dan `worker.ts` tidak menyentuh `email_outbox`. Semangat prioritas terpenuhi secara struktural (jalur terpisah + drain best-effort di `src/lib/subscribe.ts:85,99`), tetapi "diproses sebelum" harfiah tidak ditegakkan sebagai ordering. PRD:551.
- Unsubscribe link + tanpa open pixel — **YA** (link wajib per recipient; tanpa pixel, `src/lib/broadcast/stats.ts:12-25`; PRD:552).
- Delivery/bounce/unsub/click idempoten — **YA** (unique `(provider_message_id, event_type)` `src/lib/schema.ts:257`; `src/lib/broadcast/webhooks.ts:50-60`; PRD:553).

### Admin dan operasi (5 checkbox: 3 di kode [1 dengan catatan], 2 operator)
- Hanya `kelaswfa@gmail.com` dapat login; password + OTP — **YA dengan catatan `01-F3`** (`ensureAdmin` hanya membuat baris untuk `env("ADMIN_EMAIL", "kelaswfa@gmail.com")` di `src/lib/admin/bootstrap.ts:21`, dan OTP 6 digit hashed + cap 5 percobaan atomik `src/lib/admin/otp.ts:9-10,42-63`; tetapi `startLogin` menerima baris `admin_users` mana pun `src/lib/admin/login.ts:35-54` — singleton ditegakkan operasional, bukan di jalur login). PRD:557.
- Trusted device 30 hari + revocable — **YA** (`THIRTY_DAYS_MS` `src/lib/admin/devices.ts:6`; `revokeTrustedDevice`/`revokeAllSessions`; PRD:558).
- Audit log — **YA** (`admin_audit_log` + `src/lib/admin/audit.ts` + halaman viewer; PRD:559).
- SPF/DKIM/DMARC — **OPERATOR** (prosedur + checklist ada di `docs/operations.md` §2; eksekusi milik peluncuran; PRD:560).
- Backup/restore diuji — **OPERATOR** (prosedur drill ada di `docs/operations.md` §3; eksekusi milik peluncuran; PRD:561).

## Ruang lingkup §6 — tidak ada scope creep (diverifikasi grep)

Yang dilarang — hasil `grep -riE` di `src/` + `scripts/`:
- Payment/e-commerce (`payment|stripe|midtrans|ecommerce`) = **0**.
- Automation/drip/recurring (`drip|automation|recurring`) = **0**.
- A/B test (`\bA/B\b|abtest`) = **0**.
- Open tracking pixel (`open.?pixel|tracking.?pixel`) = **0**.
- WYSIWYG/drag-drop (`wysiwyg|drag.?and.?drop`) = **0**.
- Hosting video (`video`) = **0**; aplikasi native (`react-native|native app`) = **0**.
- Multi-admin/role/permission/invite (`multi-admin|permission|invite.?admin`) = **0**; `role` = 29 kemunculan, **semuanya atribut ARIA/HTML** (nol RBAC — diverifikasi dengan exclude `role=`/`aria`).

Yang diwajibkan — ada: landing bilingual ID/EN (`src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`, `src/pages/en/*`), timer server-side, double opt-in, upload 100 MB, dashboard satu admin, broadcast satu-kali, Emailit, auth password+OTP+device, SEO dasar (`src/pages/api/sitemap.xml.ts`), a11y (`src/styles/tokens.css`), observabilitas (health + audit), backup (prosedur runbook).

## Temuan lintas 13 tahap (register final)

Register versi lama **rusak**: memuat ID yang tidak ada di file yang dirujuk (`S6` "custody copy", `S2` "OTP wording", `U1` "timer pollution", `U5` "domain wording"). Register di bawah hanya memakai ID yang benar-benar ada di `audits/01`–`audits/12`, diberi prefix tahap karena banyak ID bertabrakan antar-file (mis. `A1` di 04 vs tidak di 01; `N1` ada di 04, 07, dan 08; `C1` ada di 03 dan 11).

### Blocker ops (2, duplikat lintas tahap)
- **10-DEP1 = 12-DOC4** — Script migrasi/seed/bootstrap tidak bisa jalan di image runtime: `Dockerfile:25` (`npm prune --omit=dev`) menghapus `tsx`+`dotenv`, dan `Dockerfile:32-36` **tidak** meng-`COPY` `src/`, padahal semua script mengimpor `../src/lib/*` (`scripts/seed.ts:1,5`; `scripts/migrate.ts:1,3`; `scripts/bootstrap-admin.ts:1,2`). `docs/deploy.md:172-173` justru salah klaim "`tsx` dan `drizzle/` sudah ikut di dalam image". Status **UTAMA** (memblokir langkah B5 Easypanel). Bukti: `audits/10-build-deployment.md:21-33`, `audits/12-documentation.md:31-39`.
- **10-DEP4 = 12-DOC2** — Target Vercel didokumentasikan (`README.md:75-114`, `docs/deploy.md:235-306`) tetapi adapter `@astrojs/vercel` **0 kemunculan** di `package.json`/`package-lock.json`; adapter aktif `@astrojs/node` (`astro.config.mjs:5,13-15`, `package.json:21`) menghasilkan output node-standalone, bukan Vercel Build Output. Status **UTAMA** (target deploy kedua tidak fungsional apa adanya). Bukti: `audits/10-build-deployment.md:35-42`, `audits/12-documentation.md:21-29`.

### Utama
- **04-A1 = 01-F2** — Invariant single-`sending` sudah **SQL/level-DB dan atomik satu statement** (`src/lib/broadcast/machine.ts:144-153`, klausa `NOT EXISTS` di `:150`), tetapi **belum ada partial unique index** (`grep "sending" drizzle/*.sql` = 0) sehingga dua `UPDATE` konkuren pada dua campaign berbeda bisa sama-sama lolos di READ COMMITTED. Bukti: `audits/04-architecture.md:18-27`, `audits/01-functional-correctness.md:34-42`.
- **03-C4** — `typescript` dan `@astrojs/check` dua-duanya tidak terpasang, dan `package.json:10` adalah `"build": "astro build"` polos → **tidak ada type-check otomatis** di build, dev, maupun CI. Severity dinaikkan dari minor. Bukti: `audits/03-code-quality.md:32-36`.
- **03-C1** — Tidak ada linter/formatter (`eslint*`/`biome*`/`prettier*` nol di root; `package.json:8-17` tanpa script `lint`/`format`). Bukti: `audits/03-code-quality.md:16-19`.
- **02-U2 = 08-B2** — Tidak ada loading state/disable pada submit klaim publik (`src/components/EmailForm.astro:145-147` hanya guard token kosong); double submit tanpa JS tetap mungkin (server idempoten). Bukti: `audits/02-ui-ux-quality.md:22-27`, `audits/08-bug-edge-cases.md:26-32`.
- **11-C1 = 02-U4** — Halaman root `/` stub 9 baris (`src/pages/index.astro:1-9`), **indexable** (`noindex` default `false`, `src/layouts/PublicLayout.astro:25`), tidak ada di sitemap. **Koreksi penting:** klaim "orphan / nol `href="/"`" **SALAH** — `href="/"` muncul 10 kali (lihat `audits/02-ui-ux-quality.md:45-50`). Bukti: `audits/11-code-completeness.md:16-23`, `audits/02-ui-ux-quality.md:45-50`.
- **06-A11y1** — Badge gold `#D99020` di atas gold-subtle `#FFF2D6` = **2,38:1** (gagal AA), kini dipersempit ke **satu lokasi**: `src/pages/admin/campaigns/[id].astro:401-403`. Dua badge lain memakai warning dan lulus 4,53:1. Bukti: `audits/06-accessibility.md:16-23`.
- **06-A11y2** — Token muted `#6C7E79` = 4,29:1 di putih / 4,18:1 di kanvas / 3,81:1 di surface-subtle (gagal AA normal), dipakai di permukaan publik termasuk copy consent form klaim (`src/components/EmailForm.astro:67`), privacy (`src/pages/privacy.astro:9`), 404 (`src/lib/notfound.ts:42`). Bukti: `audits/06-accessibility.md:25-41`.
- **01-F1** — Persetujuan re-subscribe eksplisit tidak ada di form klaim (hanya jalur terpisah `/subscribe-again/<token>`); gap kepatuhan UX, bukan kebocoran consent. Bukti: `audits/01-functional-correctness.md:24-32`.
- **04-N3** — Tidak ada ordering literal untuk prioritas transaksional AC §12 (dua cron independen). Bukti: `audits/04-architecture.md:63-71`.
- **04-N1** — Klaim "tidak ada SQL di pages" salah: 13 file `src/pages/` mengimpor `db`/`drizzle-orm`, termasuk SQL mentah (`src/pages/api/health.ts:10`). Bukti: `audits/04-architecture.md:51-55`.
- **07-N1** — Index belum ada pada tabel jalur panas yang tumbuh (`email_deliveries.campaign_recipient_id/contact_id/sent_at/email_type`, `email_outbox(status, scheduled_at)`, `email_campaigns.status`, `consent_event.contact_id`, `admin_audit_log.created_at`). Bukti: `audits/07-performance.md:48-61`.
- **05-S4** — Parsing `X-Forwarded-For` tidak konsisten: helper mengambil hop **terakhir** (`src/lib/ip.ts:14-18`) tetapi banyak route admin mengambil hop **pertama** (`src/pages/admin/api/otp.ts:34`; `src/pages/admin/api/password/request.ts:26`; dst.) → `ipHash` audit bisa dipalsukan dan rate limit reset per-IP bisa dilewati. Bukti: `audits/05-security.md:43-47`.
- **08-N2** — Path param non-UUID tanpa guard sebelum query kolom `uuid` (`src/lib/download.ts:19`; `src/lib/admin/assets.ts:110`; `src/lib/admin/contacts.ts:280`) → Postgres invalid-uuid → 500, bukan 403/404. Bukti: `audits/08-bug-edge-cases.md:40-48`.

### Minor
- 01-F3 singleton admin tidak ditegakkan di `startLogin` (`src/lib/admin/login.ts:35-54`; reset sudah dibatasi `:103-110`). `audits/01-functional-correctness.md:44-51`.
- 01-F6 cabang `?m=` di cek-email tanpa produsen (dead branch) (`src/pages/cek-email.astro:8-11`). `audits/01-functional-correctness.md:70-74`.
- 02-U1 header reward 64px di semua breakpoint (`src/pages/r/[slug].astro:58`; DESIGN 72px desktop). `audits/02-ui-ux-quality.md:16-20`.
- 02-U3 `#ffffff` hardcoded 6 kemunculan di dokumen ber-token. `audits/02-ui-ux-quality.md:29-43`.
- 02-U5 navigasi admin mobile tanpa drawer (`src/layouts/AdminLayout.astro:102-121`). `audits/02-ui-ux-quality.md:52-55`.
- 02-U6 token `--page-shell`/`--space-10` tak terpakai (`src/styles/tokens.css:61,44`). `audits/02-ui-ux-quality.md:57-62`.
- 02-U7 status page tanpa ikon/cooldown/empty state asset. `audits/02-ui-ux-quality.md:64-68`.
- 02-U8 target sentuh admin 36px (`src/pages/admin/domains.astro:126`; `src/pages/admin/contacts/index.astro:249,262`). `audits/02-ui-ux-quality.md:70-74`. (Catatan silang: 06 menilai target 36px "dapat diterima, bukan temuan" — `audits/06-accessibility.md:74`; perbedaan penilaian dicatat apa adanya.)
- 02-U9 `#form-error` tidak pernah diisi + tanpa `aria-describedby` (`src/components/EmailForm.astro:65`). `audits/02-ui-ux-quality.md:76-80`.
- 02-U10 badge fallback `role=status` hanya di preview (`src/pages/admin/preview/[id].astro:85`). `audits/02-ui-ux-quality.md:82-85`.
- 03-C2 tiga file editor admin besar 999/876/623 baris. `audits/03-code-quality.md:21-25`.
- 03-C3 `as any` ganda di `src/lib/funnel.ts:28-29`. `audits/03-code-quality.md:27-30`.
- 04-A2 pool `max: 5` tanpa catatan kapasitas (`src/lib/db.ts:4`). `audits/04-architecture.md:29-34`.
- 04-A3 kolom status `varchar` tanpa CHECK/enum (`src/lib/schema.ts:7,15,31,69,113,202,224,237`). `audits/04-architecture.md:36-49`.
- 04-N2 HTML di lib selain `templates.ts` (`src/lib/notfound.ts:10-80`; `src/lib/broadcast/content.ts:175`). `audits/04-architecture.md:57-61`.
- 04-N4 cakupan transaksi anonimisasi tidak seluruh sekuen (`src/lib/admin/contacts.ts:281-300`). `audits/04-architecture.md:73-77`.
- 05-S1 tanpa proteksi CSRF eksplisit (bertumpu `SameSite=Lax`, `src/lib/admin/sessions.ts:11`). `audits/05-security.md:23-28`.
- 05-S2 cron/webhook bertumpu shared secret; perbandingan cron `===` non-timing-safe. `audits/05-security.md:30-35`.
- 05-S3 `TEST_TIMER_MS` dibaca runtime (produksi aman guard PROD, `src/lib/timer.ts:10-15`). `audits/05-security.md:37-41`.
- 06-A11y3 link info `#2D87B8` 3,99:1 (`src/components/EmailForm.astro:68`). `audits/06-accessibility.md:43-47`.
- 06-A11y5 tidak ada skip link. `audits/06-accessibility.md:54-57`.
- 07-P1 halaman reward fetch campaign dua kali (~6 query, redundansi ~17%). `audits/07-performance.md:18-23`.
- 07-P2 tanpa `Cache-Control` publik pada reward HTML + redirect gambar (sitemap **sudah** punya, `src/pages/api/sitemap.xml.ts:53`). `audits/07-performance.md:25-33`.
- 07-P3 laporan ~10 query serial; `progressOf` duplikat (=07-N2). `audits/07-performance.md:35-46,63-64`.
- 07-N3 `/api/timer-token` menambah 1 request + 2 operasi DB per kunjungan reward. `audits/07-performance.md:66-70`.
- 08-B1 tanpa timeout pada fetch Emailit (`src/lib/emailit.ts:14`) dan R2 PUT (`src/lib/storage.ts:41`). `audits/08-bug-edge-cases.md:19-24`.
- 08-N1 `ensureAdmin` select-then-insert tanpa `onConflictDoNothing` (`src/lib/admin/bootstrap.ts:22-35`). `audits/08-bug-edge-cases.md:34-38`.
- 08-N3 `resubscribeByToken` tidak idempoten terhadap event consent (`src/lib/broadcast/unsubscribe.ts:96-110`). `audits/08-bug-edge-cases.md:50-54`.
- 08-N4 `changeSlug` check-then-act (`src/lib/admin/campaigns.ts:120-132`). `audits/08-bug-edge-cases.md:56-60`.
- 08-N5 tanpa batas ukuran body JSON eksplisit (hanya route upload pre-check `Content-Length`). `audits/08-bug-edge-cases.md:62-66`.
- 09-D1 4 vuln moderat via rantai `drizzle-kit` (dev-only; `npm audit --omit=dev` = 0). `audits/09-dependency-quality.md:16-21`.
- 09-D2 dua paket transitif deprecated (`@esbuild-kit/*`). `audits/09-dependency-quality.md:23-26`.
- 09-D3 duplikasi 3 versi `esbuild`. `audits/09-dependency-quality.md:28-31`.
- 09-D4 tanpa Dependabot/Renovate. `audits/09-dependency-quality.md:33-35`.
- 09-D6 `tsx`/`dotenv` ter-prune tetapi `scripts/` disalin (berkaitan 10-DEP1). `audits/09-dependency-quality.md:41-44`.
- 10-DEP2 tidak ada CI. `audits/10-build-deployment.md:44-47`.
- 10-DEP3 seed tanpa guard `NODE_ENV=production`. `audits/10-build-deployment.md:49-53`.
- 12-DOC1 README vs deploy.md bertentangan soal Neon pooled/direct. `audits/12-documentation.md:14-19`.
- 12-DOC5 `docs/operations.md` berasumsi Vercel/Neon, tidak selaras target Easypanel. `audits/12-documentation.md:46-50`.

### Trivial
- 05-S5 `contacts.unsubscribeTokenHash` kolom mati (`src/lib/schema.ts:9`) + `ADMIN_PASSWORD` via `process.env` melewati `env()` (`src/lib/admin/bootstrap.ts:33`). `audits/05-security.md:49-53`.
- 12-DOC3 `TEST_SEND_ADDRESSES` tak terdokumentasi di README/deploy/operations (hanya `.env.example` + kode). `audits/12-documentation.md:41-44`.
- 12-DOC6 angka E2E README salah (9 test/5 berkas, bukan 5 test). `audits/12-documentation.md:52-55`.
- 01-F4 statistik funnel tanpa visit→submit (batasan terdokumentasi, `src/lib/funnel.ts:33-37`). `audits/01-functional-correctness.md:53-56`.

### Dibatalkan / dikoreksi (bukan temuan aktif)
- **06-A11y6 DICABUT** — ada aturan global `:focus-visible { box-shadow: var(--focus-ring) }` di `src/styles/tokens.css:72` yang berlaku ke permukaan publik. `audits/06-accessibility.md:59-62`.
- **11-C1 sub-klaim "orphan" DIKOREKSI** — `href="/"` ada 10 kemunculan; root tidak orphan (tetap stub + indexable + tidak di sitemap). `audits/02-ui-ux-quality.md:48`.
- **02-U4 "orphan" DIKOREKSI** (sama). Register lama juga menyebut `U4` sebagai "verifikasi" bukan temuan.
- **01-F2 "hanya level aplikasi" DIKOREKSI** — guard single-sending sudah SQL/level-DB atomik; sisa = absennya partial unique index.
- **02-U2 "login/OTP menampilkan Memproses…" DIKOREKSI** — string tidak ada; yang benar disable tombol + `cursor: wait`.

### Skor tahap (konsisten dengan verdict tiap file)
| Tahap | Verdict | Temuan kunci |
|---|---|---|
| 01 Functional Correctness | LULUS BERSYARAT | 01-F1, 01-F2/04-A1 |
| 02 UI/UX Quality | LULUS BERSYARAT | 02-U2, 02-U1, 02-U4/11-C1 |
| 03 Code Quality | LULUS | 03-C1, 03-C4 |
| 04 Architecture | LULUS BERSYARAT | 04-A1, 04-N1, 04-N3 |
| 05 Security | LULUS BERSYARAT | 05-S1, 05-S4 |
| 06 Accessibility | LULUS BERSYARAT | 06-A11y1, 06-A11y2 |
| 07 Performance | LULUS | 07-P1–P3, 07-N1 |
| 08 Bug & Edge Cases | LULUS (dengan koreksi) | 08-B1, 08-N2 |
| 09 Dependency Quality | LULUS (dengan catatan) | 09-D1 (dev-only) |
| 10 Build & Deployment | LULUS BERSYARAT | 10-DEP1, 10-DEP4 |
| 11 Code Completeness | LULUS BERSYARAT | 11-C1 (stub root), 11-C3/C4/C5 (minor) |
| 12 Documentation | LULUS BERSYARAT | 12-DOC2, 12-DOC4 |

**Rekap skor: LULUS 4 tahap (03, 07, 08, 09); LULUS BERSYARAT 8 tahap (01, 02, 04, 05, 06, 10, 11, 12).** Audit lama menulis "LULUS 6 (3, 5, 7, 8-asli, 9, 12)" — salah karena `audits/05-security.md` sendiri ber-verdict **LULUS BERSYARAT**, dan audit 12 (setelah direvisi) juga **LULUS BERSYARAT**.

## Yang tidak diaudit (batas penugasan)

- Eksekusi runtime: `npm test`, `npm run build`, `npm run test:e2e`, `docker build/run`, deploy nyata, cron 200 produksi, pengiriman webhook sungguhan, drill restore, uji race konkuren, chaos network, fuzz input, uji screen-reader per P1–P3 tahap 6. (Semua atas aturan tugas: hanya baca/grep/`node` one-liner/`git` read-only.)
- Penilaian visual terukur: render browser nyata, Lighthouse/CWV aktual, axe/Pa11y.
- Keputusan konten/komersial: kelayakan teks seed sebagai konten produksi, harga/anggaran Emailit/R2/Neon, jadwal 6 minggu §13 (proses, bukan kode).

## Catatan revisi audit ulang

Tabel klaim lama (audit 13 versi awal) → hasil verifikasi ulang → tindakan. Semua bukti `file:line` diverifikasi pada revisi ini.

| Klaim lama | Hasil verifikasi | Tindakan |
|---|---|---|
| Register memuat `S6 (custody copy)`, `S2 (OTP wording)`, `U1 (timer pollution)`, `U5 (domain wording)` | **ID fiktif.** `audits/05-security.md` hanya punya S1 (CSRF, `:23`), S2 (shared secret cron/webhook, `:30`), S3 (TEST_TIMER_MS, `:37`), S4 (XFF, `:43`), S5 (trivia, `:49`). `audits/02-ui-ux-quality.md` U1 = tinggi header 64px (`:16`), U5 = navigasi admin mobile (`:52`). Tidak ada temuan "custody copy"/"OTP wording"/"timer pollution"/"domain wording" di kode. | Register ditulis ulang total memakai ID asli + prefix tahap; entri fiktif dihapus |
| Register mencampur `F2` dan `A1` sebagai dua temuan terpisah, `U2/B2` digabung tanpa ID sumber | **Terverifikasi sebagai duplikat asli lintas tahap**: `04-A1 = 01-F2` (audits/04:18-27; audits/01:34-42); `02-U2 = 08-B2` (audits/02:22-27; audits/08:26-32). | Ditulis sebagai satu entri dengan dua ID + cross-reference |
| Skor: "LULUS 6 (3, 5, 7, 8-asli, 9, 12), LULUS BERSYARAT 7 (1, 2, 4, 6, 10, 11, 13-ini)" | **Salah.** 05 ber-verdict LB (`audits/05-security.md:19`); 12 setelah revisi juga LB (`audits/12-documentation.md:10`); 01/02/04/06/10/11 LB. Yang LULUS murni hanya 03 (`audits/03:12`), 07 (`audits/07:14`), 08 (`audits/08:15`), 09 (`audits/09:12`). | Tabel skor ditulis ulang: LULUS 4, LB 8 |
| "26 dari 28 checkbox §12 terverifikasi di kode; dua tersisa pekerjaan operator" | **Aritmetika salah.** `grep "^\- \[ \]"` PRD = **25** checkbox (`:528-561`). Laporan lama sendiri menjumlah 7+5+8+5 = 25, bukan 28/26. Rincian benar: 20 penuh di kode + 3 sebagian (PRD:534 re-subscribe = 01-F1; PRD:551 ordering = 04-N3; PRD:557 singleton login = 01-F3) + 2 operator (PRD:560-561). | Angka dikoreksi menjadi 25 = 20 + 3 + 2; seksi §12 ditulis ulang |
| "Funnel dan contact (7/7 di kode)" termasuk re-subscribe | **Sebagian salah.** 6 penuh; checkbox re-subscribe (PRD:534) **sebagian** karena form klaim tak menampilkan persetujuan (`src/components/EmailForm.astro:23,68`; jalur `/subscribe-again` benar: `src/lib/broadcast/unsubscribe.ts:86-113`). | Seksi funnel dikoreksi menjadi 6 penuh + 1 sebagian |
| "Broadcast (7 penuh + 1 nuansa)" | **Terverifikasi konsisten**; nuansa = `04-N3` (dua cron independen `vercel.json:2-5`; tidak ada drain outbox di tick broadcast). | Dipertahankan, diperjelas dengan bukti |
| "Admin dan operasi (3 kode + 2 operator)" | **Terverifikasi**, dengan catatan `01-F3`: `startLogin` menerima baris mana pun (`src/lib/admin/login.ts:35-54`), singleton hanya ditegakkan lewat bootstrap (`src/lib/admin/bootstrap.ts:21`). | Dipertahankan + catatan 01-F3 |
| "Syarat launch terbesar adalah DEP1 satu baris dan C1 satu keputusan" (6 item) | **Kurang lengkap.** DEP1 lebih parah (runtime juga tanpa `src/` + `dotenv`: `Dockerfile:25,32-36`; `docs/deploy.md:172-173` salah klaim), dan ada blocker kedua **10-DEP4** (adapter Vercel absen; `package-lock.json` 0 kemunculan). C4 juga naik (tidak ada type-check otomatis; `package.json:10` polos, tanpa `@astrojs/check`). | Syarat launch diperluas menjadi 10 item berprioritas |
| "Minor: DOC2 (adapter Vercel)" | **Severity naik.** Kini **UTAMA** dan sama dengan `10-DEP4` (`audits/12-documentation.md:21-29`, `audits/10-build-deployment.md:35-42`). | Dipindah ke grup blocker ops |
| "Major: C1 (root stub)" | **Valid** (`src/pages/index.astro:1-9`; `src/layouts/PublicLayout.astro:25`), tetapi sub-klaim "orphan" salah (`href="/"` 10x, `audits/02-ui-ux-quality.md:48`). Setelah revisi, `audits/11-code-completeness.md:14,94` **sudah diperbarui** dan memuat koreksi yang sama (C1 = stub + indexable, bukan orphan). | Dipertahankan dengan koreksi sub-klaim |
| "Minor: S6 (custody copy)"; "S2 (OTP wording)"; "U1 (timer pollution)"; "U5 (domain wording)" | **Tidak ada di kode maupun file audit sumber.** Tidak ditemukan mekanisme custody copy; teks OTP ada di `src/lib/templates.ts:92-100`; timer hanya `03-S3`/`05-S3` (TEST_TIMER_MS); tidak ada temuan "domain wording" (allowlist di `src/lib/allowlist.ts:5-15`). | Dihapus dari register |
| "Lulus murni (2 tahap): 3 code quality, 9 dependency quality" | **Salah.** 07 Performance dan 08 Bug & Edge juga LULUS (`audits/07:14`, `audits/08:15`). | Dikoreksi menjadi 4 tahap LULUS |
| "Keputusan akhir: GO BERSYARAT" | **Terverifikasi dan dipertahankan**, dengan dasar diperbarui (dua blocker ops + temuan baru 05-S4/08-N2/01-F1/04-N3). | Label diganti "Keputusan akhir audit 13: GO BERSYARAT" |
| Label "tahap 13" pada register lama | Tidak sesuai penomoran file | Diganti "Keputusan akhir audit 13" |
| "Ruang lingkup §6 — nol scope creep" | **Terverifikasi ulang via grep**: payment/drip/A-B/pixel/WYSIWYG/video/native/multi-admin = 0; `role` = 29 (semua ARIA/HTML, nol RBAC). | Dipertahankan, ditambah bukti grep |
| File `audits/11-code-completeness.md` | **Sudah direvisi** (judul "Audit 11", memuat "Catatan revisi audit ulang"; verdict diri **LULUS BERSYARAT**; C1 dikoreksi menjadi stub + indexable, bukan orphan; temuan baru C3 `?m=` dead branch, C4 celah mirror EN, C5 seed tanpa guard). | Dipakai sebagai sumber; verdict skor 11 = LB |
| File `audits/12-documentation.md` | **Sudah direvisi** oleh agent lain (judul "(revisi audit ulang)"; verdict diri **LULUS BERSYARAT**; DOC2/DOC4 UTAMA). | Dipakai sebagai sumber; verdict skor 12 = LB |
