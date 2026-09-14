# Plan 4 — Gap Closure & Launch Readiness

**Status:** Siap implementasi
**Produk:** KelasWFA Newsletter
**Cakupan:** 5 gap PRD + 6 partial dari audit pasca-Plan 3. Bukan fitur baru — menutup sisa persyaratan MVP agar PRD v2 terpenuhi penuh, lalu siap deploy staging.
**Prasyarat:** main di `62a66f4` (Plan 1–3 selesai, 313 unit test, 5/5 e2e, build hijau).

## Hasil audit (ringkas)

Skor audit independen: 60 ✅ / 6 ⚠️ / 5 ❌ dari 71 item PRD+DESIGN. DESIGN.md patuh penuh kecuali satu penyimpangan CTA ganda (Task T8). Semua deferred minor Plan 1–2 terverifikasi resolved. Tidak ada plan lain di antrean — ini plan terakhir sebelum launch.

## Global Constraints (berlaku semua task)

- Bahasa Indonesia untuk copy UI; token CSS dari `src/styles/tokens.css` saja (tidak ada hex hardcoded); badge ikon+teks.
- Env hanya via `src/lib/env.ts`; rate limit via `consumeRateLimit` di `src/lib/ratelimit.ts` (scope, identity, limit, window default 1 jam); audit admin via `audit()` di `src/lib/admin/audit.ts`.
- Guard: halaman admin `requireAdminOrRedirect` + `prerender=false`; API admin `getAdmin` + 401 + `prerender=false` + `Cache-Control: no-store`. Route publik tetap tanpa auth.
- CSP `script-src 'self'` — tidak ada inline `on*=` handler; pakai `addEventListener` di `<script>` halaman.
- TDD untuk lib baru (Vitest, pola `test/` yang ada); e2e Playwright mengikuti pola `test/e2e/funnel.spec.ts` dan `test/broadcast/e2e/broadcast.spec.ts` (login via OTP dari outbox, `workers: 1` tetap).

## File Structure

| File | Peran |
|---|---|
| `src/components/LocaleSwitch.astro` (NEW) | Toggle bahasa ID⇄EN; dipakai halaman reward ID+EN |
| `src/layouts/PublicLayout.astro` (MOD) | Slot header opsional + `<link rel="canonical">` per locale |
| `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro` (MOD) | Render header + toggle + canonical |
| `src/pages/api/sitemap.xml.ts` (NEW) | Sitemap published+indexable |
| `src/pages/cek-email.astro`, `src/pages/en/cek-email.astro` (MOD) | Tombol "Kirim ulang" menaut ke landing campaign |
| `src/lib/funnel.ts` (NEW) | Agregasi statistik funnel dari tabel existing |
| `src/pages/admin/index.astro` (MOD) | Dashboard statistik funnel (ganti redirect) |
| `src/lib/admin/audit.ts` (MOD) | `listAuditEvents({limit, offset})` untuk viewer |
| `src/pages/admin/audit.astro` (NEW) | Viewer audit log read-only + pagination |
| `src/pages/api/download/[session]/[assetId].ts` + `src/lib/download.ts` (MOD) | Rate limit download |
| `src/pages/api/webhooks/emailit.ts`, `src/pages/api/timer-token.ts`, `src/pages/api/unsubscribe/[token].ts`, `src/pages/api/unsubscribe/resubscribe.ts` (MOD) | Rate limit di route yang belum ada |
| `src/lib/broadcast/machine.ts` (MOD) | Guard DB single-`sending` |
| `src/lib/broadcast/stats.ts` (MOD) | Throttle retry-failed |
| `src/pages/admin/preview/[id].astro` (MOD) | Badge fallback EN |
| `src/pages/admin/campaigns/[id].astro` (MOD) | Satu CTA primer per state |

---

### Task 1: Toggle bahasa + canonical di halaman reward publik

**Mengapa:** PRD §7.1 mewajibkan toggle bahasa selalu terlihat; DESIGN §5 mewajibkan header (logo kiri, switch bahasa kanan). Saat ini tidak ada toggle — hanya `hreflang` di `<head>`. PRD §SEO mewajibkan canonical per locale — saat ini tidak ada.

**Files:**
- Create: `src/components/LocaleSwitch.astro`
- Modify: `src/layouts/PublicLayout.astro` (tambah prop `canonical?: string` + render `<link rel="canonical">`; tambah slot `header` opsional sebelum `<slot/>` utama), `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`

**Interfaces (ikuti pola yang ada):**
- `LocaleSwitch.astro` props: `{ current: "id" | "en"; idHref: string; enHref: string }`. Render `<nav aria-label="Pilih bahasa">` dengan dua link; bahasa aktif diberi `aria-current="true"` + gaya non-primer (link teks), bahasa lain gaya chip/ghost. Copy: "ID" dan "EN". Styling: token spacing/warna saja, tinggi header 64px mobile / 72px desktop (DESIGN §5).
- Header dipasang di kedua halaman reward: logo teks "KelasWFA" (link ke `/`) kiri + `<LocaleSwitch>` kanan, background transparan + border bawah tipis (sesuai DESIGN §5: "border bawah tipis muncul saat scroll" — implementasi sederhana: border selalu tampil; jangan tambah JS scroll listener — YAGNI).
- `idHref`/`enHref`: `/r/<slug>` dan `/en/r/<slug>` (slug sama). Untuk state `paused`, toggle tetap tampil (CampaignPaused di bawah header).
- Canonical: `canonical={\`${siteUrl}/r/${slug}\`}` (ID) dan `.../en/r/${slug}` (EN). `siteUrl` dari `env("PUBLIC_SITE_URL", new URL(Astro.request.url).origin)` — pola yang sama dipakai `src/pages/api/subscribe.ts`.

**Hindari:** mengubah `CampaignPaused`, `RewardHero`, atau komponen lain; menambah menu navigasi; JS untuk toggle (murni link).

**Test:** e2e Playwright — di `/r/<slug>` (pakai campaign seed yang published, pola `test/e2e/funnel.spec.ts`): toggle EN terlihat → klik → URL `/en/r/<slug>`; cek `<link rel="canonical">` dan toggle balik ke ID. `npx playwright test` 6/6.

### Task 2: Tombol "Kirim ulang" di halaman cek-email

**Mengapa:** Plan 1 §2157 merancang tombol ghost "Kirim ulang" menaut ke landing page (resend = submit ulang form; cooldown via rate limit email 5/jam). Implementasi menaut ke `/` — salah bila slug campaign bukan root. Perbaikan: tautkan ke `/r/<slug>` (ID) / `/en/r/<slug>` (EN).

**Files:**
- Modify: `src/pages/cek-email.astro`, `src/pages/en/cek-email.astro`

**Interfaces:**
- `processSubscribe` / route subscribe tidak menyimpan slug di redirect cek-email. Ruling: tambah query `?s=<slug>` pada redirect `cekEmailPath` di `src/pages/api/subscribe.ts` (slug sudah ada di handler sebagai variabel `slug`; aman — slug bersifat publik). Kedua halaman cek-email membaca `Astro.url.searchParams.get("s")`; bila ada → `href` tombol = `/r/<s>` (atau `/en/r/<s>` di halaman EN); bila tidak ada (mis. error pre-slug) → fallback `/` seperti sekarang. Copy tombol tetap "Kirim ulang" / "Resend".
- Tidak ada perubahan perilaku rate limit; tidak ada endpoint resend baru (YAGNI — desain Plan 1 final).

**Test:** unit test untuk `cekEmailPath`-setara bila diekstrak, atau e2e: submit funnel → halaman cek-email → href tombol kirim-ulang = landing campaign. Minimal: e2e assertion href. `npm test` + `npx playwright test` hijau.

### Task 3: Sitemap published+indexable

**Mengapa:** PRD §SEO: "Sitemap hanya memasukkan reward campaign yang published dan indexable." Belum ada.

**Files:**
- Create: `src/pages/api/sitemap.xml.ts` (rute GET, publik, `prerender=false`, `Content-Type: application/xml`, `Cache-Control: public, max-age=3600`)

**Interfaces:**
- Query `rewardCampaigns` where `status='published' AND indexable=true`, order `sortOrder, slug`. Untuk tiap slug emit dua `<url>`: `/r/<slug>` dan `/en/r/<slug>` dengan `<lastmod>` dari `updatedAt ?? publishedAt`. `<loc>` absolut via `PUBLIC_SITE_URL` (fallback origin). Escape XML untuk slug (`&<>"'`).
- Daftarkan di `robots` bila ada file robots statis — cek `public/`; bila tidak ada, jangan buat (YAGNI, di luar PRD).

**Test:** unit test dengan DB test: insert 1 published+indexable, 1 published non-indexable, 1 draft → GET mengembalikan hanya 2 URL campaign pertama (ID+EN). Pola test route lain yang ada.

### Task 4: Dashboard statistik funnel admin

**Mengapa:** PRD §7.3 + §4.2 mewajibkan "statistik funnel dasar" dengan definisi event yang dikunci. Saat ini `/admin` hanya redirect; tidak ada UI angka.

**Files:**
- Create: `src/lib/funnel.ts` (`getFunnelStats(): Promise<FunnelStats>`)
- Modify: `src/pages/admin/index.astro` (dashboard; redirect lama dihapus — update komentar "Task 10 mengganti dashboard" yang sudah basi)

**Interfaces (sumber data = tabel existing, tanpa migrasi):**
```ts
type FunnelStats = {
  contactsTotal: number;            // contacts.count
  contactsConfirmed30d: number;     // contacts confirmed_at >= now()-30d
  activeSubscribers: number;        // marketing_subscription status='active' (North Star pembilang)
  claimsTotal: number;              // reward_claim.count
  confirmationsSent: number;        // email_outbox email_type='confirmation'
  rewardAccessSent: number;         // email_outbox email_type='reward_access'
  downloadsIssued: number;          // access_token type='session'.count (resolveDownload mengonsumsi session token per unduhan)
  unsubscribedTotal: number;        // marketing_subscription status='unsubscribed'
};
```
- Rumus yang ditampilkan (teks, bukan chart — konsisten dengan laporan broadcast): Visit→submit dan Submit→confirm TIDAK ditampilkan karena `unique_page_view`/`timer_eligible`/`email_submitted` tidak pernah ditulis ke DB (tidak ada event log; menambah tracking page-view adalah fitur baru di luar gap-closure — catat sebagai batasan eksplisit di halaman: "Statistik berbasis data tersimpan; tanpa pelacakan page-view"). Yang ditampilkan: 8 angka di atas + `Reward access rate = downloadsIssued / rewardAccessSent` (guard pembagi nol → "—").
- PRIVASI (PRD §privasi): angka agregat saja; tidak ada email/IP di halaman ini.
- UI: 8 kartu angka (label + nilai `Intl.NumberFormat("id-ID")`), copy Indonesia, token saja. Link ke `/admin/contacts` dan `/admin/campaigns` sebagai navigasi kerja (bukan menu rumit).
- Login tetap wajib (`getAdmin` sudah ada di file ini — pertahankan; hanya ganti perilaku sesudahnya).

**Hindari:** chart/dekorasi; menambah tabel event baru; mengubah redirect `/admin/login` untuk non-login.

**Test:** unit test `getFunnelStats` dengan seed minimal (1 contact confirmed + subscription active + 1 claim + outbox rows + session token) → angka sesuai. E2E: login admin → `/admin` menampilkan angka (bukan redirect). `npm test` + `npx playwright test` hijau.

### Task 5: Viewer audit log admin

**Mengapa:** Audit ditulis lengkap (login, campaign, kontak, broadcast) tapi tidak bisa dilihat — admin butuh untuk operasional dan akuntabilitas (PRD §7.3 menyebut audit log; pola wajar: yang dicatat harus bisa dibaca).

**Files:**
- Modify: `src/lib/admin/audit.ts` (tambah `listAuditEvents({ limit, offset }): Promise<{ rows: { id, action, detail, ipHash?, createdAt, adminEmail }[]; total: number }>` — join `adminUsers` untuk email; `limit` clamp 1..100, default 50)
- Create: `src/pages/admin/audit.astro` (guard + `prerender=false`; tabel: waktu, admin, aksi, detail JSON ringkas (potong 120 karakter + `title` penuh), filter chip per aksi? YAGNI — tanpa filter, hanya pagination prev/next ala laporan broadcast)

**Interfaces:** Cek dulu kolom aktual `admin_audit_log` di `src/lib/schema.ts` (jangan asumsi nama kolom — audit() existing jadi acuan). Link dari dashboard Task 4 ("Lihat audit log"). Copy Indonesia, token saja.

**Test:** unit test `listAuditEvents` (insert 2 baris via `audit()` → terbaca + total benar + pagination). E2E ringan: login → `/admin/audit` 200 + tabel terlihat.

### Task 6: Rate limit di route yang belum dilindungi

**Mengapa:** PRD §keamanan mewajibkan rate limit di download, webhook, (dan wajar di timer-token + unsubscribe). Saat ini hanya submit/login/OTP.

**Files (modify):**
- `src/pages/api/download/[session]/[assetId].ts` — `consumeRateLimit("dl", hashIp(clientIp(request)), 30)` per jam SEBELUM `resolveDownload`. 403 tetap 403; yang kena limit → 429 generik (jangan bocorkan alasan).
- `src/pages/api/webhooks/emailit.ts` — `consumeRateLimit("webhook", providerMessageId ?? ip, 600)` per jam SEBELUM verifikasi HMAC? Ruling: SESUDAH verifikasi HMAC (identitas = `message_id` body) — request tanpa signature valid tidak menghabiskan budget identitas valid, dan penyerang tanpa secret tidak bisa memicu kerja DB. Tanpa `message_id` → pakai IP hash.
- `src/pages/api/timer-token.ts` — `consumeRateLimit("timer", hashIp(ip), 60)` per jam (token murah tapi tak terbatas = amplifikasi).
- `src/pages/api/unsubscribe/[token].ts` + `src/pages/api/unsubscribe/resubscribe.ts` — `consumeRateLimit("unsub", hashIp(ip), 30)` per jam SEBELUM `resolveUnsubscribeToken` (mencegah enumerasi token). Token invalid tetap 303 ke `/batal-berlangganan/invalid` (jangan bedakan respons).
- Helper `clientIp` dari `src/lib/ip.ts` + `hashIp` dari `src/lib/ratelimit.ts` sudah ada — pakai, jangan duplikat.

**Test:** unit test per route-helper bila logika diekstrak; minimal test pola existing: request berlebih → 429/redirect generik. Ikuti konvensi test route yang ada di repo.

### Task 7: Badge fallback EN di preview reward + satu CTA primer di editor

**Mengapa:** (a) Composer broadcast sudah menampilkan badge "EN belum lengkap — fallback ID"; preview reward belum — admin bisa publish tanpa sadar EN kosong. (b) Editor reward menampilkan dua `.btn-primary` bersamaan (Simpan + Publikasikan) — melanggar DESIGN "satu aksi utama per state".

**Files:**
- Modify: `src/pages/admin/preview/[id].astro` — cek prop/data locale yang dipakai; tambah badge fallback EN dengan teks dan gaya yang sama persis dengan composer broadcast (`EN belum lengkap — fallback ID`, class `fallback-badge`).
- Modify: `src/pages/admin/campaigns/[id].astro:81,318` — tombol "Publikasikan" (aksi utama, state draft) tetap `btn-primary`; tombol "Simpan" turun ke `btn-secondary` HANYA saat campaign draft (state lain tidak berubah). Satu baris kondisional; jangan ubah JS save.

**Test:** e2e existing (admin.spec) tetap hijau — cukup sebagai regresi; tambah assertion badge bila murah.

### Task 8: Guard DB single-`sending` + throttle retry broadcast

**Mengapa:** (a) "Hanya satu campaign dapat berada pada `sending`" (PRD §7.4) hanya dijaga di level klaim per-campaign — dua campaign berbeda bisa `sending` bersamaan bila cron overlap. (b) `retryFailedRecipients` tanpa throttle — admin bisa menekan tombol berulang dan membanjiri antrean.

**Files:**
- Modify: `src/lib/broadcast/machine.ts` — di `claimForSending`, tambah guard: `SELECT count(*) FROM email_campaigns WHERE status='sending'` dan tolak klaim bila ≥1 campaign LAIN berstatus sending (kecualikan campaign sendiri untuk idempotensi retry klaim). Tetap satu statement atomic sebisa pola drizzle (`and(eq(status,'queued'), sql<not exists (select 1 ... sending and id != ...)>`) — bila tidak memungkinkan atomic satu statement, dokumentasikan di komentar + bahas di laporan (pre-ruling: upayakan atomic; fallback dua-step dengan komentar jujur ​​diterima karena cron single-flight Task 6 membuat race window sangat kecil).
- Modify: `src/lib/broadcast/stats.ts` — `retryFailedRecipients`: tambah guard throttle via `consumeRateLimit("broadcast_retry", campaignId, 3)` per jam SEBELUM guard status; bila kena limit kembalikan `{ ok: false, reason: "rate-limited" }`; route `retry-failed.ts` petakan ke 429 dengan pesan Indonesia "Terlalu sering. Coba lagi nanti." (cek pola error route tersebut dulu). Audit TIDAK ditulis saat kena throttle (konsisten dengan guard invalid-state yang tidak menulis audit).

**Test:** unit test — (a) campaign A sending → `claimForSending(B)` false; klaim ulang A sendiri true; (b) retry 4x dalam sejam → ke-4 `rate-limited`, tanpa audit baru. TDD.

### Task 9: E2E penutup + verifikasi akhir

**Mengapa:** Mengunci semua gap agar tidak regresi.

- Perluas `test/e2e/funnel.spec.ts` (atau spec baru `test/e2e/launch.spec.ts` bila lebih rapi — pilih satu, jangan dua): toggle ID⇄EN di `/r/<slug>` + canonical; tombol kirim-ulang href ke landing; sitemap berisi campaign published+indexable; `/admin` dashboard angka terlihat; `/admin/audit` 200.
- `npm test` (target ~320+), `npx playwright test` (6/6), `npm run build` hijau.
- Update `docs/operations.md` bila ada prosedur baru yang muncul dari task ini (mis. throttle retry, arti angka funnel) — singkat saja, jangan tulis ulang.

## Estimasi task

9 task, tiap task = 1 subagent implementer + review. Budget review: 3 fix round untuk seluruh plan (gap kecil, risiko rendah). Urutan: T1–T3 paralel-ish (independen), T4→T5 (dashboard dulu, viewer menaut darinya), T6–T8 independen, T9 terakhir.
