# KelasWFA Plan 3 — Broadcast & Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun subsistem broadcast email satu-kali (draft → segmentasi → snapshot → kirim/terjadwal dengan rate limit → delivery reporting), unsubscribe satu-klik + re-subscribe consent, click tracking aman, webhook Emailit, plus batch hardening launch dari deferred minor Plan 1–2.

**Architecture:** Email campaign menyimpan konten bilingual + audience filter jsonb. Pada schedule/send-now, audience dihitung dan dibekukan sebagai baris `email_campaign_recipient` (snapshot). Worker broadcast idempoten (cron per menit, advisory lock Postgres menjamin satu `sending`) mengirim langsung via Emailit API dengan limit per menit/jam per campaign dan kapasitas provider harian; setiap kirim mencatat `email_delivery`. Webhook Emailit (signature diverifikasi, idempoten) memperbarui status delivery; hard bounce masuk suppression. Unsubscribe satu-klik per-contact (token opaque hashed) menandai subscription + suppression; claim ulang oleh contact unsubscribed menuntut re-consent eksplisit. Link di body direwrite menjadi redirect aman milik aplikasi untuk click tracking.

**Tech Stack:** Existing stack (Astro 5 + Drizzle + Postgres + Emailit + Playwright) + `sanitize-html` (pembersih body rich-text).

**Spec:** `.agents/kelaswfa-newsletter-prd-v2.md` (bagian 2 keputusan terkunci broadcast; 7.4 email campaign; 7.5 provider; 12 acceptance criteria broadcast) dan `.agents/DESIGN.md` (§6 composer email campaign + send review, delivery & analytics). Executor wajib membaca keduanya.

**Ruang lingkup plan ini (dan apa yang TIDAK):**

- Termasuk: seluruh 7.4 dan 7.5, unsubscribe/re-subscribe, click tracking, webhook, reporting, delivery status di view contact, hardening deferred minors (Task 14), cron wiring, e2e broadcast.
- Tidak termasuk: automation/drip/recurring (pasca-MVP), open tracking pixel (dilarang PRD), AI translation (pasca-MVP), alerting eksternal (dokumentasi only), backup/restore drill (prosedur ops, bukan kode — didokumentasikan di README).

---

## Global Constraints

- Broadcast satu kali saja: kirim sekarang atau terjadwal; tanpa drip/automation.
- Penerima SELALU dikecualikan bila: belum confirmed, marketing subscription tidak aktif, ada di suppression list, atau sudah unsubscribed.
- Filter: semua subscriber terkonfirmasi; locale `id`/`en`/semua; claim reward campaign (satu/beberapa) dengan mode `ANY` (setidaknya satu) atau `ALL` (semua yang dipilih).
- Snapshot dibekukan saat send/schedule; subscriber baru setelah itu tidak masuk.
- Status: `draft → scheduled → queued → sending → completed`, dengan `paused`, `cancelled`, `failed`. HANYA SATU campaign boleh `sending` dalam satu waktu.
- Admin menentukan `max_per_minute` dan `max_per_hour` per campaign (positif, dibatasi kapasitas provider yang tersimpan di server: env `EMAILIT_MAX_PER_SECOND=2`, `EMAILIT_MAX_PER_DAY=5000`, dapat diubah tanpa ubah kode).
- Email transaksional (outbox Plan 1) TIDAK menunggu antrean broadcast dan selalu prioritas lebih tinggi — worker broadcast mengalah.
- Setiap broadcast memiliki link unsubscribe satu-klik terautentikasi token opaque; TIDAK ada open tracking pixel.
- Click tracking hanya lewat redirect aman milik aplikasi; URL tujuan divalidasi (https, bukan open redirect) saat campaign disiapkan.
- Webhook Emailit: signature diverifikasi, diproses idempoten, dipetakan ke `accepted|delivered|bounced|failed|suppressed`; event mentah disimpan untuk audit tanpa mengekspos secret.
- Konten campaign: subject, preheader, body untuk ID dan EN; EN boleh kosong (fallback ID, status missing translation terlihat sebelum schedule); body di-sanitize dengan allowlist tag (p, br, strong, em, u, a, ul, ol, li, h2, h3, blockquote).
- Test send hanya ke alamat admin yang diizinkan (env `TEST_SEND_ADDRESSES`, default `kelaswfa@gmail.com`), tidak masuk statistik audience.
- Unsubscribe menghentikan broadcast mendatang; email transaksional reward TETAP boleh dikirim. Re-subscribe hanya setelah persetujuan eksplisit yang terkonfirmasi.
- env hanya via `src/lib/env.ts`; design token; badge status ikon + teks; env via src/lib/env.ts; commit per task.

## File Structure

```
src/lib/broadcast/
  schema additions (src/lib/schema.ts)   # emailCampaigns, emailCampaignRecipients, emailDeliveries,
                                         # emailSuppressions, emailProviderEvents, emailLinks + kolom contacts
  audience.ts        # validateFilter, countAudience, resolveAudience (ANY/ALL, locale, exclusion)
  content.ts         # sanitizeBody, validateContent (missing translation), renderForRecipient (vars, links, footer)
  snapshot.ts        # ensureContactTokens, snapshotRecipients, extractAndStoreLinks
  machine.ts         # status transitions, schedule/send-now validation (limits vs provider capacity)
  worker.ts          # processBroadcast: claim single sending, limits minute/hour/day, send, record
  webhooks.ts        # verifyEmailitSignature, processEmailitEvent (idempoten, suppression)
  stats.ts           # campaignStats (KPI), progress
  links.ts           # rewriteLinksForRecipient, resolveClick
src/pages/admin/email-campaigns/index.astro | new.astro | [id].astro (composer) | [id]/report.astro
src/pages/admin/api/email-campaigns/index.ts | [id].ts | [id]/schedule.ts | [id]/send.ts
  [id]/test-send.ts | [id]/pause.ts | [id]/resume.ts | [id]/cancel.ts
src/pages/batal-berlangganan/[token].astro (+ en/)     # unsubscribe landing (id/en)
src/pages/subscribe-again/[token].astro                # re-consent page (dari claim ulang)
src/pages/api/unsubscribe/[token].ts                   # GET one-click
src/pages/api/click/[linkId]/[token].ts                # GET redirect 302 + record
src/pages/api/webhooks/emailit.ts                      # POST
src/pages/api/cron/broadcast.ts                        # GET (CRON_SECRET)
src/middleware.ts                                      # CSP/HSTS headers
vercel.json                                            # tambah cron broadcast
test/broadcast/{audience,content,snapshot,machine,worker,webhooks,stats,links,unsubscribe}.test.ts
test/broadcast/e2e/broadcast.spec.ts
test/hardening.test.ts
```

---

### Task 1: Schema broadcast (migrasi)

**Files:**
- Modify: `src/lib/schema.ts`, `test/helpers.ts` (resetDb)
- Test: `test/broadcast/schema.test.ts`

**Interfaces:**
- Produces:
  - `emailCampaigns`: id, status (`draft|scheduled|queued|sending|completed|paused|cancelled|failed`), subjectId/subjectEn (varchar 300), preheaderId/preheaderEn (varchar 300), bodyHtmlId/bodyHtmlEn (text), audienceFilter (jsonb), maxPerMinute int, maxPerHour int, scheduledAt, snapshotAt, confirmedAt, createdAt/updatedAt.
  - `emailCampaignRecipients`: id, campaignId FK cascade, contactId FK, localeSelected (2), status (`pending|sent|failed|cancelled`), clickTokenHash unique (varchar 64), createdAt; unique (campaignId, contactId).
  - `emailDeliveries`: id, contactId FK, campaignRecipientId FK nullable, providerMessageId unique nullable (varchar 200), emailType (`broadcast|broadcast_test`), status (`accepted|sent|delivered|bounced|failed|suppressed`), error text nullable, sentAt, deliveredAt, bouncedAt, createdAt.
  - `emailSuppressions`: emailNormalized PK (varchar 254), reason (`unsubscribe|hard_bounce|complaint`), createdAt.
  - `emailProviderEvents`: id, providerMessageId (varchar 200), eventType (varchar 40), payload jsonb, receivedAt; unique (providerMessageId, eventType).
  - `emailLinks`: id, campaignId FK cascade, urlHash unique (varchar 64), url text; createdAt.
  - Kolom baru di `contacts`: `unsubscribeTokenHash` varchar(64) unique nullable.
- `resetDb` TRUNCATE diperluas: `email_provider_events, email_links, email_deliveries, email_campaign_recipients, email_campaigns, email_suppression` (sebelum tabel lain yang terkait).

- [ ] **Step 1: Tulis `test/broadcast/schema.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import {
  contacts, emailCampaignRecipients, emailCampaigns, emailDeliveries,
  emailLinks, emailProviderEvents, emailSuppressions,
} from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers";

describe("broadcast schema", () => {
  beforeEach(resetDb);
  it("creates campaign, recipients, deliveries, suppression, events, links", async () => {
    const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
    const [camp] = await db.insert(emailCampaigns).values({
      subjectId: "Halo", bodyHtmlId: "<p>Hai</p>",
      audienceFilter: { all: true }, maxPerMinute: 60, maxPerHour: 600,
    }).returning();
    const [r] = await db.insert(emailCampaignRecipients).values({
      campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "h1",
    }).returning();
    const [d] = await db.insert(emailDeliveries).values({
      contactId: c.id, campaignRecipientId: r.id, emailType: "broadcast", status: "accepted",
    }).returning();
    await db.insert(emailSuppressions).values({ emailNormalized: "x@gmail.com", reason: "hard_bounce" });
    await db.insert(emailProviderEvents).values({ providerMessageId: "m1", eventType: "delivered", payload: {} });
    await db.insert(emailLinks).values({ campaignId: camp.id, urlHash: "u1", url: "https://a.b" });
    expect(r.status).toBe("pending");
    expect(d.status).toBe("accepted");
    expect(camp.status).toBe("draft");
  });
  it("rejects duplicate recipient per campaign and duplicate click token", async () => {
    const [c] = await db.insert(contacts).values({ emailNormalized: "d@gmail.com" }).returning();
    const [camp] = await db.insert(emailCampaigns).values({ subjectId: "s", bodyHtmlId: "b", audienceFilter: {}, maxPerMinute: 1, maxPerHour: 1 }).returning();
    await db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t1" });
    await expect(db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t2" })).rejects.toThrow();
    await expect(db.insert(emailCampaignRecipients).values({ campaignId: camp.id, contactId: c.id, localeSelected: "id", clickTokenHash: "t1" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: FAIL** — Run: `npm test -- test/broadcast/schema.test.ts` → FAIL.

- [ ] **Step 3: Implementasi schema + migrasi** — `npm run db:generate && npm run db:migrate`.

- [ ] **Step 4: PASS → Commit** — `git commit -m "feat: broadcast schema (campaigns, recipients snapshot, deliveries, suppression, events, links)"`

---

### Task 2: Audience & segmentasi

**Files:**
- Create: `src/lib/broadcast/audience.ts`
- Test: `test/broadcast/audience.test.ts`

**Interfaces:**
- Consumes: schema contacts/marketingSubscriptions/rewardClaims/emailSuppressions/emailCampaignRecipients.
- Produces:
  - `validateFilter(f: unknown): { ok: true; filter: AudienceFilter } | { ok: false }` — AudienceFilter: `{ all?: true; locales?: ("id"|"en")[]; claimCampaignIds?: string[]; claimMode?: "ANY"|"ALL" }`; minimal satu kriteria; `claimMode` wajib bila `claimCampaignIds` ada.
  - `countAudience(filter): Promise<number>` dan `resolveAudience(filter): Promise<{ contactId: string; locale: "id" | "en" }[]>` — hanya contact `confirmed` + marketing `active`; exclude suppression dan contact yang sudah jadi recipient campaign manapun yang masih aktif (exclude by emailSuppressions only — snapshot per campaign sudah mencegah duplikat via unique). Locale pilihan: contact.locale bila ada di filter.locales (atau filter tanpa locale), else `id`.

- [ ] **Step 1: Test** — fixtures: 5 contact (confirmed+active, confirmed+unsubscribed, pending, confirmed+suppressed, confirmed+active locale en), 2 campaign reward dengan claims. Assert: countAudience dengan `{all:true}` = 2; dengan locales `["en"]` = 1 (yang en); claimMode ANY dengan 1 campaign = 1, ALL dengan 2 campaign hanya contact yang claim keduanya; pending/unsubscribed/suppressed selalu terkeluar. Tulis penuh di test file (pola resetDb).

- [ ] **Step 2: FAIL → Step 3: Implementasi** (query drizzle dengan join + where; mode ALL = having count(distinct campaign_id) = jumlah dipilih).

- [ ] **Step 4: PASS → Commit** — `git commit -m "feat: audience segmentation with ANY/ALL claim mode and exclusions"`

---

### Task 3: Konten — sanitize, validasi, render per recipient

**Files:**
- Create: `src/lib/broadcast/content.ts`
- Modify: `src/lib/templates.ts` (ekspor `EMAIL_FROM`, `broadcastLayout`)
- Test: `test/broadcast/content.test.ts`

**Interfaces:**
- Consumes: `sanitize-html` (install), `EMAIL_FROM`.
- Produces:
  - `sanitizeBody(html: string): string` — allowlist: `p, br, strong, em, u, a[href, target, rel], ul, ol, li, h2, h3, blockquote`; semua `a` dipaksa `target="_blank" rel="noopener"`; href hanya `https:` (http ditolak → tag a dibuang atributnya); script/style/event handler terbuang.
  - `validateContent(input: { subjectId; preheaderId; bodyHtmlId; subjectEn?; preheaderEn?; bodyHtmlEn? }): { ok: true; missing: ("en")[] } | { ok: false; reason: "missing-id" }` — ID wajib lengkap; EN boleh kosong (missing menandakan fallback).
  - `renderForRecipient(args: { campaign: CampaignContent; locale: "id"|"en"; email: string; siteUrl: string; unsubscribeUrl: string; linkRewrite: (url: string) => string }): { subject: string; preheader: string; html: string; text: string }` — pilih konten locale (fallback ID), replace variabel aman `{{email}}` dan `{{locale}}`, rewrite link via callback, footer unsubscribe (teks ID/EN) + reply-to note. Text version = strip tag html (pola: buang tag, collapse whitespace).

- [ ] **Step 1: Test** (utama):

```ts
import { describe, it, expect } from "vitest";
import { sanitizeBody, validateContent, renderForRecipient } from "../../src/lib/broadcast/content";

describe("sanitizeBody", () => {
  it("strips scripts, handlers, and non-https hrefs, forces rel/target", () => {
    const out = sanitizeBody(`<p onclick="x()">Hai</p><script>alert(1)</script>
      <a href="https://a.b">ok</a><a href="http://a.b">no</a><a href="javascript:alert(1)">js</a>`);
    expect(out).toContain("<p>Hai</p>");
    expect(out).not.toContain("script");
    expect(out).toContain('href="https://a.b"');
    expect(out).not.toContain('href="http://a.b"');
    expect(out).not.toContain("javascript:");
    expect(out).toContain('rel="noopener"');
  });
});
describe("validateContent", () => {
  const id = { subjectId: "s", preheaderId: "p", bodyHtmlId: "<p>b</p>" };
  it("ok with id only, missing en flagged", () => {
    expect(validateContent(id)).toEqual({ ok: true, missing: ["en"] });
  });
  it("ok complete when en filled", () => {
    expect(validateContent({ ...id, subjectEn: "s", preheaderEn: "p", bodyHtmlEn: "<p>b</p>" }))
      .toEqual({ ok: true, missing: [] });
  });
  it("rejects incomplete id", () => {
    expect(validateContent({ subjectId: "s", preheaderId: "", bodyHtmlId: "" }).ok).toBe(false);
  });
});
describe("renderForRecipient", () => {
  const campaign = {
    subjectId: "Halo {{email}}", preheaderId: "p", bodyHtmlId: '<p>Hai <a href="https://a.b">link</a> {{locale}}</p>',
    subjectEn: "Hello {{email}}", preheaderEn: "pe", bodyHtmlEn: "<p>Hi {{locale}}</p>",
  };
  it("uses en locale and rewrites links + unsubscribe footer", () => {
    const r = renderForRecipient({
      campaign, locale: "en", email: "a@b.c", siteUrl: "https://kado.test",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/tok",
      linkRewrite: (u) => `https://kado.test/api/click/L1/tok`,
    });
    expect(r.subject).toBe("Hello a@b.c");
    expect(r.html).toContain("https://kado.test/api/click/L1/tok");
    expect(r.html).toContain("unsubscribe");
    expect(r.text).toContain("Hi en");
  });
  it("falls back to id when en empty for that field", () => {
    const r = renderForRecipient({
      campaign: { ...campaign, subjectEn: "" }, locale: "en", email: "a@b.c",
      siteUrl: "https://kado.test", unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(r.subject).toBe("Halo a@b.c");
  });
});
```

- [ ] **Step 2: FAIL → Step 3: Implementasi** — `sanitize-html` dengan allowedTags/allowedAttributes seperti Interfaces; transformasi tag `a` untuk enforce target/rel dan drop href non-https.

- [ ] **Step 4: PASS → Commit** — `git commit -m "feat: sanitized campaign content, validation, per-recipient rendering"`

---

### Task 4: Snapshot + token + link extraction

**Files:**
- Create: `src/lib/broadcast/snapshot.ts`
- Test: `test/broadcast/snapshot.test.ts`

**Interfaces:**
- Consumes: Task 2 `resolveAudience`; Task 3 `sanitizeBody`; `generateOpaqueToken`/`hashToken`; schema.
- Produces (KONTRAK FINAL token — satu token per-recipient dipakai untuk dua fungsi, click dan unsubscribe, tetap opaque + hashed + raw hanya muncul sekali di URL email):
  - `snapshotRecipients(campaignId): Promise<{ recipients: { recipientId: string; contactId: string; clickToken: string; locale: "id"|"en" }[] }>` — resolveAudience → untuk tiap contact: generate clickToken raw (`generateOpaqueToken`), hash ke kolom `clickTokenHash`, insert row recipient (idempoten via `onConflictDoNothing` — snapshot ulang tidak menduplikasi dan TIDAK mengganti token yang sudah ada; raw hanya dikembalikan untuk baris yang BARU dibuat); set `snapshotAt`. Link unsubscribe dan click dibangun saat RENDER dari raw ini (Task 6).
  - `prepareLinks(campaignId, bodyHtmlId, bodyHtmlEn): Promise<Map<string, string>>` — ekstrak semua href https unik dari kedua body (regex), `urlHash = hashToken(url)`, upsert `emailLinks`, return Map url → linkId.
- Render saat kirim (Task 7) memakai raw clickToken recipient untuk: link unsubscribe `/api/unsubscribe/<raw>` dan rewrite `https://site/api/click/<linkId>/<raw>`.

- [ ] **Step 1: Test** — snapshot: 2 contact audience → 2 recipient rows + token unik + snapshotAt terisi; snapshot ulang → tetap 2 rows (idempoten) dan token TIDAK berubah; prepareLinks: body dengan 2 link unik + 1 duplikat → 2 baris emailLinks, Map berisi 2 entry.

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: recipient snapshot with per-recipient tokens and link extraction"`

---

### Task 5: Status machine + schedule/send-now + limits

**Files:**
- Create: `src/lib/broadcast/machine.ts`
- Test: `test/broadcast/machine.test.ts`

**Interfaces:**
- Consumes: Task 2/4; `emailCampaigns`; env `EMAILIT_MAX_PER_SECOND`, `EMAILIT_MAX_PER_DAY`.
- Produces:
  - `validateLimits(maxPerMinute: number, maxPerHour: number): { ok: true } | { ok: false; reason: "non-positive" | "exceeds-provider" }` — positif; `maxPerMinute * 60 <= kapasitas jam implisit`? KONTRAK: `maxPerHour <= EMAILIT_MAX_PER_DAY` DAN `maxPerMinute <= maxPerHour` DAN `maxPerMinute * 60 <= EMAILIT_MAX_PER_DAY` (kapasitas hari).
  - `scheduleCampaign(id, { scheduledAt: Date | null }, auditOpts): Promise<{ ok: true; status: "scheduled" } | { ok: false; reason: "missing-id" | "limits" (dengan detail) | "not-draft" | "in-past" }>` — validasi konten (Task 3, `missing` hanya warning yang dikembalikan), validasi limits, snapshot recipients (Task 4), set `scheduledAt` + status `scheduled` + `snapshotAt`; `scheduledAt: null` berarti send-now → langsung `queued`.
  - `claimForSending(campaignId): Promise<boolean>` — atomic `UPDATE email_campaigns SET status='sending' WHERE id = ... AND status = 'queued' RETURNING` (dipakai worker Task 6).
  - `markCompleted(id)` / `markFailed(id, error)` / `pauseCampaign(id)` (sending→paused) / `resumeCampaign(id)` (paused→queued) / `cancelCampaign(id)` (scheduled|queued|paused→cancelled; recipient pending→cancelled). Semua dengan audit (`campaign_scheduled|sent|paused|resumed|cancelled`).

- [ ] **Step 1: Test** — validateLimits (0/negatif, > hari, minute > hour, valid); schedule draft lengkap → scheduled + snapshot ada; schedule tanpa konten ID → missing-id; schedule dengan limit > kapasitas → limits; schedule ulang campaign scheduled → not-draft; scheduledAt lampau → in-past; send-now → queued + snapshot; pause/resume/cancel transitions; claimForSending hanya dari queued (kedua panggilan konkuren → satu true).

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: broadcast status machine, schedule/send-now with provider capacity validation"`

---

### Task 6: Worker broadcast + sending + deliveries

**Files:**
- Create: `src/lib/broadcast/worker.ts`, `src/pages/api/cron/broadcast.ts`
- Modify: `vercel.json` (cron kedua: `{"path": "/api/cron/broadcast", "schedule": "* * * * *"}`)
- Test: `test/broadcast/worker.test.ts`

**Interfaces:**
- Consumes: Task 3/4/5; `sendViaEmailit` dari `src/lib/emailit.ts` (REUSE — sama provider); `emailDeliveries` insert; advisory lock.
- Produces:
  - `processBroadcast(opts?: { fetchImpl?: typeof fetch; now?: Date }): Promise<{ campaignId: string | null; sent: number; skipped: number; stopped: string }>`:
    1. `pg_try_advisory_lock(hashtext('kelaswfa-broadcast-worker'))` — gagal → `{ stopped: "locked" }`; unlock di finally.
    2. Promosikan scheduled yang jatuh tempo: `UPDATE ... SET status='queued' WHERE status='scheduled' AND scheduled_at <= now()`.
    3. Ambil SATU campaign `queued` (oldest). Tidak ada → `{ stopped: "idle" }`.
    4. `claimForSending` — gagal → skip.
    5. Batas pemakaian: `sentThisMinute` = count emailDeliveries campaign ini `sent_at >= now()-60s`; `sentThisHour` = count `>= now()-1h`; `sentTodayProvider` = count SEMUA emailDeliveries (semua campaign) `sent_at >= today00:00`. Hentikan batch bila salah satu cap tercapai → status kembali `queued` (resume tick berikutnya), `stopped: "minute-limit"|"hour-limit"|"day-limit"`.
    6. Loop recipient `pending` hingga `maxPerMinute - sentThisMinute` tercapai: render `renderForRecipient` (linkRewrite pakai raw clickToken recipient; unsubscribe `/api/unsubscribe/<raw>`), `sendViaEmailit` dengan idempotencyKey `bc-<campaignId>-<recipientId>`; sukses → insert emailDeliveries (status `accepted`, sentAt, providerMessageId) + recipient `sent`; gagal → recipient `failed` + delivery `failed` + error; lanjut ke recipient berikut (satu gagal tidak menghentikan).
    7. Semua recipient bukan pending → `markCompleted`. MO_BROADCAST=true env → skip API call, langsung mark accepted (mock untuk test/dev, seperti MOCK_EMAILIT).
    8. Prioritas transaksional: worker broadcast TIDAK menyentuh `email_outbox` — jalur transaksional Plan 1 tetap berdiri sendiri (dokumentasikan di komentar; worker mengalah dengan berhenti setelah batch, cron interval 1 menit).
  - Route `GET /api/cron/broadcast` dengan `x-cron-secret` guard (pola sama dengan outbox).

- [ ] **Step 1: Test** (mock fetch + MO_BROADCAST, kontrol waktu via `now` param):

```ts
// inti kasus (tulis lengkap di file):
// 1. idle ketika tidak ada campaign
// 2. scheduled jatuh tempo dipromosi queued lalu dikirim semua → completed; delivery rows + recipient sent; sent counts benar
// 3. limit menit: maxPerMinute=2, 3 recipient → sent 2, status kembali queued, tick kedua (now+1m) kirim sisa → completed
// 4. limit jam dan harian (seed emailDeliveries historis) → stopped reason benar
// 5. satu gagal (fetch 500) → recipient failed, yang lain tetap terkirim
// 6. dua campaign queued → hanya yang ter oldest diproses dalam satu tick (single sending)
// 7. render memakai clickToken raw: html hasil (tangkap dari mock fetch body) memuat /api/click/<linkId>/<raw> dan /api/unsubscribe/<raw>
```

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: idempotent broadcast worker with limits, advisory lock, and delivery records"`

---

### Task 7: Unsubscribe satu-klik + re-subscribe consent

**Files:**
- Create: `src/pages/api/unsubscribe/[token].ts`, `src/pages/batal-berlangganan/[token].astro`, `src/pages/en/batal-berlangganan/[token].astro`, `src/pages/subscribe-again/[token].astro`
- Modify: `src/lib/subscribe.ts` (alur re-consent), `src/lib/access.ts` (confirm menandai re-subscribed)
- Test: `test/broadcast/unsubscribe.test.ts`

**Interfaces:**
- Produces:
  - `resolveUnsubscribeToken(raw: string): Promise<{ recipientId: string; contactId: string } | null>` — hash lookup `emailCampaignRecipients.clickTokenHash`.
  - `unsubscribeByToken(raw, ip?): Promise<{ ok: boolean }>` — idempoten: set `marketingSubscriptions.status='unsubscribed'` + `unsubscribedAt`, insert `emailSuppressions(emailNormalized, 'unsubscribe')`, insert `consentEvents('unsubscribed')`, audit? (bukan admin — cukup consent event).
  - `resubscribeByToken(raw): Promise<{ ok: boolean } | { ok: false }>` — dari halaman persetujuan: hapus suppression (`unsubscribe` reason), set subscription `active` kembali + consent `resubscribed`.
- Route `GET /api/unsubscribe/[token]`: resolve → unsubscribe → 303 ke `/batal-berlangganan/<raw>` (halaman konfirmasi "Kamu berhenti berlangganan" + catatan bahwa email transaksional reward tetap dikirim); invalid → halaman expired.
- Halaman `subscribe-again/[token]`: diakses dari landing page claim ketika contact unsubscribed — tombol besar persetujuan eksplisit → POST (form) ke route yang memanggil `resubscribeByToken` lalu melanjutkan flow claim (submit ulang otomatis via hidden form ke /api/subscribe dengan timer token yang masih valid, atau instruksi klik kirim lagi; paling sederhana: tombol → resubscribe → redirect ke landing page campaign dengan pesan sukses dan CTA kirim ulang).
- **Modify `src/lib/subscribe.ts`**: contact yang `marketingSubscriptions.status === 'unsubscribed'` DAN claim baru → JANGAN aktifkan marketing; kirim email transaksional akses reward; respons tetap generik; landing page form menampilkan banner persetujuan re-subscribe (Warning Tint, copy eksplisit dari PRD: persetujuan diperlukan sebelum broadcast dikirim lagi). Implementasi: `processSubscribe` cek status; bila unsubscribed → tetap buat claim + kirim access email, tambahkan flag pada halaman cek-email? PRD: "halaman form harus menampilkan persetujuan re-subscribe" — UI: komponen kecil di EmailForm yang muncul bila query `?resub=1`? Tidak bisa tahu sebelum submit. KOMPROMI (ruling): banner re-consent DITAMPILKAN pada halaman akses/konfirmasi dan halaman `subscribe-again` ditautkan dari email transaksional ("Aktifkan kembali newsletter") — persetujuan terjadi di halaman eksplisit, status marketing hanya aktif setelah konfirmasi itu. Dokumentasikan di test.

- [ ] **Step 1: Test** — resolve token valid/invalid; unsubscribe: subscription + suppression + consent event; idempoten (panggil 2× tetap ok, satu consent event tambahan kedua? Ruling: idempoten tanpa consent ganda — cek status dulu); resubscribe: suppression hilang (hanya reason unsubscribe), subscription active, consent resubscribed; subscribe contact unsubscribed → claim tetap dibuat, marketing TIDAK aktif, email akses tetap terkirim.

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: one-click unsubscribe, suppression, and explicit re-subscribe consent"`

---

### Task 8: Click tracking redirect aman

**Files:**
- Create: `src/pages/api/click/[linkId]/[token].ts`, `src/lib/broadcast/links.ts`
- Test: `test/broadcast/links.test.ts`

**Interfaces:**
- Consumes: `emailLinks`, `emailCampaignRecipients.clickTokenHash`, `emailDeliveries`.
- Produces:
  - `resolveClick(linkId: string, rawToken: string): Promise<{ ok: true; url: string } | { ok: false }>` — link ada + token hash cocok recipient → catat klik: `emailDeliveries` recipient terkait di-update? Klik disimpan di mana? PRD: "link click boleh dilacak" + KPI Clicks. Tambah kolom `clickedAt` timestamp nullable pada `emailCampaignRecipients` (migrasi kecil di task ini) — satu klik pertama tercatat (idempoten: `coalesce`). Return url asli.
  - Route `GET /api/click/[linkId]/[token]`: resolve → 302 ke url; invalid → 404. `Cache-Control: no-store`.

- [ ] **Step 1: Test** — resolve valid → url + clickedAt terisi sekali (panggil 2×, clickedAt tidak berubah); token salah / linkId salah → {ok:false}.

- [ ] **Step 2: FAIL → Step 3: Implementasi (migrasi kolom) → Step 4: PASS → Commit** — `git commit -m "feat: safe click-tracking redirect with idempotent first-click recording"`

---

### Task 9: Webhook Emailit

**Files:**
- Create: `src/pages/api/webhooks/emailit.ts`, `src/lib/broadcast/webhooks.ts`
- Modify: `.env.example` (`EMAILIT_WEBHOOK_SECRET=`)
- Test: `test/broadcast/webhooks.test.ts`

**Interfaces:**
- Consumes: `emailDeliveries` (by providerMessageId), `emailProviderEvents`, `emailSuppressions`, `contacts`.
- Produces:
  - `verifyEmailitSignature(rawBody: string, signature: string | null): boolean` — HMAC-SHA256 hex dari rawBody dengan `EMAILIT_WEBHOOK_SECRET`, perbandingan timing-safe (`timingSafeEqual`); signature header `x-emailit-signature`.
  - `processEmailitEvent(event: { type: string; message_id?: string; recipient_email?: string; raw: unknown }): Promise<"recorded" | "ignored" | "unknown-message">`:
    - Simpan raw event ke `emailProviderEvents` (idempoten via unique `(providerMessageId, eventType)`; duplicate → "ignored").
    - Map type → status: `email.delivered`→`delivered`; `email.bounced`→`bounced` (hard) ; `email.complaint`→`suppressed`; `email.failed`→`failed`; type lain → simpan event saja.
    - Update `emailDeliveries` terkait (by providerMessageId): set status + deliveredAt/bouncedAt; hard bounce/complaint → insert `emailSuppressions(emailNormalized, 'hard_bounce'|'complaint')` (email dari event `recipient_email`, dinormalisasi).
  - Route `POST /api/webhooks/emailit`: baca RAW body (`await request.text()`), verifikasi signature (gagal → 401), parse JSON, processEmailitEvent → 200. `Cache-Control: no-store`.

- [ ] **Step 1: Test** — signature salah → false; valid → true (hitung HMAC di test dengan env secret); delivered event → delivery status updated + event row; duplicate event → ignored (tidak menambah baris kedua); hard bounce → delivery bounced + suppression row; unknown message_id → "unknown-message" (event tetap tersimpan untuk audit).

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: verified idempotent emailit webhook with suppression on hard bounce"`

---

### Task 10: Stats + test send + delivery status di contact view

**Files:**
- Create: `src/lib/broadcast/stats.ts`
- Modify: `src/lib/admin/contacts.ts` (getContactDetail tambah `deliveries`), `src/pages/admin/contacts/[id].astro` (tabel delivery)
- Test: `test/broadcast/stats.test.ts`, tambahan case di `test/admin/contacts.test.ts`

**Interfaces:**
- Consumes: schema broadcast; `TEST_SEND_ADDRESSES` env.
- Produces:
  - `campaignStats(campaignId): Promise<{ recipients: number; sent: number; delivered: number; failed: number; bounced: number; unsubscribed: number; clicks: number }>` — unsubscribed = recipient yang contact-nya unsubscribe SETELAH campaign dikirim (consent event antara sentAt dan sekarang); clicks = recipients dengan clickedAt not null. Angka tabular, tanpa open rate (DESIGN.md: jangan buat kartu Open Rate).
  - `progressOf(campaignId): Promise<{ total: number; sentSoFar: number }>` — untuk baris "Mengirim X dari Y".
  - `sendTestEmail(campaignId, address, auditOpts): Promise<{ ok: true } | { ok: false; reason: "not-allowed" | "no-content" }>` — address harus ada di `TEST_SEND_ADDRESSES` (comma-separated env); render locale id + en (dua email, subject prefix `[TEST]`); kirim via outbox `emailType: "broadcast_test"` (idempotencyKey unik per call timestamp); TIDAK menyentuh recipients/stats.
  - `getContactDetail` (contacts.ts): tambah `deliveries: { emailType, status, sentAt, deliveredAt, bouncedAt }[]` (join emailDeliveries by contactId, desc). Halaman detail: tabel delivery sederhana dengan badge.

- [ ] **Step 1: Test** — stats dengan fixture: 3 recipient (2 sent+delivered, 1 failed), 1 click, 1 unsubscribe pasca-kirim → angka benar; test send ke alamat bukan allowlist → not-allowed; test send → 2 outbox rows (id+en) bertanda [TEST], recipients tetap kosong; contact detail menyertakan deliveries.

- [ ] **Step 2: FAIL → Step 3: Implementasi → Step 4: PASS → Commit** — `git commit -m "feat: campaign KPIs, progress, test send, and delivery history in contact view"`

---

### Task 11: Composer UI (list, editor, schedule/send, review modal)

**Files:**
- Create: `src/pages/admin/email-campaigns/index.astro`, `new.astro`, `[id].astro`, `src/pages/admin/api/email-campaigns/index.ts`, `[id].ts`, `[id]/schedule.ts`, `[id]/test-send.ts`, `[id]/pause.ts`, `[id]/resume.ts`, `[id]/cancel.ts`
- Modify: `AdminLayout.astro` (nav "Email Campaign")
- Test: logika lib sudah tertutup; build + smoke

**Interfaces:**
- Consumes: Task 2–6, 10 lib; guard; AdminLayout; pola editor reward campaign (Task 10 Plan 2).
- Halaman (semua gated + prerender=false):
  - **List**: tabel campaign (subject ID, status badge ikon+teks, jadwal, snapshot size, aksi Edit/Laporan) + primary "Buat email campaign".
  - **Composer** `new` + `[id]`, urutan form sesuai DESIGN.md §6: Segment (radio: Semua subscriber / locale chips / claim campaign multi-select + mode ANY/ALL; `Audience estimate: N subscriber` live via API count `POST /admin/api/email-campaigns/count` {filter} — tambahkan route kecil ini) → Bahasa (badge "EN kosong — fallback ID") → Subject/Preheader ID+EN → Body ID+EN (textarea HTML sederhana dengan hint tag yang diizinkan; preview sanitize di panel Preview) → Jadwal (datetime-local atau "Kirim sekarang") → Rate limit (max/min, max/jam + helper `Kapasitas provider: 2/detik, 5.000/hari`).
  - **Preview** desktop/mobile: dua iframe side-by-side (stack mobile) dengan html hasil `renderForRecipient` untuk email dummy per locale (route kecil `GET /admin/api/email-campaigns/[id]/preview?locale=id&viewport=desktop|mobile` mengembalikan html lengkap).
  - **Send/Schedule**: tombol membuka review modal (DESIGN.md): nama campaign, jumlah recipient (count), segment ringkas, bahasa, subject preview, jadwal, limit; CTA eksplisit `Kirim ke N subscriber` / `Jadwalkan campaign`; panggil `POST .../schedule` `{scheduledAt: null | iso}` → response `{ok, recipients: N}`; gagal limits/missing → pesan spesifik.
  - **Test send**: input alamat (prefill ADMIN_EMAIL) + tombol → `POST .../test-send`; sukses → toast inline.
  - **Pause/Resume/Cancel** di halaman report (Task 12) — route dibuat di task ini, dipakai Task 12: POST pause/resume/cancel dengan confirm (cancel dialog destructive konfirmasi kedua).
- Missing translation: badge `EN belum lengkap` Warning Tint di composer; schedule tetap diizinkan (fallback) tapi badge terlihat sebelum schedule (PRD).

- [ ] **Step 1: Routes** (count, preview, schedule, test-send, pause, resume, cancel — semua guard + prerender=false).
- [ ] **Step 2: UI** — ikuti pola editor reward campaign; satu CTA primer per state; required "Wajib"; error inline.
- [ ] **Step 3: `npm test && npm run build` PASS → Commit** — `git commit -m "feat: email campaign composer with segmentation, preview, review modal, and schedule"`

---

### Task 12: Reporting UI (KPI, progress, recipients) + pause/resume/cancel wiring

**Files:**
- Create: `src/pages/admin/email-campaigns/[id]/report.astro`
- Test: build + smoke; lib tertutup Task 10

**Interfaces:**
- Consumes: `campaignStats`, `progressOf`, routes pause/resume/cancel (Task 11), schema recipients.
- Produces: halaman laporan per DESIGN.md §6 Delivery & analytics:
  - Header: subject + badge status + tombol Pause (Warning Amber) / Resume / Cancel (destructive dialog) sesuai status.
  - Progress broadcast: `Mengirim X dari Y` + kecepatan limit aktif + waktu update terakhir (snapshotAt/updated).
  - KPI row: Sent, Delivered, Failed, Bounced, Unsubscribed, Clicks — angka tabular dengan label periode, TANPA kartu Open Rate, tanpa chart dekoratif.
  - Tabel recipient (paginate sederhana limit 50): email, locale, status delivery badge ikon+teks, clickedAt; filter status via query param.
  - **Resend gagal kirim** (PRD §10: "Admin dapat melihat error dan resend sesuai throttle"): tombol `Kirim ulang yang gagal` bila ada recipient `failed` → `POST /admin/api/email-campaigns/[id]/retry-failed` (route baru di task ini) mengembalikan recipient `failed` → `pending` (dengan audit `campaign_retry_failed`), worker tick berikutnya mengirim ulang lewat limit yang sama. Error per recipient terlihat di tabel (kolom error, truncate).
- [ ] **Step 1: Halaman → Step 2: `npm run build` + `npm test` → Step 3: Commit** — `git commit -m "feat: broadcast report with KPIs, progress, and recipient table"`

---

### Task 13: E2E broadcast smoke

**Files:**
- Create: `test/broadcast/e2e/broadcast.spec.ts`
- Modify: `scripts/seed.ts` (cleanup `admin-e2e-%` campaigns + email campaigns e2e lama — deferred minor T16 Plan 2)

**Interfaces:**
- Produces: satu test Playwright panjang (login admin — pola `test/admin/e2e/admin.spec.ts`, OTP dari outbox):
  1. Buat email campaign (subject ID, body dengan 1 link https) → save.
  2. Segment all → audience estimate ≥ 1 (seed membuat contact confirmed+active via SQL helper di test).
  3. Review modal → `Kirim sekarang` → status `queued`.
  4. Panggil worker: `request` API `GET /api/cron/broadcast` dengan header `x-cron-secret` (env test) → response `sent: 1`.
  5. Report: KPI Sent 1, Delivered 0 (belum webhook) → simulasikan webhook `POST /api/webhooks/emailit` dengan signature HMAC benar (hitung di test dari env secret) event delivered → refresh → Delivered 1.
  6. Buka link unsubscribe dari email terkirim (query outbox/delivery — ambil raw token dari html kolom outbox broadcast test? Worker mengirim via emailit MOCK → tangkap body dari mock? e2e memakai MO_BROADCAST=true env webServer; raw token tersedia di emailDeliveries? TIDAK. Ambil dari tabel `email_campaign_recipients`? hash saja. SOLUSI: e2e mengambil html terkirim dari MO_BROADCAST capture — simpan hasil render di kolom baru? TERLALU JAUH. Ruling: worker dengan MO_BROADCAST=true menyimpan html render ke kolom `last_rendered_html` (text nullable) pada `emailCampaignRecipients` — berguna juga untuk debugging; e2e membaca raw token dari sana (regex `/api/unsubscribe/([A-Za-z0-9_-]{43})`).) → GET unsubscribe URL → halaman konfirmasi; contact jadi unsubscribed + suppression row (assert via psql/query helper).
  7. Report KPI Unsubscribed 1.
- Tambah kolom `lastRenderedHtml` text nullable di `emailCampaignRecipients` (migrasi, Task 6 yang mengisinya).

- [ ] **Step 1: Migrasi kolom + worker menyimpan render (Task 6 sudah berlalu — lakukan di sini: migrasi + 1 baris di worker + test worker tetap hijau)**
- [ ] **Step 2: Tulis spec → jalankan sampai hijau** — `npx playwright test` (5/5 semua file).
- [ ] **Step 3: Commit** — `git commit -m "test: broadcast e2e from composer to unsubscribe"`

---

### Task 14: Hardening launch (batch deferred minors)

**Files:**
- Modify: `src/middleware.ts` (baru), `src/lib/emailit.ts`? tidak, `src/lib/outbox.ts`/`mailworker.ts` (SKIP LOCKED), `src/lib/ratelimit.ts`? no, `src/lib/admin/login.ts` (dummy hash), `src/pages/admin/api/logout.ts` (revoke device), `src/lib/admin/domains.ts`? no, `src/lib/admin/contacts.ts` (CSV prefix guard + ILIKE escape), `src/lib/admin/campaigns.ts`? no, `src/lib/admin/sessions.ts`+`otp.ts` (UUID_RE dedup), `src/lib/notfound.ts` (notFoundResponse dedup), `src/pages/admin/api/campaigns/[id]/assets.ts` (Content-Length pre-check), `src/pages/r/[slug].astro` + en (hapus notFoundResponse duplikat), `src/lib/subscribe.ts` (trusted-proxy IP), `test/hardening.test.ts`
- Test: `test/hardening.test.ts`

**Interfaces (semua item kecil, satu commit):**
1. `src/middleware.ts`: security headers untuk SEMUA response — `Strict-Transport-Security: max-age=31536000; includeSubDomains` (hanya production), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (kecuali preview iframe admin → gunakan CSP frame-ancestors 'self' alih-alih DENY, dan kecualikan path `/admin/api/email-campaigns/*/preview` dari frame-ancestors ketat? — KOMPROMI: CSP default `frame-ancestors 'none'`; preview dirender sebagai iframe same-origin di admin → butuh `frame-ancestors 'self'` pada route preview via header per-response di route itu sendiri), `Referrer-Policy: strict-origin-when-cross-origin`, CSP minimal: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (unsafe-inline style diperlukan — UI memakai inline styles dari Plan 1/2). Route preview menimpa dengan `frame-ancestors 'self'`.
2. Outbox worker SKIP LOCKED: `processOutbox` select dengan `FOR UPDATE SKIP LOCKED` (drizzle: `.for("update", { skipLocked: true })`) — hilangkan double-send saat cron overlap (deferred Plan 1).
3. Timing: `startLogin` unknown email → verifikasi terhadap dummy Argon2 hash konstanta (hardcoded hash dari "dummy-password-123") sebelum return invalid (deferred Plan 2).
4. Logout: revoke juga trusted device token dari cookie (deferred Plan 2).
5. CSV formula injection: `csvEscape` menambahkan `'` prefix untuk cell diawali `=`/`+`/`-`/`@` (deferred Plan 2).
6. ILIKE escape: `listContacts` search escape `%` dan `_` (deferred Plan 2).
7. UUID_RE dedup: ekspor `UUID_RE` dari `src/lib/admin/login.ts`, hapus duplikat di `otp.ts` route (deferred Plan 2).
8. `notFoundResponse` dipindah ke `src/lib/notfound.ts`, kedua halaman r/[slug] meng-import (deferred Plan 2).
9. Content-Length pre-check di route upload asset: tolak > MAX_UPLOAD_BYTES + 1KB overhead sebelum `formData()` (deferred Plan 2).
10. Trusted-proxy IP helper: `clientIp(request)` di `src/lib/env.ts`? Bukan env — buat `src/lib/ip.ts`: baca `X-Forwarded-For` dan ambil elemen TERAKHIR (dipercaya dari proxy terdekat, standar Vercel) — buat sekali, gunakan di subscribe + admin login (deferred; dokumentasikan asumsi single-proxy).
11. Seed cleanup `admin-e2e-%` + email campaigns e2e (deferred Plan 2).
- Test `test/hardening.test.ts`: CSP header via middleware unit (panggil middleware dengan Request mock), csvEscape prefix, ILIKE escape (search `%` tidak match semua), clientIp last-element, dummy-hash timing path (functional: unknown email tetap invalid), logout revoke device (functional), SKIP LOCKED tidak bisa dites race — cukup pastikan query mengandung for-update (skip test, catat di komentar).

- [ ] **Step 1: Tulis test (FAIL untuk item yang bisa dites) → Step 2: Implementasi semua item → Step 3: `npm test && npx playwright test && npm run build` hijau → Commit** — `git commit -m "feat: launch hardening (security headers, skip-locked, timing, csv, ip, cleanup)"`

---

### Task 15: Dokumentasi operasi + README

**Files:**
- Modify: `README.md` (ganti boilerplate Astro)
- Create: `docs/operations.md`

**Interfaces:** Tidak ada kode baru — dokumentasi operasional (PRD §10 reliability):
- README: ringkasan produk, quickstart dev (docker, migrate, seed, bootstrap admin, dev), struktur test, deployment Vercel (env list dari .env.example + cron).
- `docs/operations.md`: checklist launch dari PRD — SPF/DKIM/DMARC verifikasi sebelum production send; backup Neon PITR + prosedur restore test; alert yang dipantau (webhook gagal, hard bounce naik, antrean tertahan, job broadcast tidak maju — query SQL siap pakai untuk masing-masing); prosedur pause/cancel darurat; rotasi `TOKEN_SECRET`/`CRON_SECRET`/`EMAILIT_WEBHOOK_SECRET`; catatan kapasitas Emailit (2/detik, 5.000/hari) dan cara mengubah via env.

- [ ] **Step 1: Tulis README + docs/operations.md (konten nyata, query SQL eksplisit) → Step 2: Commit** — `git commit -m "docs: operations runbook and readme"`

---

## Setelah Plan 3 selesai

Seluruh MVP PRD terimplementasi. Acceptance criteria PRD §12 yang belum terverifikasi otomatis (deliverability production, backup restore drill, Lighthouse ≥ 95, UAT) adalah pekerjaan ops/launch — checklist di `docs/operations.md`.
