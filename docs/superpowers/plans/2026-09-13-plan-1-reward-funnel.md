# KelasWFA Plan 1 — Reward Funnel End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi aplikasi dan funnel reward publik end-to-end: landing page reward dinamis ID/EN, timer 30 detik tervalidasi server, submit email dengan proteksi spam, contact global + double opt-in, email transaksional via Emailit, dan unduhan file reward via signed URL 1 jam.

**Architecture:** Astro SSR (Node adapter) melayani halaman publik dan server endpoints. Semua logika bisnis hidup di modul `src/lib/*` murni (tanpa import Astro) agar unit-testable; pages/endpoints hanya pipa tipis. Postgres (Neon) adalah source of truth; email keluar ditulis ke tabel outbox sebelum dikirim ke Emailit API oleh worker idempoten. File reward disimpan privat di Cloudflare R2 dan hanya diakses lewat signed URL 1 jam.

**Tech Stack:** Astro 5 (SSR, Node adapter), TypeScript, Drizzle ORM + Neon PostgreSQL, postgres-js, Cloudflare R2 (S3-compatible, presign via aws4fetch), Emailit REST API, Vitest, Playwright (smoke test akhir).

**Spec:** `.agents/kelaswfa-newsletter-prd-v2.md` (bagian 7.1–7.2, 8, 9, 10) dan `.agents/DESIGN.md` (design system). Executor wajib membaca keduanya.

**Ruang lingkup plan ini (dan apa yang TIDAK):**

- Termasuk: scaffold, schema DB untuk domain reward/kontak, landing page, timer, subscribe, confirm, access, signed download, outbox + Emailit transactional, allowlist, rate limit, seed script, smoke test.
- Tidak termasuk (jadwal plan berikut): dashboard admin + auth OTP + CMS + upload UI (Plan 2), broadcast engine + unsubscribe/click tracking + webhook delivery + reporting (Plan 3). Pada Plan 1, reward campaign dan asset dibuat lewat `scripts/seed.ts`; alur re-subscribe setelah unsubscribe menunggu Plan 3 (belum ada jalur unsubscribe).

---

## Global Constraints

- Domain aplikasi: `https://kado.kelaswfa.my.id`. Bahasa ID: `/r/<slug>`; EN: `/en/r/<slug>`; default ID.
- Pengirim email: `KelasWFA <admin@kelaswfa.my.id>`; Reply-to `admin@kelaswfa.my.id`.
- Timer 30 detik DIVALIDASI DI SERVER: token timer berumur < 30 detik ditolak; submit selalu generik (tidak membocorkan keberadaan email).
- Token akses email: opaque, CSPRNG ≥ 256 bit, disimpan sebagai hash SHA-256, berlaku 7 hari, sekali pakai.
- Signed download URL: berlaku 1 jam; object key tidak pernah diekspos permanen.
- Allowlist domain default: `gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, proton.me`.
- Satu email normalisasi (trim + lowercase) = satu `CONTACT` global; `REWARD_CLAIM` unique `(contact_id, reward_campaign_id)`.
- Fallback bahasa: konten EN kosong → pakai ID (eksplisit).
- File reward ≤ 100 MB; MIME diizinkan: `application/pdf, application/zip, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.presentationml.presentation, image/png, image/jpeg, image/webp`.
- IP disimpan hanya sebagai hash (SHA-256 + salt), tidak diekspor.
- Email transaksional: retry exponential backoff, idempotency key per delivery; gagal kirim tidak menghapus contact/claim.
- Design system: pakai CSS custom properties dari `.agents/DESIGN.md` §11 (jangan hardcode warna); font Plus Jakarta Sans; satu CTA Forest Action per state; `prefers-reduced-motion` dihormati.
- Tanpa open tracking pixel. Tanpa `astro:env` — env dibaca lewat `src/lib/env.ts` (process.env) agar testable.
- Jangan pernah commit secret; semua credential via `.env` (gitignored).

## File Structure

```
docker-compose.yml              # Postgres lokal untuk dev/test
.env.example
src/
  styles/tokens.css             # CSS custom properties dari DESIGN.md §11
  layouts/PublicLayout.astro    # shell publik (header, lang, meta)
  lib/
    env.ts                      # pembacaan env terpusat
    db.ts                       # postgres-js + drizzle client
    schema.ts                   # semua tabel drizzle (domain plan 1)
    email.ts                    # normalizeEmail, isValidEmailSyntax
    allowlist.ts                # isDomainAllowed (query EMAIL_DOMAIN)
    crypto.ts                   # HMAC pack/unpack, opaque token, hash
    timer.ts                    # issue/verifyTimerToken (30 dtk, 2 jam max)
    ratelimit.ts                # fixed-window di Postgres, IP di-hash
    outbox.ts                   # enqueueTransactionalEmail
    emailit.ts                  # adapter REST Emailit (fetch injectable)
    mailworker.ts               # processOutbox (idempoten, backoff)
    templates.ts                # email konfirmasi & akses reward ID/EN
    storage.ts                  # presignSignedUrl R2 (aws4fetch), 1 jam
    access.ts                   # issue access/confirm/session token, konsumsi
    i18n.ts                     # dict UI id/en + fallback id
  pages/
    index.astro                 # halaman hello + link health
    r/[slug].astro              # landing reward ID
    en/r/[slug].astro           # landing reward EN
    cek-email.astro             # halaman generik "Cek email" (id) + en/cek-email.astro
    konfirmasi/[token].astro    # GET: konfirmasi email → redirect akses (id) ; en/konfirmasi/[token].astro
    akses/[token].astro         # halaman unduhan reward (id); en/akses/[token].astro
    api/timer-token.ts          # POST: terbitkan token timer
    api/subscribe.ts            # POST: submit email (semua validasi server)
    api/download/[session]/[assetId].ts  # GET: 302 ke signed URL
    api/cron/outbox.ts          # GET (CRON_SECRET): jalankan worker
    api/health.ts               # GET: cek DB
    privacy.astro               # kebijakan privasi sederhana
  components/
    RewardHero.astro
    RewardItemList.astro
    ReflectionTabs.astro        # tab Doa Muslim / Harapan Baik + script
    EmailForm.astro             # form + island timer + honeypot
  scripts (root):
scripts/seed.ts                 # seed allowlist, doa templates, campaign contoh
test/
  helpers.ts                    # test db reset, env mock
  email.test.ts
  allowlist.test.ts
  crypto.test.ts
  timer.test.ts
  ratelimit.test.ts
  outbox.test.ts
  templates.test.ts
  storage.test.ts
  access.test.ts
  subscribe.test.ts
  e2e/funnel.spec.ts            # Playwright
playwright.config.ts
```

---

### Task 1: Scaffold Astro + Node adapter + design tokens + health endpoint

**Files:**
- Create: `package.json` (via create-astro), `astro.config.mjs`, `tsconfig.json`, `src/styles/tokens.css`, `src/layouts/PublicLayout.astro`, `src/pages/index.astro`, `src/pages/api/health.ts`, `src/lib/env.ts`, `.env.example`, `.gitignore`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: `env(name: string, fallback?: string): string` dari `src/lib/env.ts`; route `GET /api/health` → `{ status: "ok" }` (200) / `{ status: "error" }` (503); `tokens.css` dengan seluruh custom properties DESIGN.md §11 yang di-import `PublicLayout.astro`.

- [ ] **Step 1: Scaffold project**

```bash
npm create astro@latest . -- --template minimal --no-install --no-git --typescript strict
npm install
npx astro add node --yes
npm install -D vitest
```

Tambahkan di `package.json` → `"scripts": { "test": "vitest run", "seed": "tsx scripts/seed.ts" }` dan install `npm i -D tsx`.

- [ ] **Step 2: Tulis `.gitignore` dan `.env.example`**

`.gitignore`:

```
node_modules/
dist/
.env
.astro/
test-results/
```

`.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kelaswfa
TOKEN_SECRET=change-me-min-32-chars-random
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=kelaswfa-rewards
IP_HASH_SALT=change-me
EMAILIT_API_KEY=
CRON_SECRET=change-me
MOCK_EMAILIT=true
PUBLIC_SITE_URL=http://localhost:4321
```

- [ ] **Step 3: Tulis `src/lib/env.ts`**

```ts
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env: ${name}`);
}
```

- [ ] **Step 4: Tulis `src/styles/tokens.css`**

Salin blok `:root { ... }` lengkap dari `.agents/DESIGN.md` §11 (CSS Custom Properties) — persis, tanpa perubahan nilai — plus:

```css
*,
*::before,
*::after { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-sans); color: var(--color-text); background: var(--color-canvas); }
:focus-visible { outline: none; box-shadow: var(--focus-ring); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 5: Tulis `src/layouts/PublicLayout.astro`**

```astro
---
import "../styles/tokens.css";
interface Props { title: string; description?: string; lang?: "id" | "en"; noindex?: boolean; }
const { title, description = "", lang = "id", noindex = false } = Astro.props;
---
<!doctype html>
<html lang={lang}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    {noindex && <meta name="robots" content="noindex" />}
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 6: Tulis `src/pages/api/health.ts`**

```ts
import type { APIRoute } from "astro";
export const GET: APIRoute = async () => {
  try {
    const { db } = await import("../../lib/db");
    await db.execute("select 1");
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ status: "error" }), { status: 503 });
  }
};
```

(Catatan: Task 2 membuat `src/lib/db.ts`; buat stub sementara `export const db = { execute: async () => {} };` yang diganti Task 2.)

- [ ] **Step 7: Tulis `src/pages/index.astro`**

```astro
---
import PublicLayout from "../layouts/PublicLayout.astro";
---
<PublicLayout title="KelasWFA Kado">
  <main style="padding: var(--space-20) var(--space-5); max-width: var(--funnel-content); margin: 0 auto;">
    <h1 style="color: var(--color-ink);">KelasWFA Kado</h1>
    <p>Halaman hadiah KelasWFA.</p>
  </main>
</PublicLayout>
```

- [ ] **Step 8: Tulis `test/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { GET } from "../src/pages/api/health";

describe("GET /api/health", () => {
  it("returns ok when db reachable", async () => {
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ status: "ok" }));
  });
});
```

- [ ] **Step 9: Konfigurasi Vitest (`vitest.config.ts`)**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 10: Jalankan build dan test**

Run: `npm run build && npm test`
Expected: build sukses; test PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "chore: scaffold astro with node adapter, design tokens, health endpoint"
```

---

### Task 2: Postgres lokal + Drizzle schema + migrasi

**Files:**
- Create: `docker-compose.yml`, `src/lib/db.ts`, `src/lib/schema.ts`, `drizzle.config.ts`
- Modify: `src/pages/api/health.ts` (hapus stub), `package.json` (script `db:generate`, `db:migrate`)
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: `db` (drizzle instance, postgres-js) dan seluruh tabel dari `src/lib/schema.ts`: `contacts`, `marketingSubscriptions`, `consentEvents`, `rewardCampaigns`, `rewardCampaignLocales`, `rewardAssets`, `rewardClaims`, `accessTokens`, `doaTemplates`, `doaSelections`, `emailDomains`, `emailOutbox`, `rateLimits` — beserta tipe `Contact = typeof contacts.$inferSelect` dsb.

- [ ] **Step 1: Tulis `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: kelaswfa
    ports: ["5432:5432"]
    volumes: ["kelaswfa-pgdata:/var/lib/postgresql/data"]
volumes:
  kelaswfa-pgdata:
```

Run: `docker compose up -d`

- [ ] **Step 2: Install dan konfigurasi Drizzle**

```bash
npm i drizzle-orm postgres
npm i -D drizzle-kit
```

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Tambahkan script: `"db:generate": "drizzle-kit generate", "db:migrate": "tsx scripts/migrate.ts"`.

- [ ] **Step 3: Tulis `src/lib/db.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
export const sqlClient = postgres(env("DATABASE_URL"), { max: 5 });
export const db = drizzle(sqlClient);
```

Ganti stub health endpoint dengan import statis `import { db } from "../../lib/db";`.

- [ ] **Step 4: Tulis `src/lib/schema.ts`**

```ts
import { pgTable, uuid, varchar, text, timestamp, integer, bigint, boolean, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";

export const contacts = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  emailNormalized: varchar("email_normalized", { length: 254 }).notNull().unique(),
  locale: varchar("locale", { length: 2 }).notNull().default("id"),
  confirmationStatus: varchar("confirmation_status", { length: 20 }).notNull().default("pending"), // pending | confirmed
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingSubscriptions = pgTable("marketing_subscription", {
  contactId: uuid("contact_id").primaryKey().references(() => contacts.id),
  status: varchar("status", { length: 20 }).notNull().default("inactive"), // inactive | active | unsubscribed
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  source: varchar("source", { length: 100 }),
});

export const consentEvents = pgTable("consent_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  event: varchar("event", { length: 30 }).notNull(), // subscribed | unsubscribed | resubscribed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaigns = pgTable("reward_campaign", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | published | paused | archived
  featuredImageKey: text("featured_image_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaignLocales = pgTable("reward_campaign_locale", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  locale: varchar("locale", { length: 2 }).notNull(), // id | en
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  rewardItems: jsonb("reward_items").notNull().default([]), // [{ name, benefit, format?, size? }]
  metaTitle: varchar("meta_title", { length: 200 }),
  metaDescription: text("meta_description"),
}, (t) => [uniqueIndex("campaign_locale_uq").on(t.campaignId, t.locale)]);

export const rewardAssets = pgTable("reward_asset", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  nameId: varchar("name_id", { length: 200 }).notNull(),
  nameEn: varchar("name_en", { length: 200 }),
  descId: text("desc_id"),
  descEn: text("desc_en"),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardClaims = pgTable("reward_claim", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id),
  status: varchar("status", { length: 20 }).notNull().default("access_sent"), // access_sent | accessed
  firstClaimedAt: timestamp("first_claimed_at", { withTimezone: true }).notNull().defaultNow(),
  lastAccessSentAt: timestamp("last_access_sent_at", { withTimezone: true }),
}, (t) => [uniqueIndex("claim_contact_campaign_uq").on(t.contactId, t.campaignId)]);

export const accessTokens = pgTable("access_token", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => rewardClaims.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(), // confirm | access | session
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("access_token_claim_idx").on(t.claimId)]);

export const doaTemplates = pgTable("doa_template", {
  id: uuid("id").defaultRandom().primaryKey(),
  variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
  locale: varchar("locale", { length: 2 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  content: text("content").notNull(),
});

export const doaSelections = pgTable("doa_selection", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
  templateId: uuid("template_id").notNull().references(() => doaTemplates.id),
}, (t) => [uniqueIndex("doa_selection_uq").on(t.campaignId, t.variant)]);

export const emailDomains = pgTable("email_domain", {
  domain: varchar("domain", { length: 254 }).primaryKey(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  emailType: varchar("email_type", { length: 30 }).notNull(), // confirmation | reward_access
  toEmail: varchar("to_email", { length: 254 }).notNull(),
  subject: varchar("subject", { length: 300 }).notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | sent | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limit", {
  key: varchar("key", { length: 200 }).primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});
```

- [ ] **Step 5: Tulis `scripts/migrate.ts`**

```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/lib/db";
await migrate(db, { migrationsFolder: "./drizzle" });
await sqlClient.end();
console.log("migrated");
```

- [ ] **Step 6: Tulis `test/helpers.ts`**

```ts
import { sqlClient } from "../src/lib/db";
export async function resetDb() {
  await sqlClient.unsafe(`
    TRUNCATE rate_limit, email_outbox, doa_selection, doa_template, access_token,
    reward_claim, reward_asset, reward_campaign_locale, reward_campaign,
    consent_event, marketing_subscription, contact, email_domain CASCADE;
  `);
}
```

- [ ] **Step 7: Tulis `test/schema.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/lib/db";
import { contacts } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./helpers";

describe("schema", () => {
  beforeEach(resetDb);
  it("inserts and reads a contact", async () => {
    await db.insert(contacts).values({ emailNormalized: "a@b.com" });
    const [row] = await db.select().from(contacts).where(eq(contacts.emailNormalized, "a@b.com"));
    expect(row.confirmationStatus).toBe("pending");
  });
  it("rejects duplicate email", async () => {
    await db.insert(contacts).values({ emailNormalized: "dup@b.com" });
    await expect(db.insert(contacts).values({ emailNormalized: "dup@b.com" })).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Generate & jalankan migrasi, lalu test**

```bash
npm run db:generate && npm run db:migrate
npm test
```

Expected: migrasi sukses; test PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: drizzle schema for contact, reward claim, tokens, outbox, allowlist"
```

---

### Task 3: Normalisasi & validasi email

**Files:**
- Create: `src/lib/email.ts`
- Test: `test/email.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(raw: string): string | null` (trim, lowercase; null jika tidak valid) dan `emailDomain(normalized: string): string`. Sintaks valid: ada tepat satu `@`, local part 1–64 karakter, domain 1–253 dengan minimal satu titik, total ≤ 254.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, emailDomain } from "../src/lib/email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Budi@GMAIL.Com ")).toBe("budi@gmail.com");
  });
  it("rejects invalid syntax", () => {
    expect(normalizeEmail("budi")).toBeNull();
    expect(normalizeEmail("budi@")).toBeNull();
    expect(normalizeEmail("budi@@gmail.com")).toBeNull();
    expect(normalizeEmail("budi@nodot")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
  it("rejects over-long address", () => {
    const long = "a".repeat(250) + "@gmail.com";
    expect(normalizeEmail(long)).toBeNull();
  });
  it("extracts domain", () => {
    expect(emailDomain("budi@gmail.com")).toBe("gmail.com");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/email.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Tulis `src/lib/email.ts`**

```ts
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length === 0 || v.length > 254) return null;
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

export function emailDomain(normalized: string): string {
  return normalized.split("@")[1];
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts test/email.test.ts && git commit -m "feat: email normalization and syntax validation"
```

---

### Task 4: Allowlist domain email

**Files:**
- Create: `src/lib/allowlist.ts`
- Test: `test/allowlist.test.ts`

**Interfaces:**
- Consumes: `db`, `emailDomains` (Task 2).
- Produces: `isDomainAllowed(domain: string): Promise<boolean>` — hanya domain aktif yang lolos; `DEFAULT_DOMAINS: string[]` (dipakai seed).

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { isDomainAllowed, DEFAULT_DOMAINS } from "../src/lib/allowlist";
import { db } from "../src/lib/db";
import { emailDomains } from "../src/lib/schema";
import { resetDb } from "./helpers";

describe("isDomainAllowed", () => {
  beforeEach(resetDb);
  it("allows active domain", async () => {
    await db.insert(emailDomains).values({ domain: "gmail.com", active: true });
    expect(await isDomainAllowed("gmail.com")).toBe(true);
  });
  it("rejects inactive and unknown domain", async () => {
    await db.insert(emailDomains).values({ domain: "gmail.com", active: false });
    expect(await isDomainAllowed("gmail.com")).toBe(false);
    expect(await isDomainAllowed("spam.example")).toBe(false);
  });
  it("is case-insensitive", async () => {
    await db.insert(emailDomains).values({ domain: "gmail.com" });
    expect(await isDomainAllowed("GMAIL.COM")).toBe(true);
  });
  it("DEFAULT_DOMAINS contains the 9 PRD domains", () => {
    expect(DEFAULT_DOMAINS).toEqual([
      "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
      "yahoo.com", "icloud.com", "me.com", "proton.me",
    ]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/allowlist.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/allowlist.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { emailDomains } from "./schema";

export const DEFAULT_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me",
];

export async function isDomainAllowed(domain: string): Promise<boolean> {
  const rows = await db.select().from(emailDomains)
    .where(and(eq(emailDomains.domain, domain.toLowerCase()), eq(emailDomains.active, true)))
    .limit(1);
  return rows.length > 0;
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/allowlist.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/allowlist.ts test/allowlist.test.ts && git commit -m "feat: email domain allowlist check"
```

---

### Task 5: Crypto — HMAC token & opaque token

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `test/crypto.test.ts`

**Interfaces:**
- Produces: `packToken(payload: object): string` / `unpackToken<T>(token: string): T | null` (HMAC-SHA256, format `base64url(json).base64url(sig)`, tamper-proof); `generateOpaqueToken(): string` (32 byte random, base64url ≥ 256 bit); `hashToken(token: string): string` (SHA-256 hex); `sha256Hex(input: string): string`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect } from "vitest";
import { packToken, unpackToken, generateOpaqueToken, hashToken, sha256Hex } from "../src/lib/crypto";

describe("packToken/unpackToken", () => {
  it("round-trips payload", () => {
    const t = packToken({ c: "abc", iat: 123 });
    expect(unpackToken<{ c: string; iat: number }>(t)).toEqual({ c: "abc", iat: 123 });
  });
  it("rejects tampered payload", () => {
    const t = packToken({ c: "abc", iat: 123 });
    const [body] = t.split(".");
    expect(unpackToken(`${body}.deadbeef`)).toBeNull();
    expect(unpackToken(`${body}x.${t.split(".")[1]}`)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(unpackToken("nonsense")).toBeNull();
    expect(unpackToken("")).toBeNull();
  });
});

describe("opaque tokens", () => {
  it("generates 43-char base64url token", () => {
    const t = generateOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("hashes deterministically", () => {
    expect(hashToken("abc")).toBe(sha256Hex("abc"));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/crypto.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/crypto.ts`**

```ts
import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(data: string): string {
  return b64url(createHmac("sha256", env("TOKEN_SECRET")).update(data).digest());
}

export function packToken(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(body)}`;
}

export function unpackToken<T>(token: string): T | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = Buffer.from(hmac(body));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/crypto.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts test/crypto.test.ts && git commit -m "feat: hmac token pack/unpack and opaque token utilities"
```

---

### Task 6: Token timer 30 detik (server-side)

**Files:**
- Create: `src/lib/timer.ts`
- Test: `test/timer.test.ts`

**Interfaces:**
- Consumes: `packToken`/`unpackToken` (Task 5).
- Produces: `issueTimerToken(campaignId: string): string`; `verifyTimerToken(token: string, campaignId: string): { ok: true } | { ok: false; reason: "invalid" | "wrong-campaign" | "too-fast" | "expired" }`. Aturan: usia token < 30 detik → `too-fast`; > 2 jam → `expired`; payload `{ c, n, iat }`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { issueTimerToken, verifyTimerToken } from "../src/lib/timer";

describe("verifyTimerToken", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects token younger than 30 seconds", () => {
    const t = issueTimerToken("camp-1");
    vi.advanceTimersByTime(10_000);
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: false, reason: "too-fast" });
  });
  it("accepts token aged 30s..2h for the right campaign", () => {
    const t = issueTimerToken("camp-1");
    vi.advanceTimersByTime(31_000);
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: true });
  });
  it("rejects wrong campaign", () => {
    const t = issueTimerToken("camp-1");
    vi.advanceTimersByTime(31_000);
    expect(verifyTimerToken(t, "camp-2")).toEqual({ ok: false, reason: "wrong-campaign" });
  });
  it("rejects token older than 2 hours", () => {
    const t = issueTimerToken("camp-1");
    vi.advanceTimersByTime(2 * 3600_000 + 1000);
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects garbage", () => {
    expect(verifyTimerToken("garbage", "camp-1")).toEqual({ ok: false, reason: "invalid" });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/timer.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/timer.ts`**

```ts
import { randomBytes } from "node:crypto";
import { packToken, unpackToken } from "./crypto";

const MIN_AGE_MS = 30_000;
const MAX_AGE_MS = 2 * 60 * 60_000;

type TimerPayload = { c: string; n: string; iat: number };

export function issueTimerToken(campaignId: string): string {
  return packToken({ c: campaignId, n: randomBytes(12).toString("base64url"), iat: Date.now() } satisfies TimerPayload);
}

export function verifyTimerToken(token: string, campaignId: string):
  | { ok: true } | { ok: false; reason: "invalid" | "wrong-campaign" | "too-fast" | "expired" } {
  const payload = unpackToken<TimerPayload>(token);
  if (!payload || typeof payload.c !== "string" || typeof payload.iat !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (payload.c !== campaignId) return { ok: false, reason: "wrong-campaign" };
  const age = Date.now() - payload.iat;
  if (age < MIN_AGE_MS) return { ok: false, reason: "too-fast" };
  if (age > MAX_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/timer.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timer.ts test/timer.test.ts && git commit -m "feat: signed 30-second timer token with server validation"
```

---

### Task 7: Rate limit (fixed window di Postgres, IP di-hash)

**Files:**
- Create: `src/lib/ratelimit.ts`
- Test: `test/ratelimit.test.ts`

**Interfaces:**
- Consumes: `db`, `rateLimits` (Task 2), `sha256Hex` (Task 5).
- Produces: `hashIp(ip: string): string` (SHA-256 + salt `IP_HASH_SALT`) dan `consumeRateLimit(scope: string, identity: string, limit: number, windowMs: number = 3600_000): Promise<boolean>` — `true` boleh lanjut, `false` limit terlampaui.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect } from "vitest";
import { consumeRateLimit, hashIp } from "../src/lib/ratelimit";
import { resetDb } from "./helpers";

describe("consumeRateLimit", () => {
  beforeEach(resetDb);
  it("allows up to limit then blocks", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await consumeRateLimit("ip", "1.2.3.4", 3)).toBe(true);
    }
    expect(await consumeRateLimit("ip", "1.2.3.4", 3)).toBe(false);
  });
  it("scopes by identity", async () => {
    expect(await consumeRateLimit("email", "a@b.com", 1)).toBe(true);
    expect(await consumeRateLimit("email", "other@b.com", 1)).toBe(true);
    expect(await consumeRateLimit("email", "a@b.com", 1)).toBe(false);
  });
  it("separates scopes", async () => {
    expect(await consumeRateLimit("email", "a@b.com", 1)).toBe(true);
    expect(await consumeRateLimit("ip", "a@b.com", 1)).toBe(true);
  });
});

describe("hashIp", () => {
  it("is deterministic 64-char hex and not the raw ip", () => {
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4")).not.toContain("1.2.3.4");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/ratelimit.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/ratelimit.ts`**

```ts
import { sql } from "drizzle-orm";
import { db } from "./db";
import { sha256Hex } from "./crypto";
import { env } from "./env";

export function hashIp(ip: string): string {
  return sha256Hex(`${env("IP_HASH_SALT")}:${ip}`);
}

export async function consumeRateLimit(
  scope: string, identity: string, limit: number, windowMs: number = 3_600_000,
): Promise<boolean> {
  const key = `${scope}:${identity}:${Math.floor(Date.now() / windowMs)}`;
  const rows = await db.execute(sql`
    INSERT INTO rate_limit (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET count = rate_limit.count + 1
    RETURNING count
  `);
  const count = Number((rows.rows[0] as { count: number }).count);
  return count <= limit;
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/ratelimit.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ratelimit.ts test/ratelimit.test.ts && git commit -m "feat: fixed-window rate limiting with hashed IP identity"
```

---

### Task 8: Outbox + adapter Emailit + worker idempoten

**Files:**
- Create: `src/lib/outbox.ts`, `src/lib/emailit.ts`, `src/lib/mailworker.ts`, `src/pages/api/cron/outbox.ts`
- Test: `test/outbox.test.ts`

**Interfaces:**
- Consumes: `db`, `emailOutbox` (Task 2), `env` (Task 1).
- Produces:
  - `enqueueTransactionalEmail(msg: { emailType: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<void>` — INSERT ... ON CONFLICT (idempotency_key) DO NOTHING.
  - `sendViaEmailit(msg: { from: string; to: string; subject: string; html: string; text: string }, fetchImpl?: typeof fetch): Promise<string | null>` — POST `https://api.emailit.com/v1/emails`, Bearer `EMAILIT_API_KEY`, header `Idempotency-Key` opsional; return `message id` atau null.
  - `processOutbox(opts?: { fetchImpl?: typeof fetch }): Promise<{ sent: number; failed: number }>` — ambil ≤ 20 pending `scheduled_at <= now()` order `created_at`; `MOCK_EMAILIT=true` → langsung `sent` tanpa API; retry maksimal 5 attempt, backoff `scheduled_at = now() + 2^attempts menit`; setelah 5 attempt → `failed`.
  - Route `GET /api/cron/outbox` dengan header `x-cron-secret` = `CRON_SECRET`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/lib/db";
import { emailOutbox } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { enqueueTransactionalEmail, processOutbox } from "../src/lib/mailworker-for-test";
import { resetDb, setEnv } from "./helpers";

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
}
function failFetch() {
  return vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
}

describe("outbox", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_EMAILIT: "false", EMAILIT_API_KEY: "k" }); });

  it("enqueue is idempotent by key", async () => {
    const msg = { emailType: "confirmation", to: "a@b.com", subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "k1" };
    await enqueueTransactionalEmail(msg);
    await enqueueTransactionalEmail(msg);
    const rows = await db.select().from(emailOutbox);
    expect(rows).toHaveLength(1);
  });

  it("processOutbox sends pending email and marks sent", async () => {
    const f = okFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k2" });
    const r = await processOutbox({ fetchImpl: f as any });
    expect(r).toEqual({ sent: 1, failed: 0 });
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k2"));
    expect(row.status).toBe("sent");
    expect(f.mock.calls[0][0]).toBe("https://api.emailit.com/v1/emails");
  });

  it("failed send retries with backoff, then fails permanently", async () => {
    const f = failFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k3" });
    for (let i = 0; i < 5; i++) {
      const r = await processOutbox({ fetchImpl: f as any });
      expect(r.sent).toBe(0);
      if (i < 4) expect(r.failed).toBe(0); // backoff: belum diambil lagi
    }
    const r5 = await processOutbox({ fetchImpl: f as any });
    expect(r5.failed).toBe(1);
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k3"));
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
  });

  it("MOCK_EMAILIT marks sent without calling provider", async () => {
    setEnv({ MOCK_EMAILIT: "true" });
    const f = okFetch();
    await enqueueTransactionalEmail({ emailType: "confirmation", to: "a@b.com", subject: "s", html: "h", text: "h", idempotencyKey: "k4" });
    const r = await processOutbox({ fetchImpl: f as any });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/outbox.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/outbox.ts`**

```ts
import { db } from "./db";
import { emailOutbox } from "./schema";

export type OutboxMessage = {
  emailType: string; to: string; subject: string; html: string; text: string; idempotencyKey: string;
};

export async function enqueueTransactionalEmail(msg: OutboxMessage): Promise<void> {
  await db.insert(emailOutbox).values({
    emailType: msg.emailType, toEmail: msg.to, subject: msg.subject,
    html: msg.html, text: msg.text, idempotencyKey: msg.idempotencyKey,
  }).onConflictDoNothing();
}
```

- [ ] **Step 4: Tulis `src/lib/emailit.ts`**

```ts
import { env } from "./env";

export type ProviderMessage = { from: string; to: string; subject: string; html: string; text: string; idempotencyKey?: string };

export async function sendViaEmailit(msg: ProviderMessage, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl("https://api.emailit.com/v1/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("EMAILIT_API_KEY")}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Emailit ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}
```

- [ ] **Step 5: Tulis `src/lib/mailworker.ts`**

```ts
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "./db";
import { emailOutbox } from "./schema";
import { env } from "./env";
import { sendViaEmailit } from "./emailit";

const MAX_ATTEMPTS = 5;
const FROM = "KelasWFA <admin@kelaswfa.my.id>";

export async function processOutbox(opts?: { fetchImpl?: typeof fetch }): Promise<{ sent: number; failed: number }> {
  const batch = await db.select().from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.scheduledAt, new Date())))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(20);

  let sent = 0, failed = 0;
  for (const row of batch) {
    if (env("MOCK_EMAILIT", "false") === "true") {
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
      continue;
    }
    try {
      await sendViaEmailit({
        from: FROM, to: row.toEmail, subject: row.subject, html: row.html, text: row.text,
        idempotencyKey: row.idempotencyKey,
      }, opts?.fetchImpl);
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.update(emailOutbox).set({ status: "failed", attempts, lastError: String(err).slice(0, 500) })
          .where(eq(emailOutbox.id, row.id));
        failed++;
      } else {
        const backoffMs = Math.pow(2, attempts) * 60_000;
        await db.update(emailOutbox).set({ attempts, lastError: String(err).slice(0, 500), scheduledAt: new Date(Date.now() + backoffMs) })
          .where(eq(emailOutbox.id, row.id));
      }
    }
  }
  return { sent, failed };
}
```

- [ ] **Step 6: Tulis `src/pages/api/cron/outbox.ts` dan helper test**

`src/pages/api/cron/outbox.ts`:

```ts
import type { APIRoute } from "astro";
import { env } from "../../lib/env";
import { processOutbox } from "../../lib/mailworker";

export const GET: APIRoute = async ({ request }) => {
  if (request.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await processOutbox();
  return new Response(JSON.stringify(result), { status: 200 });
};
```

Untuk test: buat `src/lib/mailworker-for-test.ts` yang re-export `enqueueTransactionalEmail` (dari `./outbox`) dan `processOutbox` (dari `./mailworker`) — test meng-import dari sini agar satu import saja. Tambahkan `setEnv` di `test/helpers.ts`:

```ts
export function setEnv(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}
```

- [ ] **Step 7: Jalankan test**

Run: `npm test -- test/outbox.test.ts` → Expected: PASS. (Backoff test bergantung pada `scheduledAt` di masa depan — worker hanya mengambil `scheduled_at <= now()`, jadi attempt 1–4 tidak memproses ulang; attempt ke-5 hanya terjadi setelah backoff terlewati. Untuk membuat test deterministik, sebelum tiap iterasi `processOutbox` update baris: `await db.update(emailOutbox).set({ scheduledAt: new Date() }).where(eq(emailOutbox.idempotencyKey, "k3"));` — masukkan ke loop test.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/outbox.ts src/lib/emailit.ts src/lib/mailworker.ts src/lib/mailworker-for-test.ts src/pages/api/cron/outbox.ts test/outbox.test.ts test/helpers.ts && git commit -m "feat: transactional email outbox with emailit adapter and idempotent worker"
```

---

### Task 9: Template email transaksional ID/EN + masked email

**Files:**
- Create: `src/lib/templates.ts`
- Test: `test/templates.test.ts`

**Interfaces:**
- Consumes: struktur lokal (tanpa DB).
- Produces:
  - `maskedEmail(email: string): string` → `budi@gmail.com` jadi `bu**@gmail.com` (2 karakter pertama local part + `**`).
  - `confirmationEmail(locale: "id" | "en", confirmUrl: string): { subject: string; html: string; text: string }`.
  - `rewardAccessEmail(locale: "id" | "en", accessUrl: string, rewardTitle: string): { subject: string; html: string; text: string }`.
  - Keduanya memakai From `KelasWFA <admin@kelaswfa.my.id>` (konstanta `EMAIL_FROM`) dan menyebut reply-to `admin@kelaswfa.my.id`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect } from "vitest";
import { maskedEmail, confirmationEmail, rewardAccessEmail, EMAIL_FROM } from "../src/lib/templates";

describe("maskedEmail", () => {
  it("masks local part", () => {
    expect(maskedEmail("budi@gmail.com")).toBe("bu**@gmail.com");
    expect(maskedEmail("a@gmail.com")).toBe("a**@gmail.com");
  });
});

describe("confirmationEmail", () => {
  it("id content mentions confirmation and link", () => {
    const m = confirmationEmail("id", "https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.subject).toContain("Konfirmasi");
    expect(m.html).toContain("https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.html).toContain("lang=\"id\"");
  });
  it("en content falls back structure", () => {
    const m = confirmationEmail("en", "https://x/konfirmasi/t");
    expect(m.html).toContain("lang=\"en\"");
    expect(m.subject).not.toContain("Konfirmasi");
  });
});

describe("rewardAccessEmail", () => {
  it("includes reward title and access link", () => {
    const m = rewardAccessEmail("id", "https://x/akses/t", "Starter Checklist");
    expect(m.html).toContain("Starter Checklist");
    expect(m.html).toContain("https://x/akses/t");
  });
  it("sets from header constant", () => {
    expect(EMAIL_FROM).toBe("KelasWFA <admin@kelaswfa.my.id>");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/templates.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/templates.ts`**

```ts
export const EMAIL_FROM = "KelasWFA <admin@kelaswfa.my.id>";
export const EMAIL_REPLY_TO = "admin@kelaswfa.my.id";

export function maskedEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}**@${domain}`;
}

function layout(lang: "id" | "en", title: string, bodyHtml: string, linkLabel: string, url: string): string {
  const replyNote = lang === "id"
    ? "Balas email ini jika butuh bantuan."
    : "Reply to this email if you need help.";
  return `<!doctype html><html lang="${lang}"><body style="font-family:Arial,Helvetica,sans-serif;color:#36514B;background:#FFFCF5;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E7DED0;border-radius:20px;padding:32px;">
<h1 style="color:#153B35;font-size:22px;margin:0 0 16px;">${title}</h1>
<div style="font-size:16px;line-height:1.6;">${bodyHtml}</div>
<p style="margin:24px 0;"><a href="${url}" style="background:#176B5B;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;display:inline-block;">${linkLabel}</a></p>
<p style="color:#6C7E79;font-size:13px;">${replyNote} (${EMAIL_REPLY_TO})</p>
</div></body></html>`;
}

export function confirmationEmail(locale: "id" | "en", confirmUrl: string) {
  if (locale === "en") {
    return {
      subject: "Confirm your email to open your KelasWFA gift",
      html: layout("en", "Confirm your email",
        "<p>Tap the button below to confirm your email and unlock your reward.</p><p>Your link is valid for 7 days.</p>",
        "Confirm my email", confirmUrl),
      text: "Confirm your email to open your KelasWFA gift: " + confirmUrl + " (valid 7 days)",
    };
  }
  return {
    subject: "Konfirmasi email untuk membuka hadiah KelasWFA",
    html: layout("id", "Satu langkah lagi",
      "<p>Klik tombol di bawah untuk mengonfirmasi emailmu dan membuka hadiah dari KelasWFA.</p><p>Tautan berlaku 7 hari.</p>",
      "Konfirmasi emailku", confirmUrl),
    text: "Konfirmasi email untuk membuka hadiah KelasWFA: " + confirmUrl + " (berlaku 7 hari)",
  };
}

export function rewardAccessEmail(locale: "id" | "en", accessUrl: string, rewardTitle: string) {
  if (locale === "en") {
    return {
      subject: `Your KelasWFA gift: ${rewardTitle}`,
      html: layout("en", "Your gift is ready",
        `<p>Your reward <strong>${rewardTitle}</strong> is ready to download.</p><p>This access link is valid for 7 days. The download link itself is valid for 1 hour.</p>`,
        "Open my gift", accessUrl),
      text: `Your KelasWFA gift "${rewardTitle}" is ready: ${accessUrl} (valid 7 days)`,
    };
  }
  return {
    subject: `Hadiah KelasWFA-mu: ${rewardTitle}`,
    html: layout("id", "Kadonya siap dibuka",
      `<p>Hadiah <strong>${rewardTitle}</strong> sudah siap diunduh.</p><p>Tautan akses berlaku 7 hari. Link unduhan berlaku 1 jam.</p>`,
      "Buka hadiahku", accessUrl),
    text: `Hadiah KelasWFA "${rewardTitle}" sudah siap: ${accessUrl} (berlaku 7 hari)`,
  };
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/templates.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates.ts test/templates.test.ts && git commit -m "feat: bilingual transactional email templates with masked email helper"
```

---

### Task 10: Access & confirm token lifecycle

**Files:**
- Create: `src/lib/access.ts`
- Test: `test/access.test.ts`

**Interfaces:**
- Consumes: `db` + tabel `contacts`, `rewardClaims`, `accessTokens`, `marketingSubscriptions`, `consentEvents` (Task 2), `generateOpaqueToken`, `hashToken` (Task 5).
- Produces:
  - `upsertClaim(contactId: string, campaignId: string): Promise<string>` → claim id (unique `(contact_id, campaign_id)`; kalau ada, kembalikan yang lama).
  - `issueClaimToken(claimId: string, type: "confirm" | "access"): Promise<string>` → token opaque mentah (7 hari, hash tersimpan).
  - `issueSessionToken(claimId: string): Promise<string>` → token sesi (1 jam, boleh dipakai berulang).
  - `consumeToken(rawToken: string, type: "confirm" | "access" | "session"): Promise<{ ok: true; claimId: string } | { ok: false }>` — verifikasi hash, kedaluwarsa; untuk `confirm`/`access` juga set `used_at` (sekali pakai, atomik: `UPDATE ... SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING`).
  - `confirmContactByToken(rawToken: string): Promise<{ ok: true; claimId: string } | { ok: false }>` — consume token `confirm`, set `contacts.confirmation_status = 'confirmed'` + `confirmed_at`, upsert `marketing_subscriptions` jadi `active` + `subscribed_at`, insert `consent_events` (`subscribed`), return claimId. Idempoten bila contact sudah confirmed (tetap ok, tanpa consent event ganda).

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/lib/db";
import { contacts, rewardCampaigns, rewardClaims, accessTokens } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import {
  upsertClaim, issueClaimToken, issueSessionToken, consumeToken, confirmContactByToken,
} from "../src/lib/access";
import { resetDb } from "./helpers";

async function seedContact() {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "test-camp" }).returning();
  return { contact: c, campaign: camp };
}

describe("access tokens", () => {
  beforeEach(resetDb);

  it("upsertClaim returns same claim on repeat", async () => {
    const { contact, campaign } = await seedContact();
    const id1 = await upsertClaim(contact.id, campaign.id);
    const id2 = await upsertClaim(contact.id, campaign.id);
    expect(id1).toBe(id2);
  });

  it("confirm token: one-time, 7 days, confirms contact and activates subscription", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "confirm");
    const first = await confirmContactByToken(raw);
    expect(first).toMatchObject({ ok: true, claimId });
    expect(await confirmContactByToken(raw)).toEqual({ ok: false }); // dipakai dua kali
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c.confirmationStatus).toBe("confirmed");
    const claims = await db.select().from(rewardClaims).where(eq(rewardClaims.id, claimId));
    expect(claims[0].status).toBe("accessed");
  });

  it("expired token is rejected", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "access");
    await db.update(accessTokens).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.claimId, claimId));
    expect(await consumeToken(raw, "access")).toEqual({ ok: false });
  });

  it("session token is reusable within 1 hour", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueSessionToken(claimId);
    expect(await consumeToken(raw, "session")).toMatchObject({ ok: true, claimId });
    expect(await consumeToken(raw, "session")).toMatchObject({ ok: true, claimId });
  });

  it("wrong type is rejected", async () => {
    const { contact, campaign } = await seedContact();
    const claimId = await upsertClaim(contact.id, campaign.id);
    const raw = await issueClaimToken(claimId, "confirm");
    expect(await consumeToken(raw, "access")).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/access.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/access.ts`**

```ts
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { accessTokens, consentEvents, contacts, marketingSubscriptions, rewardClaims } from "./schema";
import { generateOpaqueToken, hashToken } from "./crypto";

const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
const ONE_HOUR_MS = 3_600_000;

export async function upsertClaim(contactId: string, campaignId: string): Promise<string> {
  const inserted = await db.insert(rewardClaims)
    .values({ contactId, campaignId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0].id;
  const [existing] = await db.select().from(rewardClaims)
    .where(and(eq(rewardClaims.contactId, contactId), eq(rewardClaims.campaignId, campaignId)));
  return existing.id;
}

async function insertToken(claimId: string, type: "confirm" | "access" | "session", ttlMs: number): Promise<string> {
  const raw = generateOpaqueToken();
  await db.insert(accessTokens).values({
    claimId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

export function issueClaimToken(claimId: string, type: "confirm" | "access"): Promise<string> {
  return insertToken(claimId, type, SEVEN_DAYS_MS);
}

export function issueSessionToken(claimId: string): Promise<string> {
  return insertToken(claimId, "session", ONE_HOUR_MS);
}

export async function consumeToken(rawToken: string, type: "confirm" | "access" | "session"):
  Promise<{ ok: true; claimId: string } | { ok: false }> {
  const tokenHash = hashToken(rawToken);
  if (type === "session") {
    const [row] = await db.select().from(accessTokens)
      .where(and(eq(accessTokens.tokenHash, tokenHash), eq(accessTokens.type, type), gt(accessTokens.expiresAt, new Date())));
    return row ? { ok: true, claimId: row.claimId } : { ok: false };
  }
  const rows = await db.update(accessTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(accessTokens.tokenHash, tokenHash), eq(accessTokens.type, type),
      isNull(accessTokens.usedAt), gt(accessTokens.expiresAt, new Date()),
    ))
    .returning();
  return rows.length > 0 ? { ok: true, claimId: rows[0].claimId } : { ok: false };
}

export async function confirmContactByToken(rawToken: string): Promise<{ ok: true; claimId: string } | { ok: false }> {
  const result = await consumeToken(rawToken, "confirm");
  if (!result.ok) return { ok: false };
  const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, result.claimId));
  await db.update(contacts)
    .set({ confirmationStatus: "confirmed", confirmedAt: sql`coalesce(${contacts.confirmedAt}, now())` })
    .where(eq(contacts.id, claim.contactId));
  await db.update(rewardClaims).set({ status: "accessed" }).where(eq(rewardClaims.id, result.claimId));
  const [sub] = await db.select().from(marketingSubscriptions).where(eq(marketingSubscriptions.contactId, claim.contactId));
  if (!sub || sub.status !== "active") {
    await db.insert(marketingSubscriptions)
      .values({ contactId: claim.contactId, status: "active", subscribedAt: new Date(), source: "reward_claim" })
      .onConflictDoUpdate({
        target: marketingSubscriptions.contactId,
        set: { status: "active", subscribedAt: new Date(), unsubscribedAt: null },
      });
    await db.insert(consentEvents).values({ contactId: claim.contactId, event: "subscribed" });
  }
  return { ok: true, claimId: result.claimId };
}
```

- [ ] **Step 4: Jalankan test**

Run: `npm test -- test/access.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/access.ts test/access.test.ts && git commit -m "feat: claim upsert and confirm/access/session token lifecycle"
```

---

### Task 11: Signed download URL R2 (1 jam)

**Files:**
- Create: `src/lib/storage.ts`
- Test: `test/storage.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1).
- Produces: `presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string>` — presigned GET URL untuk `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${storageKey}` dengan `X-Amz-Expires=3600`; dan `assertAssetDownloadable(asset: { mimeType: string; sizeBytes: number }): void` yang melempar `Error` bila MIME tidak ada dalam daftar Global Constraints atau `sizeBytes > 100 * 1024 * 1024`.

- [ ] **Step 1: Install dependensi**

```bash
npm i aws4fetch
```

- [ ] **Step 2: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { presignDownloadUrl, assertAssetDownloadable } from "../src/lib/storage";
import { setEnv } from "./helpers";

describe("presignDownloadUrl", () => {
  beforeEach(() => setEnv({
    R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "sec", R2_BUCKET: "bucket",
  }));
  it("produces signed url with 1h expiry", async () => {
    const url = await presignDownloadUrl("rewards/2026/file.pdf");
    const u = new URL(url);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("acct.r2.cloudflarestorage.com");
    expect(u.pathname).toContain("/bucket/rewards/2026/file.pdf");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
  it("rejects traversal keys", async () => {
    await expect(presignDownloadUrl("../secret")).rejects.toThrow();
  });
});

describe("assertAssetDownloadable", () => {
  it("allows allowed mime within 100MB", () => {
    expect(() => assertAssetDownloadable({ mimeType: "application/pdf", sizeBytes: 50_000_000 })).not.toThrow();
  });
  it("rejects disallowed mime and oversize", () => {
    expect(() => assertAssetDownloadable({ mimeType: "application/x-msdownload", sizeBytes: 1 })).toThrow();
    expect(() => assertAssetDownloadable({ mimeType: "application/pdf", sizeBytes: 101 * 1024 * 1024 })).toThrow();
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `npm test -- test/storage.test.ts` → Expected: FAIL.

- [ ] **Step 4: Tulis `src/lib/storage.ts`**

```ts
import { Signer } from "aws4fetch";
import { env } from "./env";

export const ALLOWED_MIME = [
  "application/pdf", "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png", "image/jpeg", "image/webp",
];
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function assertAssetDownloadable(asset: { mimeType: string; sizeBytes: number }): void {
  if (!ALLOWED_MIME.includes(asset.mimeType)) throw new Error(`MIME not allowed: ${asset.mimeType}`);
  if (asset.sizeBytes > MAX_UPLOAD_BYTES) throw new Error("File exceeds 100 MB limit");
}

export async function presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  if (storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key");
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const url = new URL(`https://${host}/${env("R2_BUCKET")}/${storageKey}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSec));
  const signer = new Signer({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  });
  const signed = await signer.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}
```

- [ ] **Step 5: Jalankan test**

Run: `npm test -- test/storage.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage.ts test/storage.test.ts && git commit -m "feat: r2 presigned download urls with mime and size guards"
```

---

### Task 12: Endpoint subscribe (semua validasi server, respons generik)

**Files:**
- Create: `src/lib/subscribe.ts`, `src/pages/api/timer-token.ts`, `src/pages/api/subscribe.ts`
- Test: `test/subscribe.test.ts`

**Interfaces:**
- Consumes: `issueTimerToken`/`verifyTimerToken` (Task 6), `consumeRateLimit`/`hashIp` (Task 7), `normalizeEmail`/`emailDomain` (Task 3), `isDomainAllowed` (Task 4), `upsertClaim`/`issueClaimToken` (Task 10), `enqueueTransactionalEmail` (Task 8), `confirmationEmail`/`rewardAccessEmail`/`maskedEmail` (Task 9), `db` (Task 2).
- Produces:
  - Route `POST /api/timer-token` body JSON `{ slug: string }` → `{ token: string }` (200) atau 404 untuk campaign yang tidak published.
  - `processSubscribe(input: { email: string; timerToken: string; honeypot?: string; ip: string; campaignId: string; siteUrl: string; locale: "id" | "en" }): Promise<{ ok: true; alreadyConfirmed: boolean } | { ok: false; reason: "bad-request" | "too-fast" | "rate-limited" | "domain-not-allowed" | "campaign-unavailable" }>`
    - honeypot terisi → `{ ok: true, alreadyConfirmed: false }` TANPA memproses apa pun (jebakan bot, respons generik).
    - Limit: IP 10/jam, email 5/jam (env `RATE_LIMIT_IP_PER_HOUR`, `RATE_LIMIT_EMAIL_PER_HOUR`).
    - Kontak baru/pending → token `confirm` + email konfirmasi. Kontak confirmed → token `access` + email akses reward, TANPA double opt-in ulang.
    - Subjek email akses memakai judul campaign locale (fallback ID).
  - Route `POST /api/subscribe` (form-encoded) memanggil `processSubscribe`; responsnya SELALU 302 redirect ke `/cek-email` (id) atau `/en/cek-email` (en) terlepas dari hasil — untuk `ok: false` ditambah `?e=<reason>` untuk pesan error UI; tidak pernah membocorkan keberadaan email.
  - Fallback tanpa JavaScript (PRD 7.1): server merender token timer langsung ke hidden input saat halaman dimuat (`issueTimerToken` dipanggil di frontmatter page). Endpoint `/api/timer-token` hanya memperbarui token via JS; tanpa JS, token server-rendered tetap divalidasi server setelah 30 detik.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/lib/db";
import { contacts, rewardCampaigns, emailOutbox, emailDomains } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { processSubscribe } from "../src/lib/subscribe";
import { issueTimerToken } from "../src/lib/timer";
import { resetDb, setEnv } from "./helpers";

async function seedPublishedCampaign() {
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "starter", status: "published" }).returning();
  return camp;
}
const input = (over: Partial<Parameters<typeof processSubscribe>[0]> = {}) => ({
  email: "budi@gmail.com", timerToken: "", honeypot: "", ip: "1.2.3.4",
  campaignId: "camp", siteUrl: "http://localhost:4321", locale: "id" as const, ...over,
});

describe("processSubscribe", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_EMAILIT: "true" });
    await db.insert(emailDomains).values({ domain: "gmail.com" });
    await seedPublishedCampaign();
  });

  it("rejects timer token younger than 30s", async () => {
    const camp = await seedPublishedCampaign();
    const r = await processSubscribe(input({ timerToken: issueTimerToken(camp.id), campaignId: camp.id }));
    expect(r).toEqual({ ok: false, reason: "too-fast" });
  });

  it("rejects honeypot silently but generically", async () => {
    const camp = await seedPublishedCampaign();
    const r = await processSubscribe(input({ honeypot: "http://spam", timerToken: issueTimerToken(camp.id), campaignId: camp.id }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: false });
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("rejects domain outside allowlist", async () => {
    const camp = await seedPublishedCampaign();
    const r = await processSubscribe(input({ email: "x@evil.example", timerToken: issueTimerToken(camp.id), campaignId: camp.id }));
    expect(r).toEqual({ ok: false, reason: "domain-not-allowed" });
  });

  it("rate-limits per ip after 10 submits", async () => {
    const camp = await seedPublishedCampaign();
    const token = issueTimerToken(camp.id);
    for (let i = 0; i < 10; i++) {
      await processSubscribe(input({ email: `u${i}@gmail.com`, timerToken: token, campaignId: camp.id }));
    }
    const r = await processSubscribe(input({ email: "u99@gmail.com", timerToken: token, campaignId: camp.id }));
    expect(r).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("new contact: creates contact pending + claim + confirmation email", async () => {
    const camp = await seedPublishedCampaign();
    const token = issueTimerToken(camp.id);
    await new Promise((r) => setTimeout(r, 31_000)); // — JANGAN: gunakan vi.useFakeTimers, lihat catatan
    const r = await processSubscribe(input({ timerToken: token, campaignId: camp.id }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: false });
    const [c] = await db.select().from(contacts).where(eq(contacts.emailNormalized, "budi@gmail.com"));
    expect(c.confirmationStatus).toBe("pending");
    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0].emailType).toBe("confirmation");
  });

  it("confirmed contact: access email without re-opt-in, no duplicate claim", async () => {
    const camp = await seedPublishedCampaign();
    const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    const token = issueTimerToken(camp.id);
    await new Promise((r) => setTimeout(r, 31_000));
    const r = await processSubscribe(input({ timerToken: token, campaignId: camp.id }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: true });
    const mails = await db.select().from(emailOutbox);
    expect(mails[0].emailType).toBe("reward_access");
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("email rate limit: 5 per hour for same email", async () => {
    const camp = await seedPublishedCampaign();
    const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    for (let i = 0; i < 5; i++) {
      const token = issueTimerToken(camp.id);
      await new Promise((r) => setTimeout(r, 31_000));
      await processSubscribe(input({ timerToken: token, campaignId: camp.id }));
    }
    const token = issueTimerToken(camp.id);
    await new Promise((r) => setTimeout(r, 31_000));
    const r = await processSubscribe(input({ timerToken: token, campaignId: camp.id }));
    expect(r).toEqual({ ok: false, reason: "rate-limited" });
  });
});
```

Catatan implementasi test: `await new Promise(r => setTimeout(r, 31_000))` membuat test lambat. Gunakan `vi.useFakeTimers()` + `vi.setSystemTime()` untuk memajukan waktu antara `issueTimerToken` dan `processSubscribe` (pola dari Task 6), atau refaktor: `issueTimerToken(camp.id, Date.now() - 31_000)` dengan parameter `iat` opsional untuk test. **Pilih refaktor kedua**: `issueTimerToken(campaignId: string, issuedAt = Date.now())` — update test Task 6 sesuai.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test -- test/subscribe.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/subscribe.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "./db";
import { contacts, rewardCampaignLocales, rewardClaims } from "./schema";
import { verifyTimerToken } from "./timer";
import { consumeRateLimit, hashIp } from "./ratelimit";
import { normalizeEmail, emailDomain } from "./email";
import { isDomainAllowed } from "./allowlist";
import { upsertClaim, issueClaimToken } from "./access";
import { enqueueTransactionalEmail } from "./outbox";
import { confirmationEmail, rewardAccessEmail, maskedEmail } from "./templates";
import { env } from "./env";

export type SubscribeInput = {
  email: string; timerToken: string; honeypot?: string; ip: string;
  campaignId: string; siteUrl: string; locale: "id" | "en";
};
export type SubscribeResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; reason: "bad-request" | "too-fast" | "rate-limited" | "domain-not-allowed" | "campaign-unavailable" };

export async function processSubscribe(input: SubscribeInput): Promise<SubscribeResult> {
  if (input.honeypot) return { ok: true, alreadyConfirmed: false };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "bad-request" };
  const timer = verifyTimerToken(input.timerToken, input.campaignId);
  if (!timer.ok) return { ok: false, reason: timer.reason === "too-fast" ? "too-fast" : "bad-request" };

  const ipLimit = Number(env("RATE_LIMIT_IP_PER_HOUR", "10"));
  const emailLimit = Number(env("RATE_LIMIT_EMAIL_PER_HOUR", "5"));
  if (!(await consumeRateLimit("ip", hashIp(input.ip), ipLimit))) return { ok: false, reason: "rate-limited" };
  if (!(await consumeRateLimit("email", email, emailLimit))) return { ok: false, reason: "rate-limited" };
  if (!(await isDomainAllowed(emailDomain(email)))) return { ok: false, reason: "domain-not-allowed" };

  const locales = await db.select().from(rewardCampaignLocales).where(eq(rewardCampaignLocales.campaignId, input.campaignId));
  const loc = locales.find((l) => l.locale === input.locale) ?? locales.find((l) => l.locale === "id");
  if (!loc) return { ok: false, reason: "campaign-unavailable" };

  let [contact] = await db.select().from(contacts).where(eq(contacts.emailNormalized, email));
  if (!contact) {
    [contact] = await db.insert(contacts).values({ emailNormalized: email, locale: input.locale }).returning();
  }
  const claimId = await upsertClaim(contact.id, input.campaignId);

  if (contact.confirmationStatus === "confirmed") {
    const raw = await issueClaimToken(claimId, "access");
    const url = `${input.siteUrl}/${input.locale === "en" ? "en/" : ""}akses/${raw}`;
    const m = rewardAccessEmail(input.locale, url, loc.title);
    await enqueueTransactionalEmail({ emailType: "reward_access", to: email, ...m, idempotencyKey: `access-${claimId}-${raw.slice(0, 12)}` });
    await db.update(rewardClaims).set({ lastAccessSentAt: new Date(), status: "access_sent" }).where(eq(rewardClaims.id, claimId));
    return { ok: true, alreadyConfirmed: true };
  }

  const raw = await issueClaimToken(claimId, "confirm");
  const url = `${input.siteUrl}/${input.locale === "en" ? "en/" : ""}konfirmasi/${raw}`;
  const m = confirmationEmail(input.locale, url);
  await enqueueTransactionalEmail({ emailType: "confirmation", to: email, ...m, idempotencyKey: `confirm-${claimId}-${raw.slice(0, 12)}` });
  await db.update(rewardClaims).set({ lastAccessSentAt: new Date() }).where(eq(rewardClaims.id, claimId));
  void import("./mailworker").then((w) => w.processOutbox()).catch(() => {}); // drain cepat, best-effort
  return { ok: true, alreadyConfirmed: false };
}

export { maskedEmail };
```

- [ ] **Step 4: Tulis routes `src/pages/api/timer-token.ts` dan `src/pages/api/subscribe.ts`**

`src/pages/api/timer-token.ts`:

```ts
import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { eq } from "drizzle-orm";
import { issueTimerToken } from "../../lib/timer";

export const POST: APIRoute = async ({ request }) => {
  const { slug } = (await request.json()) as { slug?: string };
  if (!slug) return new Response("bad request", { status: 400 });
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp || camp.status !== "published") return new Response("not found", { status: 404 });
  return new Response(JSON.stringify({ token: issueTimerToken(camp.id) }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
```

`src/pages/api/subscribe.ts`:

```ts
import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { eq } from "drizzle-orm";
import { processSubscribe } from "../../lib/subscribe";

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const slug = String(form.get("slug") ?? "");
  const locale = String(form.get("locale") ?? "id") === "en" ? "en" : "id";
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp) return new Response("not found", { status: 404 });
  await processSubscribe({
    email: String(form.get("email") ?? ""),
    timerToken: String(form.get("timer_token") ?? ""),
    honeypot: String(form.get("website") ?? ""),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0",
    campaignId: camp.id,
    siteUrl: process.env.PUBLIC_SITE_URL ?? new URL(request.url).origin,
    locale,
  });
  // Respons SELALU generik.
  return Response.redirect(
    `${process.env.PUBLIC_SITE_URL ?? new URL(request.url).origin}/${locale === "en" ? "en/cek-email" : "cek-email"}`,
    303,
  );
};
```

- [ ] **Step 5: Jalankan test**

Run: `npm test -- test/subscribe.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/subscribe.ts src/pages/api/timer-token.ts src/pages/api/subscribe.ts test/subscribe.test.ts && git commit -m "feat: subscribe endpoint with server-validated timer, honeypot, rate limits, generic response"
```

---

### Task 13: Landing page reward (UI sesuai DESIGN.md) + tab doa + form timer

**Files:**
- Create: `src/lib/i18n.ts`, `src/lib/campaign.ts`, `src/components/RewardHero.astro`, `src/components/RewardItemList.astro`, `src/components/ReflectionTabs.astro`, `src/components/EmailForm.astro`, `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro`
- Test: `test/campaign.test.ts` (logika loading + fallback) + smoke Playwright di Task 15

**Interfaces:**
- Consumes: schema (Task 2), `doaTemplates`/`doaSelections`.
- Produces:
  - `getPublishedCampaign(slug: string): Promise<{ campaign, localeRow, doa: { muslim: string; universal: string } } | null>` — hanya `status='published'`; fallback konten EN → ID dilakukan di `campaign.ts`; jika EN kosong pada locale row `en`, return locale row `id` dengan flag `fallbackToId: true`.
  - Komponen UI: `RewardHero.astro` (props `{ title, description, overline, imageKey? }`), `RewardItemList.astro` (props `{ items }`), `ReflectionTabs.astro` (props `{ muslimText, universalText, locale }`), `EmailForm.astro` (props `{ slug, locale }`).
  - `t(locale, key)` dari `src/lib/i18n.ts` dengan dict lengkap id/en untuk semua copy di bawah.

- [ ] **Step 1: Tulis `src/lib/i18n.ts`**

```ts
export type Locale = "id" | "en";
const dict = {
  overline: { id: "KADO DARI KELASWFA", en: "A GIFT FROM KELASWFA" },
  reflectionHeading: { id: "Luangkan sejenak untuk doa atau harapan baik.", en: "Take a moment for a prayer or kind wish." },
  tabMuslim: { id: "Doa Muslim", en: "Muslim Prayer" },
  tabUniversal: { id: "Harapan Baik", en: "Kind Wish" },
  timerInitial: { id: "Tombol akan terbuka setelah 30 detik.", en: "The button unlocks in 30 seconds." },
  timerDone: { id: "Terima kasih sudah meluangkan waktu. Sekarang, masukkan emailmu.", en: "Thanks for taking a moment. Now, enter your email." },
  timerTenLeft: { id: "10 detik lagi.", en: "10 seconds left." },
  emailLabel: { id: "Email untuk menerima hadiah", en: "Email to receive your gift" },
  consentCopy: {
    id: "Dengan mengklaim hadiah, kamu juga mendaftar ke newsletter KelasWFA. Lihat",
    en: "By claiming this gift you also subscribe to the KelasWFA newsletter. See the",
  },
  privacyLink: { id: "kebijakan privasi", en: "privacy policy" },
  submitCta: { id: "Kirim tautan hadiah", en: "Send my gift link" },
  errorDomain: { id: "Domain email ini belum didukung. Coba email lain ya.", en: "This email domain is not supported yet. Try another email." },
  errorRate: { id: "Terlalu banyak percobaan. Coba lagi beberapa saat.", en: "Too many attempts. Please try again shortly." },
  errorGeneric: { id: "Terjadi kesalahan. Coba lagi ya.", en: "Something went wrong. Please try again." },
  checkEmailTitle: { id: "Cek emailmu", en: "Check your email" },
  checkEmailBody: {
    id: "Kami mengirim tautan ke {email}. Buka email dari KelasWFA, lalu klik tautannya.",
    en: "We sent a link to {email}. Open the KelasWFA email and click the link.",
  },
} as const;
export type I18nKey = keyof typeof dict;
export function t(locale: Locale, key: I18nKey): string {
  return dict[key][locale];
}
```

- [ ] **Step 2: Tulis `src/lib/campaign.ts` + test fallback**

`src/lib/campaign.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { doaSelections, doaTemplates, rewardCampaignLocales, rewardCampaigns } from "./schema";
import type { Locale } from "./i18n";

export async function getPublishedCampaign(slug: string) {
  const [campaign] = await db.select().from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.slug, slug), eq(rewardCampaigns.status, "published")));
  if (!campaign) return null;
  const rows = await db.select().from(rewardCampaignLocales)
    .where(eq(rewardCampaignLocales.campaignId, campaign.id));
  const picks = await db.select().from(doaSelections).where(eq(doaSelections.campaignId, campaign.id));
  async function templateText(variant: "muslim" | "universal", locale: Locale): Promise<string> {
    const sel = picks.find((p) => p.variant === variant);
    if (!sel) return "";
    const [tpl] = await db.select().from(doaTemplates).where(eq(doaTemplates.id, sel.templateId));
    if (!tpl) return "";
    if (tpl.locale === locale) return tpl.content;
    const [alt] = await db.select().from(doaTemplates)
      .where(and(eq(doaTemplates.variant, variant), eq(doaTemplates.locale, locale), eq(doaTemplates.name, tpl.name)));
    return alt?.content ?? tpl.content;
  }
  return {
    campaign,
    localeRow: (locale: Locale) => {
      const want = rows.find((r) => r.locale === locale);
      if (want) return { row: want, fallbackToId: false };
      const base = rows.find((r) => r.locale === "id")!;
      return { row: base, fallbackToId: locale === "en" };
    },
    doaText: templateText,
  };
}
```

`test/campaign.test.ts` — test inti: campaign published return data; draft → null; locale `en` kosong → memakai row `id` dengan `fallbackToId: true`. Tulis test mengikuti pola `resetDb` + insert (seperti Task 10).

- [ ] **Step 3: Tulis komponen UI**

`src/components/RewardHero.astro`:

```astro
---
interface Props { overline: string; title: string; description: string; imageKey?: string | null; }
const { overline, title, description, imageKey = null } = Astro.props;
---
<header style="padding-top: var(--space-12);">
  <p class="overline" style="color: var(--color-text-muted); font-size: 12px; letter-spacing: 0.075em; font-weight: 600; text-transform: uppercase;">{overline}</p>
  <h1 style="color: var(--color-ink); font-size: var(--text-h1); line-height: 1.12; letter-spacing: -0.032em;">{title}</h1>
  <p style="font-size: var(--text-body-lg); line-height: 1.58;">{description}</p>
  {imageKey && <img src={`/api/image/${imageKey}`} alt={title} width="1200" height="630"
    style="border-radius: var(--radius-image); width: 100%; height: auto; margin-top: var(--space-5);" loading="eager" />}
</header>
```

(Catatan: `/api/image/*` dilayani endpoint signed-redirect yang sama seperti Task 14 — featured image juga privat. Implementasikan `src/pages/api/image/[...key].ts` yang hanya mengizinkan key yang terdaftar sebagai `featured_image_key` campaign published, lalu 302 ke presigned URL.)

`src/components/RewardItemList.astro`:

```astro
---
interface Item { name: string; benefit: string; format?: string; size?: string; }
interface Props { items: Item[]; locale: "id" | "en"; }
const { items, locale } = Astro.props;
const labels = { format: locale === "en" ? "Format" : "Format", size: locale === "en" ? "Size" : "Ukuran" };
---
<ul style="list-style: none; padding: 0; display: grid; gap: var(--space-3);">
  {items.map((item) => (
    <li style="background: var(--color-surface-raised); border: var(--border-default); border-radius: var(--radius-card); padding: var(--space-6); box-shadow: var(--shadow-card); display: flex; gap: var(--space-4); align-items: flex-start;">
      <span aria-hidden="true" style="flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--color-gold-subtle); color: var(--color-gold); display: grid; place-items-center;">🎁</span>
      <div>
        <strong style="color: var(--color-ink);">{item.name}</strong>
        <p style="margin: 4px 0 0;">{item.benefit}</p>
        {(item.format || item.size) && (
          <p style="margin: 4px 0 0; color: var(--color-text-muted); font-size: var(--text-body-sm);">
            {item.format ? `${labels.format}: ${item.format}` : ""}{item.format && item.size ? " · " : ""}{item.size ? `${labels.size}: ${item.size}` : ""}
          </p>
        )}
      </div>
    </li>
  ))}
</ul>
```

(Per DESIGN.md "Jangan memakai emoji sebagai ikon UI": ganti karakter 🎁 dengan inline SVG outline icon `gift` stroke 1.75px saat implementasi — sertakan SVG path lucide `gift` langsung di komponen.)

`src/components/ReflectionTabs.astro` (tab ARIA + tanpa framework):

```astro
---
interface Props { muslimText: string; universalText: string; locale: "id" | "en"; }
const { muslimText, universalText, locale } = Astro.props;
const t = {
  heading: locale === "en" ? "Take a moment for a prayer or kind wish." : "Luangkan sejenak untuk doa atau harapan baik.",
  tab1: locale === "en" ? "Muslim Prayer" : "Doa Muslim",
  tab2: locale === "en" ? "Kind Wish" : "Harapan Baik",
};
---
<section style="background: var(--color-surface-raised); border: var(--border-default); border-radius: var(--radius-card); padding: var(--space-6); margin-top: var(--space-8);">
  <h2 style="color: var(--color-ink); font-size: var(--text-h3);">{t.heading}</h2>
  <div role="tablist" aria-label={t.heading} style="display: flex; gap: var(--space-2); margin: var(--space-5) 0;">
    <button role="tab" id="tab-muslim" aria-selected="true" aria-controls="panel-muslim"
      style="flex:1; padding: 12px; border-radius: var(--radius-control); border: none; background: var(--color-primary-subtle); color: var(--color-primary); font-weight: 600; min-height: 44px;">{t.tab1}</button>
    <button role="tab" id="tab-universal" aria-selected="false" aria-controls="panel-universal" tabindex="-1"
      style="flex:1; padding: 12px; border-radius: var(--radius-control); border: none; background: transparent; color: var(--color-text); font-weight: 600; min-height: 44px;">{t.tab2}</button>
  </div>
  <div role="tabpanel" id="panel-muslim" aria-labelledby="tab-muslim" tabindex="0"
    style="font-size: var(--text-body-lg); line-height: 1.7; max-width: 58ch;">{muslimText}</div>
  <div role="tabpanel" id="panel-universal" aria-labelledby="tab-universal" tabindex="0" hidden
    style="font-size: var(--text-body-lg); line-height: 1.7; max-width: 58ch;">{universalText}</div>
</section>
<script>
  function setupTabs(root: Document) {
    const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const select = (tab: HTMLButtonElement) => {
      tabs.forEach((b) => {
        const selected = b === tab;
        b.setAttribute("aria-selected", String(selected));
        b.tabIndex = selected ? 0 : -1;
        b.style.background = selected ? "var(--color-primary-subtle)" : "transparent";
        b.style.color = selected ? "var(--color-primary)" : "var(--color-text)";
        const panel = root.getElementById(b.getAttribute("aria-controls")!);
        if (panel) panel.hidden = !selected;
      });
      tab.focus();
    };
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const arr = [...tabs];
        const next = arr[(arr.indexOf(tab) + (e.key === "ArrowRight" ? 1 : arr.length - 1)) % arr.length];
        select(next);
      });
    });
  }
  setupTabs(document);
</script>
```

`src/components/EmailForm.astro` (timer island + honeypot + submit):

```astro
---
import { issueTimerToken } from "../lib/timer";
interface Props { slug: string; locale: "id" | "en"; campaignId: string; }
const { slug, locale, campaignId } = Astro.props;
// Server-rendered token: fallback tanpa JS (PRD 7.1). JS hanya memperbarui token.
const serverToken = issueTimerToken(campaignId);
const copy = locale === "en"
  ? { label: "Email to receive your gift", initial: "The button unlocks in 30 seconds.", done: "Thanks for taking a moment. Now, enter your email.", ten: "10 seconds left.", cta: "Send my gift link", consent: "By claiming this gift you also subscribe to the KelasWFA newsletter. See the ", privacy: "privacy policy", tooFast: "Please wait for the timer to finish." }
  : { label: "Email untuk menerima hadiah", initial: "Tombol akan terbuka setelah 30 detik.", done: "Terima kasih sudah meluangkan waktu. Sekarang, masukkan emailmu.", ten: "10 detik lagi.", cta: "Kirim tautan hadiah", consent: "Dengan mengklaim hadiah, kamu juga mendaftar ke newsletter KelasWFA. Lihat ", privacy: "kebijakan privasi", tooFast: "Mohon tunggu timer selesai ya." };
const action = locale === "en" ? "/api/subscribe" : "/api/subscribe";
---
<form id="claim-form" method="post" action={action} style="margin-top: var(--space-8); background: var(--color-surface-raised); border: var(--border-default); border-radius: var(--radius-card); padding: var(--space-6); box-shadow: var(--shadow-card);">
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;" />
  <input type="hidden" name="slug" value={slug} />
  <input type="hidden" name="locale" value={locale} />
  <input type="hidden" name="timer_token" id="timer-token" value={serverToken} data-timer-ms={import.meta.env.TEST_TIMER_MS ?? "30000"} />
  <p id="timer-status" role="status" aria-live="polite" style="color: var(--color-ink); background: var(--color-gold-subtle); border-radius: var(--radius-control); padding: var(--space-3) var(--space-4); font-variant-numeric: tabular-nums;">{copy.initial}</p>
  <div style="height: 4px; background: var(--color-border); border-radius: 999px; margin: var(--space-4) 0;">
    <div id="timer-bar" style="height: 100%; width: 0%; background: var(--color-primary); border-radius: 999px; transition: width 220ms cubic-bezier(0.2, 0.8, 0.2, 1);"></div>
  </div>
  <label for="email" style="display:block; font-weight: 600; color: var(--color-ink); margin-bottom: var(--space-2);">{copy.label}</label>
  <input id="email" name="email" type="email" required autocomplete="email" inputmode="email"
    style="width: 100%; min-height: 48px; border: var(--border-default); border-radius: var(--radius-control); padding: 0 var(--space-4); font-size: 16px; background: var(--color-surface-raised);" />
  <p id="form-error" hidden style="background: var(--color-danger-subtle); color: var(--color-danger); border-radius: var(--radius-control); padding: var(--space-3); margin-top: var(--space-3); font-size: var(--text-body-sm);"></p>
  <p style="font-size: var(--text-body-sm); color: var(--color-text-muted); margin-top: var(--space-3);">
    {copy.consent}<a href={locale === "en" ? "/en/privacy" : "/privacy"} style="text-decoration: underline; color: var(--color-info);">{copy.privacy}</a>.
  </p>
  <button id="submit-btn" type="submit" disabled aria-disabled="true"
    style="width: 100%; min-height: 48px; margin-top: var(--space-4); border: none; border-radius: var(--radius-control); background: var(--color-surface-subtle); color: var(--color-text-muted); font-weight: 600; font-size: 16px;">{copy.cta}</button>
</form>
<script>
  const form = document.getElementById("claim-form") as HTMLFormElement;
  const status = document.getElementById("timer-status")!;
  const bar = document.getElementById("timer-bar")!;
  const tokenInput = document.getElementById("timer-token") as HTMLInputElement;
  const btn = document.getElementById("submit-btn") as HTMLButtonElement;
  const copy = JSON.parse(form.dataset.copy!);
  const TOTAL = 30_000;
  let announced10 = false;
  (async () => {
    try {
      const res = await fetch("/api/timer-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: form.querySelector('[name="slug"]')!.value }),
      });
      if (!res.ok) throw new Error();
      const { token } = await res.json();
      const start = Date.now();
      const tick = () => {
        const elapsed = Date.now() - start;
        bar.style.width = `${Math.min(100, (elapsed / TOTAL) * 100)}%`;
        const left = Math.max(0, Math.ceil((TOTAL - elapsed) / 1000));
        if (!announced10 && left === 10) { announced10 = true; status.textContent = copy.ten; }
        if (elapsed >= TOTAL) {
          status.textContent = copy.done;
          tokenInput.value = token;
          btn.disabled = false;
          btn.setAttribute("aria-disabled", "false");
          btn.style.background = "var(--color-primary)";
          btn.style.color = "#ffffff";
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      status.textContent = copy.tooFast;
    }
  })();
  form.addEventListener("submit", (e) => {
    if (!tokenInput.value) { e.preventDefault(); }
  });
</script>
```

(Simpan `copy` ke `data-copy` attribute JSON-encoded di elemen form agar script bisa membacanya; sesuaikan saat implementasi.)

- [ ] **Step 4: Tulis `src/pages/r/[slug].astro` dan `src/pages/en/r/[slug].astro`**

`src/pages/r/[slug].astro`:

```astro
---
import PublicLayout from "../../layouts/PublicLayout.astro";
import RewardHero from "../../components/RewardHero.astro";
import RewardItemList from "../../components/RewardItemList.astro";
import ReflectionTabs from "../../components/ReflectionTabs.astro";
import EmailForm from "../../components/EmailForm.astro";
import { getPublishedCampaign } from "../../lib/campaign";

const { slug } = Astro.params;
const data = await getPublishedCampaign(slug!);
if (!data) return Astro.redirect("/404");
const { row, fallbackToId } = data.localeRow("id");
const overline = "KADO DARI KELASWFA";
---
<PublicLayout title={row.metaTitle ?? row.title} description={row.metaDescription ?? row.description} lang="id" noindex={!isIndexable}>
  <main style="max-width: var(--funnel-content); margin: 0 auto; padding: var(--space-5);">
    <RewardHero overline={overline} title={row.title} description={row.description} imageKey={data.campaign.featuredImageKey} />
    <RewardItemList items={row.rewardItems} locale="id" />
    <ReflectionTabs muslimText={await data.doaText("muslim", "id")} universalText={await data.doaText("universal", "id")} locale="id" />
    <EmailForm slug={slug!} locale="id" campaignId={data.campaign.id} />
  </main>
</PublicLayout>
```

Tambahkan properti `indexable` boolean default `false` pada `reward_campaigns` (migrasi tambahan via `db:generate`), lalu `const isIndexable = data.campaign.indexable`. `src/pages/en/r/[slug].astro` identik dengan `localeRow("en")`, overline `"A GIFT FROM KELASWFA"`, `lang="en"`, copy EN, dan bila `fallbackToId` tetap render (fallback eksplisit).

- [ ] **Step 5: Jalankan semua test + build**

Run: `npm test && npm run build` → Expected: PASS, build sukses.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: public reward landing page with reflection tabs, timer form, i18n fallback"
```

---

### Task 14: Halaman status, konfirmasi, akses, dan download

**Files:**
- Create: `src/pages/cek-email.astro`, `src/pages/en/cek-email.astro`, `src/pages/konfirmasi/[token].astro`, `src/pages/en/konfirmasi/[token].astro`, `src/pages/akses/[token].astro`, `src/pages/en/akses/[token].astro`, `src/pages/api/download/[session]/[assetId].ts`, `src/pages/api/image/[...key].ts`, `src/pages/privacy.astro`
- Test: `test/download.test.ts`

**Interfaces:**
- Consumes: `confirmContactByToken`, `consumeToken`, `issueSessionToken` (Task 10), `presignDownloadUrl`, `assertAssetDownloadable` (Task 11), `maskedEmail` (Task 9), `getPublishedCampaign` (Task 13), `db`/schema.
- Produces:
  - `GET /konfirmasi/<raw>` → consume `confirm` → sukses: redirect 303 ke `akses/<session>` (session token baru); gagal/kadaluarsa: render halaman expired (Warning Tint) dengan ajakan claim ulang dari landing page.
  - `GET /akses/<session>` → render halaman unduhan (`max-width: 760px`, heading "Kadonya siap dibuka." / "Your gift is ready.") dengan card per asset: nama (locale, fallback ID), tipe, ukuran human-readable, CTA `Unduh aman` ke `/api/download/<session>/<assetId>`, dan teks "Link unduhan berlaku 1 jam."
  - `GET /api/download/<session>/<assetId>` → verifikasi session + asset milik claim → 302 ke presigned URL (1 jam); invalid → 403.
  - `GET /api/image/<key>` → hanya key yang cocok `featured_image_key` campaign published → 302 presigned (1 jam); selain itu 404.
  - `/cek-email` menampilkan email tersamarkan dari query `?m=` (maskedEmail di server), plus tombol ghost "Kirim ulang" yang menaut ke landing page (resend sebenarnya = submit ulang form; cooldown ditangani rate limit email 5/jam).

- [ ] **Step 1: Tulis `test/download.test.ts` (logika endpoint)**

Ekstrak logika endpoint ke `src/lib/download.ts` agar testable:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/lib/db";
import { contacts, rewardCampaigns, rewardAssets, rewardClaims } from "../src/lib/schema";
import { issueSessionToken, upsertClaim } from "../src/lib/access";
import { resolveDownload, resolveFeaturedImage } from "../src/lib/download";
import { resetDb, setEnv } from "./helpers";

beforeEach(async () => {
  await resetDb();
  setEnv({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
});

async function seed() {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "s", status: "published", featuredImageKey: "img/cover.png" }).returning();
  const [asset] = await db.insert(rewardAssets).values({
    campaignId: camp.id, storageKey: "rewards/a.pdf", nameId: "File A", mimeType: "application/pdf",
    sizeBytes: 1024, checksum: "x",
  }).returning();
  const claimId = await upsertClaim(c.id, camp.id);
  return { camp, asset, claimId };
}

describe("resolveDownload", () => {
  it("returns presigned url for valid session+asset", async () => {
    const { asset, claimId } = await seed();
    const session = await issueSessionToken(claimId);
    const r = await resolveDownload(session, asset.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new URL(r.url).searchParams.get("X-Amz-Expires")).toBe("3600");
  });
  it("rejects foreign asset and bad session", async () => {
    const { asset, claimId } = await seed();
    const session = await issueSessionToken(claimId);
    expect((await resolveDownload(session, "00000000-0000-0000-0000-000000000000")).ok).toBe(false);
    expect((await resolveDownload("badtoken", asset.id)).ok).toBe(false);
  });
});

describe("resolveFeaturedImage", () => {
  it("allows only published campaign featured keys", async () => {
    await seed();
    expect((await resolveFeaturedImage("img/cover.png")).ok).toBe(true);
    expect((await resolveFeaturedImage("img/other.png")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal** — Run: `npm test -- test/download.test.ts` → Expected: FAIL.

- [ ] **Step 3: Tulis `src/lib/download.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { rewardAssets, rewardCampaigns, rewardClaims } from "./schema";
import { consumeToken } from "./access";
import { presignDownloadUrl, assertAssetDownloadable } from "./storage";

export async function resolveDownload(sessionToken: string, assetId: string):
  Promise<{ ok: true; url: string } | { ok: false }> {
  const sess = await consumeToken(sessionToken, "session");
  if (!sess.ok) return { ok: false };
  const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, sess.claimId));
  if (!claim) return { ok: false };
  const [asset] = await db.select().from(rewardAssets)
    .where(and(eq(rewardAssets.id, assetId), eq(rewardAssets.campaignId, claim.campaignId)));
  if (!asset) return { ok: false };
  try {
    assertAssetDownloadable({ mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
    return { ok: true, url: await presignDownloadUrl(asset.storageKey, 3600) };
  } catch {
    return { ok: false };
  }
}

export async function resolveFeaturedImage(key: string): Promise<{ ok: true; url: string } | { ok: false }> {
  const [camp] = await db.select().from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.featuredImageKey, key), eq(rewardCampaigns.status, "published")));
  if (!camp) return { ok: false };
  return { ok: true, url: await presignDownloadUrl(key, 3600) };
}
```

- [ ] **Step 4: Jalankan test** — Run: `npm test -- test/download.test.ts` → Expected: PASS.

- [ ] **Step 5: Tulis halaman-halaman**

`src/pages/konfirmasi/[token].astro` (dan padanan `en/`):

```astro
---
import PublicLayout from "../../layouts/PublicLayout.astro";
import { confirmContactByToken, issueSessionToken } from "../../lib/access";
const { token } = Astro.params;
const result = await confirmContactByToken(token!);
if (result.ok) {
  const session = await issueSessionToken(result.claimId);
  return Astro.redirect(`/akses/${session}`, 303);
}
---
<PublicLayout title="Tautan kedaluwarsa" lang="id">
  <main style="max-width: var(--download-content); margin: 0 auto; padding: var(--space-12) var(--space-5);">
    <div style="background: var(--color-warning-subtle); border: var(--border-default); border-radius: var(--radius-card); padding: var(--space-6);">
      <h1 style="color: var(--color-ink);">Tautan sudah kedaluwarsa</h1>
      <p>Tautan konfirmasi berlaku 7 hari. Silakan klaim ulang hadiah dari halaman awal dengan email yang sama — kami akan mengirim tautan baru.</p>
      <a href="/" style="color: var(--color-primary); font-weight: 600;">Kembali ke halaman hadiah</a>
    </div>
  </main>
</PublicLayout>
```

`src/pages/akses/[token].astro` (dan `en/`): verifikasi `consumeToken(token, "session")`; fetch claim → campaign → assets → locale row via `getPublishedCampaign(campaign.slug)`; render:

```astro
---
import PublicLayout from "../../layouts/PublicLayout.astro";
import { consumeToken } from "../lib/access";
import { db } from "../lib/db";
import { rewardAssets, rewardCampaigns, rewardClaims } from "../lib/schema";
import { eq } from "drizzle-orm";
import { getPublishedCampaign } from "../lib/campaign";

const { token } = Astro.params;
const sess = await consumeToken(token!, "session");
if (!sess.ok) return Astro.redirect("/");
const [claim] = await db.select().from(rewardClaims).where(eq(rewardClaims.id, sess.claimId));
const [campaign] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, claim.campaignId));
const data = await getPublishedCampaign(campaign.slug);
const { row } = data!.localeRow("id");
const assets = await db.select().from(rewardAssets).where(eq(rewardAssets.campaignId, claim.campaignId));
function humanSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
---
<PublicLayout title="Kadonya siap dibuka" lang="id">
  <main style="max-width: var(--download-content); margin: 0 auto; padding: var(--space-12) var(--space-5);">
    <h1 style="color: var(--color-ink);">Kadonya siap dibuka.</h1>
    <p style="color: var(--color-text-muted);">Link unduhan berlaku 1 jam.</p>
    <ul style="list-style: none; padding: 0; display: grid; gap: var(--space-3);">
      {assets.map((a) => (
        <li style="background: var(--color-surface-raised); border: var(--border-default); border-radius: var(--radius-card); padding: var(--space-6); display: flex; justify-content: space-between; align-items: center; gap: var(--space-4);">
          <div>
            <strong style="color: var(--color-ink);">{a.nameId}</strong>
            <p style="margin: 4px 0 0; color: var(--color-text-muted); font-size: var(--text-body-sm);">{a.mimeType} · {humanSize(Number(a.sizeBytes))}</p>
          </div>
          <a href={`/api/download/${token}/${a.id}`} style="background: var(--color-primary); color: #fff; text-decoration: none; padding: 12px 20px; border-radius: var(--radius-control); font-weight: 600; min-height: 44px; display: inline-flex; align-items: center;">Unduh aman</a>
        </li>
      ))}
    </ul>
  </main>
</PublicLayout>
```

(Bersihkan kerangka IIFE saat implementasi — query slug campaign langsung dengan satu join/select; jangan biarkan `as any`.)

`src/pages/api/download/[session]/[assetId].ts`:

```ts
import type { APIRoute } from "astro";
import { resolveDownload } from "../../../lib/download";

export const GET: APIRoute = async ({ params }) => {
  const r = await resolveDownload(params.session!, params.assetId!);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  return Response.redirect(r.url, 302);
};
```

`src/pages/api/image/[...key].ts` serupa dengan `resolveFeaturedImage`. `/cek-email.astro` membaca `?m=` dan render `maskedEmail`-safe string (server yang memanggil maskedEmail). `/privacy.astro`: satu halaman statis menjelaskan data yang dikumpulkan (email, locale, riwayat claim; IP hanya hash anti-abuse), cara unsubscribe, dan kontak `admin@kelaswfa.my.id`.

- [ ] **Step 6: Build + semua test** — Run: `npm test && npm run build` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: confirmation, access session, secure download and status pages"
```

---

### Task 15: Lifecycle gating, seed script, Playwright smoke, cron setup

**Files:**
- Modify: `src/lib/campaign.ts` (gating draft/paused/archived), `src/pages/r/[slug].astro` + `en/r/[slug].astro` (halaman paused), `vercel.json`
- Create: `scripts/seed.ts`, `test/e2e/funnel.spec.ts`, `playwright.config.ts`
- Test: `test/lifecycle.test.ts` + e2e

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces:
  - Lifecycle publik: `draft`/`archived` → 404; `paused` → halaman ramah (Warning Tint) "Campaign sedang dijeda" + arahan klaim ulang nanti; claim lama dengan session valid **tetap berfungsi** (download tidak mengecek status campaign — sudah benar di Task 14; tambahkan test yang membuktikannya).
  - `scripts/seed.ts`: idempoten — insert `DEFAULT_DOMAINS` (Task 4) bila kosong; insert 4 doa templates (muslim/universal × id/en, konten di bawah); insert campaign contoh `slug: "starter-kit"` status `published` dengan locale id (EN dikosongkan untuk membuktikan fallback) + 1 asset row bila `R2_*` terisi (upload file contoh kecil ke R2 dan hitung checksum SHA-256).
  - `vercel.json` cron: `{"crons": [{"path": "/api/cron/outbox", "schedule": "* * * * *"}]}` (auth via `x-cron-secret` header yang dikonfigurasi di Vercel cron settings).

- [ ] **Step 1: Tulis `test/lifecycle.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/lib/db";
import { contacts, rewardCampaigns } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { getPublicCampaignState } from "../src/lib/campaign";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("public lifecycle gating", () => {
  it("draft and archived are hidden", async () => {
    await db.insert(rewardCampaigns).values({ slug: "d1", status: "draft" });
    await db.insert(rewardCampaigns).values({ slug: "d2", status: "archived" });
    expect(await getPublicCampaignState("d1")).toEqual({ state: "hidden" });
    expect(await getPublicCampaignState("d2")).toEqual({ state: "hidden" });
  });
  it("paused is friendly-blocked", async () => {
    await db.insert(rewardCampaigns).values({ slug: "p1", status: "paused" });
    expect(await getPublicCampaignState("p1")).toEqual({ state: "paused" });
  });
  it("published is served", async () => {
    await db.insert(rewardCampaigns).values({ slug: "p2", status: "published" });
    expect((await getPublicCampaignState("p2")).state).toBe("published");
  });
});
```

Tambahkan ke `src/lib/campaign.ts`:

```ts
export async function getPublicCampaignState(slug: string):
  Promise<{ state: "hidden" | "paused" | "published" }> {
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp || camp.status === "draft" || camp.status === "archived") return { state: "hidden" };
  if (camp.status === "paused") return { state: "paused" };
  return { state: "published" };
}
```

Panggil di `r/[slug].astro`: `hidden` → 404; `paused` → render halaman paused; `published` → render normal. (Subscribe endpoint juga harus menolak campaign non-published: tambahkan cek `status === "published"` di `processSubscribe` sebelum lookup locale, return `campaign-unavailable`. Update `test/subscribe.test.ts` dengan case draft.)

- [ ] **Step 2: Jalankan test** — Run: `npm test -- test/lifecycle.test.ts` → Expected: PASS.

- [ ] **Step 3: Tulis `scripts/seed.ts`**

```ts
import { db } from "../src/lib/db";
import { doaTemplates, emailDomains, rewardAssets, rewardCampaignLocales, rewardCampaigns } from "../src/lib/schema";
import { createHash } from "node:crypto";
import { DEFAULT_DOMAINS } from "../src/lib/allowlist";

const DOA = [
  { variant: "muslim", locale: "id", name: "Doa Muslim v1", content: "Ya Allah, berkahilah setiap usaha dan kerja keras kami hari ini. Lapangkan setiap langkah, mudahkan setiap urusan, dan jadikan ilmu yang kami pelajari bermanfaat bagi kami dan orang banyak. Aamiin." },
  { variant: "muslim", locale: "en", name: "Doa Muslim v1", content: "O Allah, bless every effort and hard work we put in today. Ease every step, smooth every matter, and make the knowledge we gain beneficial for us and for many. Ameen." },
  { variant: "universal", locale: "id", name: "Harapan Baik v1", content: "Semoga setiap langkah kecilmu hari ini membawamu lebih dekat ke tujuan besarmu. Semoga usahamu yang konsisten melunakkan jalan di depan — pelan-pelan, tapi pasti." },
  { variant: "universal", locale: "en", name: "Harapan Baik v1", content: "May every small step you take today bring you closer to your big goal. May your consistent effort soften the road ahead — slowly, but surely." },
] as const;

async function main() {
  const domains = await db.select().from(emailDomains);
  if (domains.length === 0) {
    await db.insert(emailDomains).values(DEFAULT_DOMAINS.map((domain) => ({ domain })));
    console.log(`seeded ${DEFAULT_DOMAINS.length} email domains`);
  }
  for (const tpl of DOA) {
    const existing = await db.select().from(doaTemplates)
      .where(and(eq(doaTemplates.variant, tpl.variant), eq(doaTemplates.locale, tpl.locale), eq(doaTemplates.name, tpl.name)));
    if (existing.length === 0) await db.insert(doaTemplates).values(tpl);
  }
  let [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, "starter-kit"));
  if (!camp) {
    [camp] = await db.insert(rewardCampaigns).values({
      slug: "starter-kit", status: "published", publishedAt: new Date(),
    }).returning();
    await db.insert(rewardCampaignLocales).values({
      campaignId: camp.id, locale: "id",
      title: "Starter Kit KelasWFA",
      description: "Kumpulan template dan checklist untuk memulai perjalanan menuju kebebasan finansial lewat kerja dan skill.",
      rewardItems: [
        { name: "Checklist 30 Hari", benefit: "Rencana harian yang bisa langsung dijalankan.", format: "PDF", size: "2 MB" },
        { name: "Template Budget", benefit: "Kelola pemasukan dan penghematan dengan rapi.", format: "XLSX", size: "1 MB" },
      ],
      metaTitle: "Starter Kit KelasWFA — Hadiah Gratis",
      metaDescription: "Unduh Starter Kit KelasWFA: checklist 30 hari dan template budget untuk memulai perjalanan finansialmu.",
    });
    console.log("seeded starter-kit campaign");
  }
  console.log("seed done");
  process.exit(0);
}
main();
```

Tambahkan import `and, eq` dari drizzle-orm. Upload asset contoh ke R2 bila `R2_ACCESS_KEY_ID` terisi: buat buffer PDF kecil (atau file `scripts/sample.pdf` 1KB), PUT via aws4fetch `sign` biasa, insert row `reward_assets` dengan checksum `sha256Hex` dari buffer dan `doa_selection` menghubungkan kedua preset ke campaign. Bila env kosong: lewati dengan pesan (asset dapat ditambahkan lewat admin di Plan 2).

- [ ] **Step 4: Playwright smoke test**

```bash
npm i -D @playwright/test && npx playwright install chromium
```

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  use: { baseURL: "http://localhost:4321" },
  webServer: {
    command: "npm run seed && npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

`test/e2e/funnel.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("funnel: timer unlocks, submit shows generic check-email page", async ({ page }) => {
  await page.goto("/r/starter-kit");
  await expect(page.getByRole("heading", { name: "Starter Kit KelasWFA" })).toBeVisible();
  await expect(page.locator("#submit-btn")).toBeDisabled();
  await expect(page.locator("#timer-status")).toContainText("30 detik");
  await page.waitForTimeout(31_000); // — untuk CI: gunakan clock API Playwright `page.clock` bila tersedia, atau kurangi TOTAL lewat env TEST_TIMER_MS
  await expect(page.locator("#submit-btn")).toBeEnabled();
  await page.fill("#email", "e2e@gmail.com");
  await page.click("#submit-btn");
  await expect(page).toHaveURL(/cek-email/);
  await expect(page.getByRole("heading", { name: "Cek emailmu" })).toBeVisible();
});

test("en fallback: /en/r/starter-kit renders Indonesian content with lang=en", async ({ page }) => {
  await page.goto("/en/r/starter-kit");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Starter Kit KelasWFA" })).toBeVisible(); // fallback ID
});
```

Catatan implementasi timer: baca durasi dari `data-timer-ms` attribute pada form (server men-set `TEST_TIMER_MS` env atau default 30000) supaya test memakai `data-timer-ms="100"` — lebih cepat dan deterministik daripada `waitForTimeout`.

- [ ] **Step 5: Jalankan seluruh suite**

Run: `npx playwright test && npm test && npm run build`
Expected: e2e 2 test PASS; unit/integration PASS; build sukses.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: lifecycle gating, idempotent seed script, playwright funnel smoke, vercel cron"
```

---

## Setelah Plan 1 selesai

- **Plan 2 — Admin & CMS:** auth password Argon2id + OTP email + trusted device 30 hari, CMS reward campaign (draft/publish/pause/archive/duplicate, upload asset dengan validasi MIME/ukuran/checksum, preview), allowlist management + audit log, contact view + export CSV.
- **Plan 3 — Broadcast:** email campaign editor bilingual, segmentasi ANY/ALL + snapshot, queue prioritas + limit per menit/jam, pause/resume/cancel, unsubscribe satu klik + suppression + re-subscribe consent, click tracking redirect aman, webhook Emailit (signature + idempoten), delivery reporting, hardening launch (CSP/HSTS, backup test, alerting).

Kedua plan disusun dengan skill `writing-plans` setelah Plan 1 dieksekusi (atau paralel bila diminta).
