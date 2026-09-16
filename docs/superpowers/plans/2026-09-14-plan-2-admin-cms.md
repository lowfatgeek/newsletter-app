# KelasWFA Plan 2 — Admin & CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun dashboard satu-admin: login password Argon2id + OTP email + trusted device 30 hari, CMS reward campaign lengkap (CRUD, duplicate, upload asset, preset doa, publish/pause/archive, slug redirect, preview), manajemen allowlist domain, view contact + export CSV ber-audit, plus perbaikan deferred minor dari Plan 1.

**Architecture:** Semua logika admin hidup di modul murni `src/lib/admin/*` (DB-driven, testable tanpa Astro); pages `/admin/*` tipis memanggil lib. Auth dua faktor: password → OTP email via outbox transactional → session DB (cookie httpOnly) atau trusted-device cookie 30 hari. Setiap aksi berisiko ditulis ke `admin_audit_log`. UI mengikuti DESIGN.md §6: sidebar Ink Forest, canvas Ivory, card putih, badge status berikon.

**Tech Stack:** Astro 5 + Node adapter (existing), Drizzle ORM + Postgres (existing), @node-rs/argon2 (hash password), aws4fetch (R2 PUT), Vitest, Playwright.

**Spec:** `.agents/kelaswfa-newsletter-prd-v2.md` (bagian 2 keputusan terkunci Admin; 7.3 Dashboard admin; 10 Keamanan) dan `.agents/DESIGN.md` (§6 Component Stylings — Admin; §8 responsif/a11y). Executor wajib membaca keduanya.

**Ruang lingkup plan ini (dan apa yang TIDAK):**

- Termasuk: seluruh 7.3 (auth, CMS, kontak, CSV), upload asset privat, allowlist management, audit log, reset password, anonimisasi contact, deferred minors Plan 1 (daftar di Task 16).
- Tidak termasuk (Plan 3): email campaign/broadcast, unsubscribe/click tracking, webhook delivery, delivery reporting, alerting/monitoring produksi. Kolom `EMAIL_DELIVERY` belum ada, jadi view contact menampilkan riwayat claim + status subscription, delivery status menyusul Plan 3.

---

## Global Constraints

- Hanya `kelaswfa@gmail.com` yang dapat menjadi admin MVP (env `ADMIN_EMAIL`, default `kelaswfa@gmail.com`).
- Password disimpan sebagai hash Argon2id; tidak ada plaintext, tidak ada OTP mentah tersimpan.
- OTP: 6 digit, kedaluwarsa 10 menit, disimpan sebagai hash, dibatasi percobaannya (maksimal 5 attempt per challenge).
- Trusted device: 30 hari, cookie httpOnly + Secure + SameSite, token dapat dicabut; login dari perangkat baru SELALU butuh OTP.
- Session admin: cookie httpOnly, Secure (production), SameSite=Lax; rotasi session saat login; semua session di-invalidasi saat password berubah.
- Perubahan keamanan, login gagal, publish reward campaign, perubahan allowlist, dan aksi broadcast dicatat pada audit log (`admin_audit_log`).
- Slug: unik, URL-safe, lowercase; tidak bisa diubah diam-diam setelah publish — perlu konfirmasi eksplisit dan membuat redirect historis.
- Upload: PDF, ZIP, DOCX, XLSX, PPTX, PNG, JPG/JPEG, WebP, ≤ 100 MB per file; validasi MIME + ekstensi + ukuran + checksum; disimpan privat di R2; object key tidak pernah diekspos.
- CSV export tidak berisi token, IP hash, atau rahasia internal; setiap export tercatat di audit log.
- Env hanya via `src/lib/env.ts`; design token via `src/styles/tokens.css` (jangan hardcode warna); badge status selalu ikon + teks.
- Rate limit login: maksimal 10 attempt/jam per IP dan per email (reuse `consumeRateLimit` + `hashIp`).
- Email OTP dikirim via outbox transactional yang ada (`enqueueTransactionalEmail`), `emailType: "otp_admin"`; MOCK_EMAILIT tetap berfungsi untuk test.

## File Structure

```
src/lib/admin/
  password.ts        # hashPassword / verifyPassword (@node-rs/argon2)
  sessions.ts        # createAdminSession, getAdminFromCookies, revokeAllSessions
  otp.ts             # issueOtpChallenge, verifyOtpChallenge
  devices.ts         # mintTrustedDevice, validateTrustedDevice, revokeTrustedDevice
  audit.ts           # audit(action, detail, adminUserId?, ip?)
  login.ts           # startLogin, completeLogin, logoutAdmin
  guard.ts           # requireAdmin(Astro/APIContext), COOKIES constants
  campaigns.ts       # slug validation, CRUD, duplicate, status, doa selection, redirects
  assets.ts          # validateUpload, storeAsset, removeAsset
  domains.ts         # addDomain, setDomainActive, removeDomain
  contacts.ts        # listContacts, getContactDetail, exportCsv, anonymizeContact
  format.ts          # humanSize (dipindah dari halaman akses)
src/layouts/AdminLayout.astro
src/pages/admin/
  login.astro  otp.astro  index.astro  404.astro (root)
  campaigns/new.astro  campaigns/[id].astro  preview/[id].astro
  contacts/index.astro  contacts/[id].astro
  api/login.ts  api/otp.ts  api/logout.ts
  api/campaigns/index.ts  api/campaigns/[id].ts  api/campaigns/[id]/status.ts
  api/campaigns/[id]/assets.ts  api/assets/[id].ts  api/campaigns/[id]/doa.ts
  api/domains.ts  api/contacts/export.ts  api/contacts/[id]/anonymize.ts
scripts/bootstrap-admin.ts
test/admin/{password,sessions,otp,devices,audit,login,guard,campaigns,assets,domains,contacts}.test.ts
test/admin/redirects.test.ts  test/admin/e2e/admin.spec.ts
```

---

### Task 1: Schema admin (migrasi)

**Files:**
- Modify: `src/lib/schema.ts`
- Test: `test/admin/schema.test.ts`

**Interfaces:**
- Produces tabel drizzle: `adminUsers` (id, email unique, passwordHash, createdAt, lastLoginAt), `adminSessions` (id, tokenHash unique, adminUserId FK, expiresAt, revokedAt, createdAt), `adminOtpChallenges` (id, adminUserId FK, codeHash, expiresAt, attempts default 0, consumedAt, createdAt), `trustedDevices` (id, adminUserId FK, tokenHash unique, expiresAt, revokedAt, userAgent, createdAt), `adminAuditLog` (id, adminUserId FK nullable, action varchar(50), detail jsonb default {}, ipHash, createdAt), `campaignRedirects` (id, campaignId FK, oldSlug unique, createdAt). Sekaligus tambahkan kolom `sortOrder: integer("sort_order").notNull().default(0)` pada tabel `reward_campaign` (PRD 7.3: field "urutan" campaign; dipakai `updateCampaignMeta` Task 9 dan dashboard Task 10). Tipe `$inferSelect` tersedia untuk semua.

- [ ] **Step 1: Tulis `test/admin/schema.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import {
  adminAuditLog, adminOtpChallenges, adminSessions, adminUsers,
  campaignRedirects, rewardCampaigns, trustedDevices,
} from "../../src/lib/schema";
import { resetDb } from "../helpers";

describe("admin schema", () => {
  beforeEach(resetDb);
  it("creates admin user and related rows", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "kelaswfa@gmail.com", passwordHash: "h" }).returning();
    const [s] = await db.insert(adminSessions).values({ tokenHash: "t1", adminUserId: u.id, expiresAt: new Date(Date.now() + 1000) }).returning();
    const [c] = await db.insert(adminOtpChallenges).values({ adminUserId: u.id, codeHash: "c", expiresAt: new Date() }).returning();
    const [d] = await db.insert(trustedDevices).values({ adminUserId: u.id, tokenHash: "d1", expiresAt: new Date() }).returning();
    const [a] = await db.insert(adminAuditLog).values({ action: "test", adminUserId: u.id }).returning();
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "x" }).returning();
    const [r] = await db.insert(campaignRedirects).values({ campaignId: camp.id, oldSlug: "old" }).returning();
    expect(s.adminUserId).toBe(u.id);
    expect(c.attempts).toBe(0);
    expect(d.revokedAt).toBeNull();
    expect(a.detail).toEqual({});
    expect(r.oldSlug).toBe("old");
  });
  it("rejects duplicate email and duplicate tokenHash", async () => {
    await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" });
    await expect(db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" })).rejects.toThrow();
  });
});
```

Tambahkan juga ke `resetDb` di `test/helpers.ts`: `admin_session, admin_otp_challenge, trusted_device, admin_audit_log, campaign_redirect, admin_user` di depan daftar TRUNCATE.

- [ ] **Step 2: Jalankan test, pastikan gagal** — Run: `npm test -- test/admin/schema.test.ts` → FAIL (tabel belum ada).

- [ ] **Step 3: Tulis tabel di `src/lib/schema.ts`** (pola sama dengan tabel lain):

```ts
export const adminUsers = pgTable("admin_user", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const adminSessions = pgTable("admin_session", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminOtpChallenges = pgTable("admin_otp_challenge", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trustedDevices = pgTable("trusted_device", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 300 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
  action: varchar("action", { length: 50 }).notNull(),
  detail: jsonb("detail").notNull().default({}),
  ipHash: varchar("ip_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaigns = pgTable("reward_campaign", {
  // ... kolom yang sudah ada (id, slug, status, featured_image_key, published_at, created_at, indexable) ...
  sortOrder: integer("sort_order").notNull().default(0),
});
```

(Catatan: tambahkan hanya baris `sortOrder` pada definisi `rewardCampaigns` yang sudah ada — jangan buat tabel baru.)

```ts
export const campaignRedirects = pgTable("campaign_redirect", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  oldSlug: varchar("old_slug", { length: 120 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate & jalankan migrasi, test PASS** — `npm run db:generate && npm run db:migrate && npm test -- test/admin/schema.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: admin schema (user, session, otp, trusted device, audit log, redirects)"`

---

### Task 2: Password Argon2id + bootstrap admin

**Files:**
- Create: `src/lib/admin/password.ts`, `scripts/bootstrap-admin.ts`
- Modify: `package.json` (script `"admin:bootstrap": "tsx scripts/bootstrap-admin.ts"`), `.env.example` (tambah `ADMIN_EMAIL=kelaswfa@gmail.com`, `ADMIN_PASSWORD=`)
- Test: `test/admin/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>` (Argon2id), `verifyPassword(hash: string, plain: string): Promise<boolean>`; `assertPasswordStrength(plain: string): void` (melempar Error bila < 12 karakter atau tidak mengandung huruf dan angka); script idempoten yang membuat admin dari env.

- [ ] **Step 1: Install** — `npm i @node-rs/argon2`

- [ ] **Step 2: Tulis test yang gagal**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, assertPasswordStrength } from "../../src/lib/admin/password";

describe("password", () => {
  it("argon2id round-trip", async () => {
    const h = await hashPassword("correct horse battery 9");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery 9")).toBe(true);
    expect(await verifyPassword(h, "wrong password 9")).toBe(false);
  });
  it("rejects weak passwords", () => {
    expect(() => assertPasswordStrength("short1")).toThrow();
    expect(() => assertPasswordStrength("nonumbersinthispassword")).toThrow();
    expect(() => assertPasswordStrength("StrongPassword123")).not.toThrow();
  });
});
```

- [ ] **Step 3: Jalankan → FAIL, lalu implementasi**

```ts
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argonVerify(hash, plain);
}
export function assertPasswordStrength(plain: string): void {
  if (plain.length < 12 || !/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    throw new Error("Password minimal 12 karakter dan mengandung huruf serta angka");
  }
}
```

Run: `npm test -- test/admin/password.test.ts` → PASS.

- [ ] **Step 4: Tulis `scripts/bootstrap-admin.ts`**

```ts
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db, sqlClient } from "../src/lib/db";
import { adminUsers } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword, assertPasswordStrength } from "../src/lib/admin/password";
import { env } from "../src/lib/env";

async function main() {
  const email = env("ADMIN_EMAIL", "kelaswfa@gmail.com").toLowerCase();
  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) {
    console.log(`Admin ${email} sudah ada. Tidak ada perubahan.`);
    process.exit(0);
  }
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  assertPasswordStrength(password);
  await db.insert(adminUsers).values({ email, passwordHash: await hashPassword(password) });
  if (!process.env.ADMIN_PASSWORD) console.log(`PASSWORD SEKALI PAKAI (simpan sekarang): ${password}`);
  console.log(`Admin ${email} dibuat.`);
  await sqlClient.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: argon2id password helpers and idempotent admin bootstrap"`

---

### Task 3: Session admin + cookie

**Files:**
- Create: `src/lib/admin/sessions.ts`
- Test: `test/admin/sessions.test.ts`

**Interfaces:**
- Consumes: `adminSessions`, `adminUsers` (Task 1); `generateOpaqueToken`, `hashToken` (Plan 1 crypto).
- Produces:
  - `createAdminSession(adminUserId: string): Promise<{ id: string; raw: string; expiresAt: Date }>` — TTL `ADMIN_SESSION_TTL_HOURS` env, default 12.
  - `resolveSession(raw: string | undefined): Promise<AdminUser | null>` — hash lookup, `expires_at > now()`, `revoked_at IS NULL`; join ke `adminUsers`.
  - `revokeSession(raw)`, `revokeAllSessions(adminUserId)`.
  - Konstanta `ADMIN_SESSION_COOKIE = "kado_admin_session"`, `ADMIN_DEVICE_COOKIE = "kado_admin_device"`, dan `adminCookieAttrs(secure: boolean): string` → `"; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "") + "; Path=/"`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminUsers } from "../../src/lib/schema";
import { createAdminSession, resolveSession, revokeSession, revokeAllSessions } from "../../src/lib/admin/sessions";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("admin sessions", () => {
  beforeEach(resetDb);
  it("create → resolve round-trip", async () => {
    const u = await seedAdmin();
    const s = await createAdminSession(u.id);
    const admin = await resolveSession(s.raw);
    expect(admin?.id).toBe(u.id);
    expect(admin?.email).toBe("a@gmail.com");
  });
  it("expired session resolves null", async () => {
    const u = await seedAdmin();
    const s = await createAdminSession(u.id);
    await db.update(adminSessionsTable()).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveSession(s.raw)).toBeNull();
  });
  it("revoked single and revoke-all", async () => {
    const u = await seedAdmin();
    const s1 = await createAdminSession(u.id);
    const s2 = await createAdminSession(u.id);
    await revokeSession(s1.raw);
    expect(await resolveSession(s1.raw)).toBeNull();
    expect(await resolveSession(s2.raw)).not.toBeNull();
    await revokeAllSessions(u.id);
    expect(await resolveSession(s2.raw)).toBeNull();
  });
  it("garbage resolves null", async () => {
    expect(await resolveSession("nope")).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });
});

// helper kecil agar test bisa update tabel tanpa import ganda yang membingungkan
import { adminSessions as adminSessionsTable } from "../../src/lib/schema";
function adminSessionsTable() { return adminSessionsTable; }
```

Catatan: bersihkan helper duplikat itu saat implementasi — cukup import `adminSessions` sekali dan update berdasarkan `s.id`.

- [ ] **Step 2: FAIL → implementasi `src/lib/admin/sessions.ts`**

```ts
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { adminSessions, adminUsers } from "../schema";
import { generateOpaqueToken, hashToken } from "../crypto";
import { env } from "../env";

export const ADMIN_SESSION_COOKIE = "kado_admin_session";
export const ADMIN_DEVICE_COOKIE = "kado_admin_device";

export function adminCookieAttrs(secure: boolean): string {
  return `; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Path=/`;
}

export async function createAdminSession(adminUserId: string) {
  const raw = generateOpaqueToken();
  const hours = Number(env("ADMIN_SESSION_TTL_HOURS", "12"));
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  const [row] = await db.insert(adminSessions)
    .values({ adminUserId, tokenHash: hashToken(raw), expiresAt }).returning();
  return { id: row.id, raw, expiresAt };
}

export async function resolveSession(raw: string | undefined) {
  if (!raw) return null;
  const rows = await db.select({
    id: adminUsers.id, email: adminUsers.email,
  }).from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(
      eq(adminSessions.tokenHash, hashToken(raw)),
      gt(adminSessions.expiresAt, new Date()), isNull(adminSessions.revokedAt),
    )).limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(raw: string) {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, hashToken(raw)));
}
export async function revokeAllSessions(adminUserId: string) {
  await db.update(adminSessions).set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)));
}
```

- [ ] **Step 3: PASS → Commit** — `git commit -m "feat: db-backed admin sessions with rotation-ready revoke"`

---

### Task 4: OTP challenge

**Files:**
- Modify: `src/lib/templates.ts` (tambah `otpEmail(code)`)
- Create: `src/lib/admin/otp.ts`
- Test: `test/admin/otp.test.ts`

**Interfaces:**
- Consumes: `adminOtpChallenges` (Task 1), `enqueueTransactionalEmail` (Plan 1 outbox), `hashToken`.
- Produces:
  - `issueOtpChallenge(adminUserId: string, email: string): Promise<string>` — kode 6 digit CSPRNG (`randomInt`), hash tersimpan, kedaluwarsa 10 menit, enqueue email `otp_admin` (idempotencyKey `otp-<challengeId>`), return challengeId.
  - `verifyOtpChallenge(challengeId: string, code: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "too-many-attempts" }>` — atomik: attempt ke-6+ → `too-many-attempts`; kode salah menambah attempts; sukses set `consumed_at`.

- [ ] **Step 1: Tambah template OTP di `src/lib/templates.ts`**

```ts
export function otpEmail(code: string) {
  return {
    subject: "Kode login KelasWFA Admin",
    html: layout("id", "Kode login Anda",
      `<p>Kode OTP Anda:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#153B35;">${code}</p><p>Berlaku 10 menit. Jangan bagikan kode ini.</p>`,
      "", ""),
    text: `Kode OTP KelasWFA Admin: ${code} (berlaku 10 menit)`,
  };
}
```

(Perbaiki layout agar link kosong tidak dirender: skip blok `<a>` bila `url` kosong.) Tambah test di `test/templates.test.ts`: html memuat kode, tidak memuat `<a href=""`.

- [ ] **Step 2: Tulis `test/admin/otp.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminOtpChallenges, adminUsers, emailOutbox } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { issueOtpChallenge, verifyOtpChallenge } from "../../src/lib/admin/otp";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("otp", () => {
  beforeEach(resetDb);
  it("issues challenge, enqueues email, correct code verifies once", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.emailType, "otp_admin"));
    const code = mail.text.match(/\d{6}/)![0];
    expect(await verifyOtpChallenge(id, code)).toEqual({ ok: true });
    expect(await verifyOtpChallenge(id, code)).toEqual({ ok: false, reason: "invalid" });
  });
  it("wrong code increments attempts; 6th attempt rejected", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtpChallenge(id, "000000")).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyOtpChallenge(id, "000000")).toEqual({ ok: false, reason: "too-many-attempts" });
  });
  it("expired challenge rejected", async () => {
    const u = await seedAdmin();
    const id = await issueOtpChallenge(u.id, u.email);
    await db.update(adminOtpChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminOtpChallenges.id, id));
    expect(await verifyOtpChallenge(id, "123456")).toEqual({ ok: false, reason: "expired" });
  });
});
```

- [ ] **Step 3: FAIL → implementasi `src/lib/admin/otp.ts`**

```ts
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db";
import { adminOtpChallenges } from "../schema";
import { hashToken } from "../crypto";
import { enqueueTransactionalEmail } from "../outbox";
import { otpEmail } from "../templates";

const TEN_MIN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export async function issueOtpChallenge(adminUserId: string, email: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [row] = await db.insert(adminOtpChallenges)
    .values({ adminUserId, codeHash: hashToken(code), expiresAt: new Date(Date.now() + TEN_MIN_MS) })
    .returning();
  const m = otpEmail(code);
  await enqueueTransactionalEmail({
    emailType: "otp_admin", to: email, ...m,
    idempotencyKey: `otp-${row.id}`,
  });
  // Hapus challenge kedaluwarsa lama milik admin ini (housekeeping murah)
  await db.delete(adminOtpChallenges)
    .where(and(eq(adminOtpChallenges.adminUserId, adminUserId), lt(adminOtpChallenges.expiresAt, new Date())));
  return row.id;
}

export async function verifyOtpChallenge(challengeId: string, code: string):
  Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "too-many-attempts" }> {
  const [ch] = await db.select().from(adminOtpChallenges).where(eq(adminOtpChallenges.id, challengeId));
  if (!ch) return { ok: false, reason: "invalid" };
  if (ch.consumedAt) return { ok: false, reason: "invalid" };
  if (ch.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too-many-attempts" };
  if (ch.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (ch.codeHash !== hashToken(code)) {
    await db.update(adminOtpChallenges).set({ attempts: ch.attempts + 1 }).where(eq(adminOtpChallenges.id, ch.id));
    return { ok: false, reason: "invalid" };
  }
  await db.update(adminOtpChallenges).set({ consumedAt: new Date() }).where(eq(adminOtpChallenges.id, ch.id));
  return { ok: true };
}
```

- [ ] **Step 4: PASS → Commit** — `git commit -m "feat: hashed 6-digit otp challenges with attempt cap and email delivery"`

---

### Task 5: Trusted device

**Files:**
- Create: `src/lib/admin/devices.ts`
- Test: `test/admin/devices.test.ts`

**Interfaces:**
- Consumes: `trustedDevices` (Task 1), `generateOpaqueToken`/`hashToken`.
- Produces:
  - `mintTrustedDevice(adminUserId: string, userAgent?: string): Promise<{ id: string; raw: string }>` — 30 hari.
  - `resolveTrustedDevice(raw: string | undefined): Promise<{ id: string; adminUserId: string } | null>` — hash, `expires_at > now()`, `revoked_at IS NULL`.
  - `revokeTrustedDevice(id: string)`, `revokeAllDevices(adminUserId: string)` (dipakai saat password berubah).
  - `THIRTY_DAYS_MS` diekspor untuk test.

- [ ] **Step 1: Tulis test yang gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminUsers, trustedDevices } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { mintTrustedDevice, resolveTrustedDevice, revokeTrustedDevice, revokeAllDevices } from "../../src/lib/admin/devices";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("trusted devices", () => {
  beforeEach(resetDb);
  it("mint → resolve round-trip, 30 days expiry", async () => {
    const u = await seedAdmin();
    const d = await mintTrustedDevice(u.id, "Mozilla/5.0");
    const row = await db.select().from(trustedDevices).where(eq(trustedDevices.id, d.id));
    const days = (row[0].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(await resolveTrustedDevice(d.raw)).toMatchObject({ adminUserId: u.id });
  });
  it("revoked single and revoke-all", async () => {
    const u = await seedAdmin();
    const d1 = await mintTrustedDevice(u.id);
    const d2 = await mintTrustedDevice(u.id);
    await revokeTrustedDevice(d1.id);
    expect(await resolveTrustedDevice(d1.raw)).toBeNull();
    await revokeAllDevices(u.id);
    expect(await resolveTrustedDevice(d2.raw)).toBeNull();
  });
  it("garbage/undefined resolves null", async () => {
    expect(await resolveTrustedDevice("x")).toBeNull();
    expect(await resolveTrustedDevice(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL → implementasi** (pola identik Task 3; cookie constant `ADMIN_DEVICE_COOKIE` sudah ada di sessions.ts — re-export dari devices.ts tidak perlu)

```ts
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { trustedDevices } from "../schema";
import { generateOpaqueToken, hashToken } from "../crypto";

export const THIRTY_DAYS_MS = 30 * 86_400_000;

export async function mintTrustedDevice(adminUserId: string, userAgent?: string) {
  const raw = generateOpaqueToken();
  const [row] = await db.insert(trustedDevices).values({
    adminUserId, tokenHash: hashToken(raw), userAgent: userAgent?.slice(0, 300),
    expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
  }).returning();
  return { id: row.id, raw };
}

export async function resolveTrustedDevice(raw: string | undefined) {
  if (!raw) return null;
  const rows = await db.select({ id: trustedDevices.id, adminUserId: trustedDevices.adminUserId })
    .from(trustedDevices)
    .where(and(
      eq(trustedDevices.tokenHash, hashToken(raw)),
      gt(trustedDevices.expiresAt, new Date()), isNull(trustedDevices.revokedAt),
    )).limit(1);
  return rows[0] ?? null;
}

export async function revokeTrustedDevice(id: string) {
  await db.update(trustedDevices).set({ revokedAt: new Date() }).where(eq(trustedDevices.id, id));
}
export async function revokeAllDevices(adminUserId: string) {
  await db.update(trustedDevices).set({ revokedAt: new Date() })
    .where(and(eq(trustedDevices.adminUserId, adminUserId), isNull(trustedDevices.revokedAt)));
}
```

- [ ] **Step 3: PASS → Commit** — `git commit -m "feat: revocable 30-day trusted devices"`

---

### Task 6: Audit log helper

**Files:**
- Create: `src/lib/admin/audit.ts`
- Test: `test/admin/audit.test.ts`

**Interfaces:**
- Produces: `audit(action: string, opts?: { adminUserId?: string; detail?: Record<string, unknown>; ip?: string }): Promise<void>` — insert baris; `ip` di-hash dengan `hashIp` dari ratelimit.

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminAuditLog } from "../../src/lib/schema";
import { audit } from "../../src/lib/admin/audit";
import { resetDb } from "../helpers";

describe("audit", () => {
  beforeEach(resetDb);
  it("writes action with detail and hashed ip", async () => {
    await audit("login_failed", { detail: { email: "a@gmail.com" }, ip: "1.2.3.4" });
    const rows = await db.select().from(adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("login_failed");
    expect(rows[0].detail).toEqual({ email: "a@gmail.com" });
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].ipHash).not.toContain("1.2.3.4");
  });
});
```

- [ ] **Step 2: FAIL → implementasi**

```ts
import { db } from "../db";
import { adminAuditLog } from "../schema";
import { hashIp } from "../ratelimit";

export async function audit(
  action: string,
  opts?: { adminUserId?: string; detail?: Record<string, unknown>; ip?: string },
): Promise<void> {
  await db.insert(adminAuditLog).values({
    action, adminUserId: opts?.adminUserId ?? null,
    detail: opts?.detail ?? {}, ipHash: opts?.ip ? hashIp(opts.ip) : null,
  });
}
```

- [ ] **Step 3: PASS → Commit** — `git commit -m "feat: admin audit log helper"`

---

### Task 7: Login flow (lib + routes)

**Files:**
- Create: `src/lib/admin/login.ts`, `src/pages/admin/api/login.ts`, `src/pages/admin/api/otp.ts`, `src/pages/admin/api/logout.ts`
- Test: `test/admin/login.test.ts`

**Interfaces:**
- Consumes: semua task sebelumnya + `verifyPassword` (Task 2), `consumeRateLimit`/`hashIp` (Plan 1), `revokeAllDevices` (Task 5).
- Produces:
  - `startLogin(input: { email: string; password: string; ip: string }): Promise<{ ok: true; challengeId: string } | { ok: false; reason: "invalid" | "rate-limited" }>` — rate limit 10/jam per IP dan per email; user tidak ada ATAU password salah → audit `login_failed` + `reason: "invalid"` (generik); sukses → challenge OTP dibuat + di-email, audit `password_ok`.
  - `completeLogin(input: { challengeId: string; code: string; trustDevice: boolean; ip: string; userAgent?: string }): Promise<{ ok: true; session: { raw: string }; device?: { raw: string } } | { ok: false; reason: string }>` — verify OTP → `createAdminSession` (rotasi: sesi lama admin direvoke), trusted device bila diminta, update `last_login_at`, audit `login_success`. OTP gagal → audit `otp_failed`.
  - `changePassword(adminUserId, newPassword)`: hash + simpan + `revokeAllSessions` + `revokeAllDevices` + audit `password_changed` (dipakai reset password).
  - Routes: `POST /admin/api/login` body JSON `{email, password}` → `{challengeId}`; `POST /admin/api/otp` `{challengeId, code, trustDevice}` → set cookie (`Set-Cookie` header) + `{ok}`; `POST /admin/api/logout` → revoke session cookie + hapus cookie.

- [ ] **Step 1: Test lib**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminUsers, emailOutbox } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../src/lib/admin/password";
import { startLogin, completeLogin, changePassword } from "../../src/lib/admin/login";
import { resolveSession } from "../../src/lib/admin/sessions";
import { adminAuditLog, trustedDevices } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({
    email: "kelaswfa@gmail.com", passwordHash: await hashPassword("GoodPassword123"),
  }).returning();
  return u;
}

describe("login flow", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_EMAILIT: "true" }); });

  it("startLogin wrong password → generic invalid + audit", async () => {
    const u = await seedAdmin();
    expect(await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" }))
      .toEqual({ ok: false, reason: "invalid" });
    const logs = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "login_failed"));
    expect(logs).toHaveLength(1);
  });
  it("startLogin unknown email → generic invalid (no email sent)", async () => {
    expect(await startLogin({ email: "nope@gmail.com", password: "Whatever123", ip: "1.1.1.1" }))
      .toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
  it("full login: password → otp → session; trust device optional", async () => {
    const u = await seedAdmin();
    const start = await startLogin({ email: u.email, password: "GoodPassword123", ip: "1.1.1.1" });
    expect(start.ok).toBe(true);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.emailType, "otp_admin"));
    const code = mail.text.match(/\d{6}/)![0];
    const done = await completeLogin({ challengeId: (start as any).challengeId, code, trustDevice: true, ip: "1.1.1.1" });
    expect(done.ok).toBe(true);
    const session = await resolveSession((done as any).session.raw);
    expect(session?.email).toBe(u.email);
    const devices = await db.select().from(trustedDevices);
    expect(devices).toHaveLength(1);
    expect((await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "login_success")))).toHaveLength(1);
  });
  it("rate limit: 11th attempt blocked", async () => {
    const u = await seedAdmin();
    for (let i = 0; i < 10; i++) {
      await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" });
    }
    expect(await startLogin({ email: u.email, password: "WrongPass12345", ip: "1.1.1.1" }))
      .toEqual({ ok: false, reason: "rate-limited" });
  });
  it("changePassword revokes sessions and devices", async () => {
    const u = await seedAdmin();
    const start = await startLogin({ email: u.email, password: "GoodPassword123", ip: "1.1.1.1" });
    const [mail] = await db.select().from(emailOutbox);
    const done = await completeLogin({ challengeId: (start as any).challengeId, code: mail.text.match(/\d{6}/)![0], trustDevice: true, ip: "1.1.1.1" });
    await changePassword(u.id, "NewPassword456");
    expect(await resolveSession((done as any).session.raw)).toBeNull();
    expect(await db.select().from(trustedDevices).where(eq(trustedDevices.adminUserId, u.id)))
      .toHaveLength(0);
  });
});
```

- [ ] **Step 2: FAIL → implementasi `src/lib/admin/login.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminUsers } from "../schema";
import { verifyPassword, assertPasswordStrength, hashPassword } from "./password";
import { issueOtpChallenge, verifyOtpChallenge } from "./otp";
import { createAdminSession, revokeAllSessions } from "./sessions";
import { mintTrustedDevice, revokeAllDevices } from "./devices";
import { audit } from "./audit";
import { consumeRateLimit, hashIp } from "../ratelimit";

export async function startLogin(input: { email: string; password: string; ip: string }) {
  const email = input.email.trim().toLowerCase();
  if (!(await consumeRateLimit("admin-login-ip", hashIp(input.ip), 10))
    || !(await consumeRateLimit("admin-login-email", email, 10))) {
    return { ok: false as const, reason: "rate-limited" };
  }
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  const valid = user && (await verifyPassword(user.passwordHash, input.password));
  if (!user || !valid) {
    await audit("login_failed", { adminUserId: user?.id, detail: { email }, ip: input.ip });
    return { ok: false as const, reason: "invalid" };
  }
  const challengeId = await issueOtpChallenge(user.id, user.email);
  await audit("password_ok", { adminUserId: user.id, ip: input.ip });
  return { ok: true as const, challengeId };
}

export async function completeLogin(input: {
  challengeId: string; code: string; trustDevice: boolean; ip: string; userAgent?: string;
}) {
  const otp = await verifyOtpChallenge(input.challengeId, input.code);
  if (!otp.ok) {
    await audit("otp_failed", { detail: { challengeId: input.challengeId, reason: otp.reason }, ip: input.ip });
    return { ok: false as const, reason: otp.reason };
  }
  // challenge → admin
  const { adminOtpChallenges } = await import("../schema");
  const [ch] = await db.select().from(adminOtpChallenges).where(eq(adminOtpChallenges.id, input.challengeId));
  if (!ch) return { ok: false as const, reason: "invalid" };
  await revokeAllSessions(ch.adminUserId); // rotasi sesi saat login
  const session = await createAdminSession(ch.adminUserId);
  let device: { raw: string } | undefined;
  if (input.trustDevice) {
    const d = await mintTrustedDevice(ch.adminUserId, input.userAgent);
    device = { raw: d.raw };
    await audit("device_trusted", { adminUserId: ch.adminUserId, ip: input.ip });
  }
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, ch.adminUserId));
  await audit("login_success", { adminUserId: ch.adminUserId, ip: input.ip });
  return { ok: true as const, session, device };
}

export async function changePassword(adminUserId: string, newPassword: string) {
  assertPasswordStrength(newPassword);
  await db.update(adminUsers).set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(adminUsers.id, adminUserId));
  await revokeAllSessions(adminUserId);
  await revokeAllDevices(adminUserId);
  await audit("password_changed", { adminUserId });
}
```

- [ ] **Step 3: Routes** — `src/pages/admin/api/login.ts` (parse JSON, panggil `startLogin`, return `{challengeId}` / 401 generik), `src/pages/admin/api/otp.ts` (panggil `completeLogin`, set cookie: `Set-Cookie: ${ADMIN_SESSION_COOKIE}=${session.raw}${adminCookieAttrs(secure)}` + device cookie bila ada; `secure` = `url.protocol === "https:"`), `src/pages/admin/api/logout.ts` (revoke + `Max-Age=0` cookies). Semua route `Cache-Control: no-store`.

- [ ] **Step 4: PASS → Commit** — `git commit -m "feat: password+otp login flow with rotation, trusted devices, audit"`

---

### Task 8: Guard + Admin layout + login UI

**Files:**
- Create: `src/lib/admin/guard.ts`, `src/layouts/AdminLayout.astro`, `src/pages/admin/login.astro`, `src/pages/admin/otp.astro`, `src/pages/admin/index.astro`
- Test: `test/admin/guard.test.ts`

**Interfaces:**
- Consumes: `resolveSession`, `resolveTrustedDevice`, cookie constants.
- Produces:
  - `getAdmin(cookies: { get(name): { value } | undefined }, secure: boolean): Promise<AdminUser | null>` — coba session cookie, lalu device cookie.
  - `guardPage(AstroLike): Promise<AdminUser | AstroRedirect>` — pola: `const admin = await getAdmin(...); if (!admin) return Astro.redirect("/admin/login");` (implementer menulis helper `requireAdminOrRedirect(Astro)` yang me-return `null | AdminUser` dan halaman melakukan redirect sendiri agar kompatibel type Astro).
  - `AdminLayout.astro` — sidebar Ink Forest 240px desktop (nav: Dashboard, Contacts; logout button), topbar mobile, konten `max-width: var(--admin-content)`. Props `{ title, admin?: { email } }`.
  - `/admin/login.astro` — form email+password (max-width var(--auth-content) 440px), fetch `POST /admin/api/login`, simpan challengeId, redirect `/admin/otp?c=<challengeId>`; error inline Rose Tint.
  - `/admin/otp.astro` — form 6 digit + checkbox "Percayai perangkat ini selama 30 hari" + tombol `Masuk`; fetch `POST /admin/api/otp`; sukses → `/admin`.
  - `/admin/index.astro` — redirect ke `/admin/campaigns` bila login, `/admin/login` bila tidak. (Task 10 membuat dashboard; sementara `/admin/campaigns` belum ada → arahkan ke placeholder sederhana di index yang menampilkan "Belum ada campaign" — Task 10 menggantinya.)

- [ ] **Step 1: Test guard**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { adminUsers } from "../../src/lib/schema";
import { getAdmin } from "../../src/lib/admin/guard";
import { createAdminSession } from "../../src/lib/admin/sessions";
import { mintTrustedDevice } from "../../src/lib/admin/devices";
import { resetDb } from "../helpers";

function fakeCookies(map: Record<string, string>) {
  return { get: (name: string) => (name in map ? { value: map[name] } : undefined) };
}

describe("getAdmin", () => {
  beforeEach(resetDb);
  it("session cookie resolves", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
    const s = await createAdminSession(u.id);
    const admin = await getAdmin(fakeCookies({ kado_admin_session: s.raw }));
    expect(admin?.email).toBe("a@gmail.com");
  });
  it("device cookie resolves", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
    const d = await mintTrustedDevice(u.id);
    const admin = await getAdmin(fakeCookies({ kado_admin_device: d.raw }));
    expect(admin?.id).toBe(u.id);
  });
  it("no cookies → null", async () => {
    expect(await getAdmin(fakeCookies({}))).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL → implementasi guard**

```ts
import { ADMIN_SESSION_COOKIE, ADMIN_DEVICE_COOKIE, resolveSession } from "./sessions";
import { resolveTrustedDevice } from "./devices";

export async function getAdmin(cookies: { get(name: string): { value: string } | undefined }) {
  const viaSession = await resolveSession(cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (viaSession) return viaSession;
  const viaDevice = await resolveTrustedDevice(cookies.get(ADMIN_DEVICE_COOKIE)?.value);
  if (viaDevice) {
    const { db } = await import("../db");
    const { adminUsers } = await import("../schema");
    const { eq } = await import("drizzle-orm");
    const [u] = await db.select({ id: adminUsers.id, email: adminUsers.email })
      .from(adminUsers).where(eq(adminUsers.id, viaDevice.adminUserId));
    return u ?? null;
  }
  return null;
}
```

- [ ] **Step 3: UI** — `AdminLayout.astro`:

```astro
---
import "../styles/tokens.css";
interface Props { title: string; admin?: { email: string } | null; }
const { title, admin = null } = Astro.props;
---
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" /><title>{title} — KelasWFA Admin</title>
  </head>
  <body style="margin:0;font-family:var(--font-sans);background:var(--color-canvas);color:var(--color-text);">
    {admin && (
      <aside style="position:fixed;inset:0 auto 0 0;width:240px;background:var(--color-ink);color:var(--color-canvas);padding:var(--space-6);display:flex;flex-direction:column;gap:var(--space-2);">
        <strong style="margin-bottom:var(--space-5);">KelasWFA Admin</strong>
        <a href="/admin/campaigns" style="color:var(--color-canvas);text-decoration:none;padding:10px 12px;border-radius:var(--radius-control);">Reward Campaign</a>
        <a href="/admin/contacts" style="color:var(--color-canvas);text-decoration:none;padding:10px 12px;border-radius:var(--radius-control);">Kontak</a>
        <form method="post" action="/admin/api/logout" style="margin-top:auto;">
          <button type="submit" style="background:none;border:1px solid rgba(255,252,245,.3);color:var(--color-canvas);border-radius:var(--radius-control);padding:10px 12px;min-height:44px;width:100%;">Keluar</button>
        </form>
      </aside>
    )}
    <main style={admin ? "margin-left:240px;padding:var(--space-8);max-width:calc(var(--admin-content) - 240px);" : "padding:var(--space-8);max-width:var(--auth-content);margin:0 auto;"}>
      <slot />
    </main>
  </body>
</html>
```

(Login/OTP memakai layout TANPA admin → konten center 440px. Tambahkan `<style>` responsive `@media (max-width: 1023px)` sidebar jadi topbar-drawer sederhana. `logout` route harus menerima POST form biasa → route baca cookie, revoke, redirect 303 ke /admin/login.)

- [ ] **Step 4: Build + test PASS → Commit** — `npm test -- test/admin/guard.test.ts && npm run build && git commit -m "feat: admin guard, layout, login and otp pages"`

---

### Task 9: CMS lib — CRUD campaign + slug rules + redirect + duplicate + status

**Files:**
- Create: `src/lib/admin/campaigns.ts`
- Test: `test/admin/campaigns.test.ts`

**Interfaces:**
- Consumes: schema reward tables + `campaignRedirects`; `audit`.
- Produces:
  - `validateSlug(slug: string): boolean` — `^[a-z0-9]+(-[a-z0-9]+)*$`, panjang 1–120.
  - `createCampaign(input: { slug: string }): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid-slug" | "slug-taken" }>`.
  - `updateCampaignMeta(id, patch: Partial<{ featuredImageKey; order; indexable }>)`.
  - `upsertCampaignLocale(campaignId, locale, fields: { title, description, rewardItems, metaTitle?, metaDescription? })` — upsert by (campaign, locale).
  - `changeSlug(id, newSlug, confirmed: boolean): Promise<{ok:true} | {ok:false; reason:"invalid-slug"|"slug-taken"|"confirmation-required"|"published-requires-confirmation"}>` — bila status `draft` slug boleh berubah langsung; bila `published|paused|archived` WAJIB `confirmed: true` dan menulis baris `campaignRedirects(oldSlug)`; oldSlug tidak boleh sama dengan slug campaign lain aktif.
  - `setCampaignStatus(id, action: "publish"|"pause"|"unpause"|"archive")` — transisi legal: draft→published; published↔paused; published→archived; return union error `invalid-transition`; `publish` set `published_at` sekali.
  - `duplicateCampaign(id): Promise<string>` — salin locales + assets rows + doa selections ke campaign baru slug `<slug>-copy` (bila taken, `-copy-2`, dst), status `draft`, return id baru.
  - `getCampaignById(id)` — campaign + locales + assets + doa selections (untuk editor/preview; tanpa filter status).
  - Semua mutasi penting menerima `auditOpts: { adminUserId, ip }` opsional dan menulis audit (`campaign_created`, `campaign_updated`, `slug_changed`, `campaign_published`, `campaign_paused`, `campaign_archived`, `campaign_duplicated`).

- [ ] **Step 1: Test** (pola resetDb; fixture: insert campaign via `createCampaign`)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/lib/db";
import { campaignRedirects, rewardCampaigns } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import {
  createCampaign, validateSlug, upsertCampaignLocale, changeSlug,
  setCampaignStatus, duplicateCampaign, getCampaignById,
} from "../../src/lib/admin/campaigns";
import { resetDb } from "../helpers";

describe("campaigns lib", () => {
  beforeEach(resetDb);

  it("validateSlug rules", () => {
    expect(validateSlug("starter-kit")).toBe(true);
    expect(validateSlug("starter--kit")).toBe(false);
    expect(validateSlug("Starter")).toBe(false);
    expect(validateSlug("-x")).toBe(false);
  });
  it("create rejects invalid and duplicate slug", async () => {
    expect((await createCampaign({ slug: "Bad Slug" })).ok).toBe(false);
    await createCampaign({ slug: "a" });
    expect(await createCampaign({ slug: "a" })).toEqual({ ok: false, reason: "slug-taken" });
  });
  it("locale upsert", async () => {
    const { id } = (await createCampaign({ slug: "c1" })) as { ok: true; id: string };
    await upsertCampaignLocale(id, "id", { title: "T", description: "D", rewardItems: [] });
    await upsertCampaignLocale(id, "id", { title: "T2", description: "D2", rewardItems: [] });
    const got = await getCampaignById(id);
    expect(got!.locales).toHaveLength(1);
    expect(got!.locales[0].title).toBe("T2");
  });
  it("draft slug change is free; published needs confirmation + writes redirect", async () => {
    const { id } = (await createCampaign({ slug: "draft-camp" })) as { ok: true; id: string };
    expect((await changeSlug(id, "draft-renamed", false)).ok).toBe(true);
    await setCampaignStatus(id, "publish");
    expect(await changeSlug(id, "published-renamed", false))
      .toEqual({ ok: false, reason: "published-requires-confirmation" });
    expect((await changeSlug(id, "published-renamed", true)).ok).toBe(true);
    const redirects = await db.select().from(campaignRedirects);
    expect(redirects.map((r) => r.oldSlug)).toContain("draft-renamed");
  });
  it("status transitions enforce legality", async () => {
    const { id } = (await createCampaign({ slug: "t1" })) as { ok: true; id: string };
    expect(await setCampaignStatus(id, "pause")).toMatchObject({ ok: false });
    await setCampaignStatus(id, "publish");
    expect(await setCampaignStatus(id, "pause")).toMatchObject({ ok: true });
    expect(await setCampaignStatus(id, "unpause")).toMatchObject({ ok: true });
    expect(await setCampaignStatus(id, "archive")).toMatchObject({ ok: true });
    const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    expect(camp.status).toBe("archived");
  });
  it("duplicate copies locales/assets/doa as draft with unique slug", async () => {
    const { id } = (await createCampaign({ slug: "orig" })) as { ok: true; id: string };
    await upsertCampaignLocale(id, "id", { title: "T", description: "D", rewardItems: [{ name: "A", benefit: "B" }] });
    const copyId = await duplicateCampaign(id);
    const copy = await getCampaignById(copyId);
    expect(copy!.campaign.status).toBe("draft");
    expect(copy!.locales[0].title).toBe("T");
    expect(copy!.campaign.slug).toBe("orig-copy");
  });
});
```

- [ ] **Step 2: FAIL → implementasi `src/lib/admin/campaigns.ts`** — tulis fungsi-fungsi di atas; pola drizzle sama dengan Plan 1. `createCampaign` insert dengan `onConflictDoNothing` pada slug lalu cek result untuk `slug-taken`. `duplicateCampaign` pakai transaksi `db.transaction`.

- [ ] **Step 3: PASS → Commit** — `git commit -m "feat: campaign cms lib (crud, slug rules with redirects, duplicate, status machine)"`

---

### Task 10: Dashboard + editor campaign UI

**Files:**
- Create: `src/pages/admin/campaigns/index.astro` (dashboard), `src/pages/admin/campaigns/new.astro`, `src/pages/admin/campaigns/[id].astro` (editor), `src/pages/admin/preview/[id].astro`, `src/pages/admin/api/campaigns/index.ts`, `src/pages/admin/api/campaigns/[id].ts`, `src/pages/admin/api/campaigns/[id]/status.ts`
- Modify: `src/pages/admin/index.astro` → redirect ke `/admin/campaigns`
- Test: build + manual; logika sudah tertutup test Task 9

**Interfaces:**
- Consumes: Task 9 lib, `getAdmin`/guard (Task 8), `AdminLayout`, komponen landing (RewardHero, RewardItemList, ReflectionTabs) untuk preview via `getCampaignById`.
- Produces:
  - Dashboard `/admin/campaigns`: H1 "Reward Campaign", helper text, primary action `Buat reward campaign` (DESIGN.md §6); tabel campaign (nama ID, slug, badge status ikon+teks — Draft `Draft` muted, Published `Published` Success Green, Paused `Paused` Warning Amber, Archived `Archived` muted —, tanggal publish, link edit/preview). Header tabel Linen Surface + overline, row min 56px.
  - Editor `/admin/campaigns/[id]`: section cards sesuai DESIGN.md (Detail, Konten ID, Content EN, Reward files, Doa, SEO, Publish). Required field berlabel teks `Wajib`. Save via `POST /admin/api/campaigns/[id]` (JSON: slug, featuredImageKey, indexable, locales{id,en}, redirectConfirmed?) → response `{ok}` atau `{ok:false, reason}` — reason `published-requires-confirmation` memicu modal konfirmasi lalu re-submit dengan `redirectConfirmed: true`. Status actions via `POST .../status` `{action}` dengan confirm dialog; Publish hanya aktif bila validasi minimum terpenuhi (locale id lengkap + minimal 1 asset — cek via lib `getCampaignById` di UI).
  - Preview `/admin/preview/[id]`: render landing components dengan data `getCampaignById` apa pun statusnya + banner kuning "Preview admin — status: X" (Warning Tint); halaman gated `requireAdminOrRedirect`.
  - Semua route API admin memanggil guard: cookie tidak valid → 401.

- [ ] **Step 1: API routes** — implement sesuai Interfaces (tipis: parse, guard, panggil lib, audit via lib, return JSON).

- [ ] **Step 2: Dashboard + editor UI** — tulis halaman mengikuti DESIGN.md §6. Editor field bilingual menampilkan indikator kelengkapan (badge `EN kosong — fallback ID` Gold Tint bila EN kosong). Editor JS: fetch save; error per section ditampilkan inline; tombol status memakai `confirm()` native + teks eksplisit.

- [ ] **Step 3: Preview page** — reuse komponen publik; jangan render EmailForm (claim tidak relevan di preview); tampilkan banner preview.

- [ ] **Step 4: `npm run build` + `npm test` PASS → Commit** — `git commit -m "feat: admin dashboard, campaign editor with bilingual sections, status actions, admin preview"`

---

### Task 11: Preset doa selection di editor

**Files:**
- Create: `src/pages/admin/api/campaigns/[id]/doa.ts`
- Modify: `src/pages/admin/campaigns/[id].astro` (section Doa), `src/lib/admin/campaigns.ts` (tambah `setDoaSelections`)
- Test: tambah case di `test/admin/campaigns.test.ts`

**Interfaces:**
- Produces: `setDoaSelections(campaignId: string, sel: { muslim: string; universal: string }, auditOpts?): Promise<void>` — upsert kedua variant (unique `(campaign, variant)`); menolak templateId yang bukan variant-nya (return `{ok:false, reason:"variant-mismatch"}`).
- UI: section Doa me-render daftar `doaTemplates` dikelompokkan per variant (radio, nama + potongan konten); menyimpan via API doa.

- [ ] **Step 1: Test**

```ts
// tambahan di test/admin/campaigns.test.ts
import { doaTemplates } from "../../src/lib/schema";
import { setDoaSelections } from "../../src/lib/admin/campaigns";

it("setDoaSelections upserts and validates variant", async () => {
  const { id } = (await createCampaign({ slug: "doa-c" })) as { ok: true; id: string };
  const [m] = await db.insert(doaTemplates).values({ variant: "muslim", locale: "id", name: "M", content: "c" }).returning();
  const [uni] = await db.insert(doaTemplates).values({ variant: "universal", locale: "id", name: "U", content: "c" }).returning();
  expect((await setDoaSelections(id, { muslim: m.id, universal: uni.id })).ok).toBe(true);
  expect((await setDoaSelections(id, { muslim: uni.id, universal: uni.id })).ok).toBe(false); // mismatch
  expect((await setDoaSelections(id, { muslim: m.id, universal: uni.id })).ok).toBe(true); // re-set upsert
  const got = await getCampaignById(id);
  expect(got!.doaSelections).toHaveLength(2);
});
```

- [ ] **Step 2: FAIL → implementasi + route + UI → PASS → Commit** — `git commit -m "feat: curated doa preset selection in campaign editor"`

---

### Task 12: Upload asset privat + management

**Files:**
- Create: `src/lib/admin/assets.ts`, `src/pages/admin/api/campaigns/[id]/assets.ts`, `src/pages/admin/api/assets/[id].ts`
- Modify: `src/pages/admin/campaigns/[id].astro` (section Reward files: dropzone + list), `src/lib/storage.ts` (tambah `putObject(key, body, contentType)` via aws4fetch PUT + `presignUploadUrl` bila perlu)
- Test: `test/admin/assets.test.ts`

**Interfaces:**
- Consumes: `rewardAssets` schema; R2 env (Task 11 Plan 1); `audit`.
- Produces:
  - `validateUpload(input: { filename: string; mimeType: string; sizeBytes: number }): { ok: true } | { ok: false; reason: "mime-not-allowed" | "too-large" }` — reuse `ALLOWED_MIME` + `MAX_UPLOAD_BYTES` dari `src/lib/storage.ts`; ekstensi harus cocok MIME (peta: pdf→application/pdf, zip→application/zip, docx/xlsx/pptx→OOXML mime, png/jpg/jpeg/webp→image/*).
  - `storeAsset(input: { campaignId: string; filename: string; mimeType: string; body: ArrayBuffer; nameId: string; sortOrder: number }, auditOpts?): Promise<{ ok: true; id: string; storageKey: string } | { ok: false; reason }>` — checksum SHA-256, key `rewards/<campaignId>/<uuid>-<sanitized-filename>`, PUT R2 privat, insert row. MOCK mode: env `MOCK_R2=true` skip PUT (untuk test CI tanpa kredensial).
  - `removeAsset(assetId: string, auditOpts?)` — hapus ROW saja (object R2 tidak dihapus otomatis — PRD 7.2: asset lama tidak dihapus otomatis), return `{ok}`.
- UI: dropzone Linen Surface dashed (DESIGN.md §6 Upload asset), tampilkan batas 100 MB sebelum upload, upload via XHR dengan progress bar + persen, list file selesai (nama, tipe, ukuran, urutan ↑↓, tombol Hapus dengan konfirmasi kedua).

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { validateUpload, storeAsset, removeAsset } from "../../src/lib/admin/assets";
import { db } from "../../src/lib/db";
import { rewardAssets } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { createCampaign } from "../../src/lib/admin/campaigns";
import { resetDb, setEnv } from "../helpers";

describe("asset upload", () => {
  beforeEach(async () => { await resetDb(); setEnv({ MOCK_R2: "true" }); });

  it("validates mime and size", () => {
    expect(validateUpload({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1024 }).ok).toBe(true);
    expect(validateUpload({ filename: "a.exe", mimeType: "application/x-msdownload", sizeBytes: 1 }))
      .toEqual({ ok: false, reason: "mime-not-allowed" });
    expect(validateUpload({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 101 * 1024 * 1024 }))
      .toEqual({ ok: false, reason: "too-large" });
    expect(validateUpload({ filename: "b.png", mimeType: "application/pdf", sizeBytes: 1 }))
      .toEqual({ ok: false, reason: "mime-not-allowed" }); // ekstensi vs mime mismatch
  });
  it("storeAsset writes row with checksum and key, removeAsset deletes row", async () => {
    const { id: campaignId } = (await createCampaign({ slug: "assets-c" })) as { ok: true; id: string };
    const res = await storeAsset({
      campaignId, filename: "guide.pdf", mimeType: "application/pdf",
      body: new TextEncoder().encode("hello pdf").buffer as ArrayBuffer,
      nameId: "Panduan", sortOrder: 0,
    }, { adminUserId: null, ip: "1.1.1.1" });
    expect(res.ok).toBe(true);
    const key = (res as any).storageKey as string;
    expect(key.startsWith(`rewards/${campaignId}/`)).toBe(true);
    const [row] = await db.select().from(rewardAssets).where(eq(rewardAssets.campaignId, campaignId));
    expect(row.sizeBytes).toBe(9);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    await removeAsset(row.id);
    expect(await db.select().from(rewardAssets).where(eq(rewardAssets.id, row.id))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: FAIL → implementasi lib + `putObject` di storage.ts**

```ts
// src/lib/storage.ts — tambahan
export async function putObject(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
  if (env("MOCK_R2", "false") === "true") return;
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${env("R2_BUCKET")}/${key}`;
  const signer = new AwsV4Signer({ url, accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), method: "PUT" });
  const signed = await signer.sign();
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
```

- [ ] **Step 3: Route multipart + UI dropzone** — route baca `request.formData()`, validasi, `storeAsset`, return `{ok, asset}`; UI XHR `xhr.upload.onprogress` → progress bar horizontal + persen (DESIGN.md: bukan spinner).

- [ ] **Step 4: PASS + build → Commit** — `git commit -m "feat: private asset upload with validation, progress, and management"`

---

### Task 13: Allowlist management

**Files:**
- Create: `src/lib/admin/domains.ts`, `src/pages/admin/api/domains.ts`, `src/pages/admin/domains.astro` (atau section di dashboard — pilih halaman sendiri, tambah nav "Domain Email")
- Modify: `AdminLayout.astro` nav
- Test: `test/admin/domains.test.ts`

**Interfaces:**
- Produces: `addDomain(domain, auditOpts)` (validasi domain: lowercase, ada titik, tanpa `@`; `slug-taken` analog `already-exists`), `setDomainActive(domain, active, auditOpts)`, `removeDomain(domain, auditOpts)`; list via `db.select().from(emailDomains)` order domain.
- UI: tabel domain + input tambah + toggle aktif/nonaktif + hapus (konfirmasi); audit `domain_added|domain_toggled|domain_removed`.

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { addDomain, setDomainActive, removeDomain } from "../../src/lib/admin/domains";
import { db } from "../../src/lib/db";
import { emailDomains } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../helpers";

describe("domain management", () => {
  beforeEach(resetDb);
  it("add validates and dedupes", async () => {
    expect((await addDomain("Sub.Example.COM")).ok).toBe(true); // dinormalisasi lowercase
    expect(await addDomain("sub.example.com")).toEqual({ ok: false, reason: "already-exists" });
    expect(await addDomain("nodot")).toEqual({ ok: false, reason: "invalid-domain" });
    expect(await addDomain("has@at.com")).toEqual({ ok: false, reason: "invalid-domain" });
  });
  it("toggle and remove", async () => {
    await addDomain("example.com");
    await setDomainActive("example.com", false);
    const [row] = await db.select().from(emailDomains).where(eq(emailDomains.domain, "example.com"));
    expect(row.active).toBe(false);
    await removeDomain("example.com");
    expect(await db.select().from(emailDomains).where(eq(emailDomains.domain, "example.com"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: FAIL → implementasi + route + UI → PASS → Commit** — `git commit -m "feat: email domain allowlist management with audit"`

---

### Task 14: Kontak — list, detail, CSV export, anonimisasi

**Files:**
- Create: `src/lib/admin/contacts.ts`, `src/pages/admin/contacts/index.astro`, `src/pages/admin/contacts/[id].astro`, `src/pages/admin/api/contacts/export.ts`, `src/pages/admin/api/contacts/[id]/anonymize.ts`
- Modify: `AdminLayout.astro` nav (link Kontak sudah ada)
- Test: `test/admin/contacts.test.ts`

**Interfaces:**
- Consumes: schema contact/marketing/claims/campaigns; `audit`.
- Produces:
  - `listContacts(filter: { status?: "pending"|"confirmed"|"unsubscribed"; campaignId?: string; search?: string; limit: number; offset: number }): Promise<{ rows: ContactRow[]; total: number }>` — ContactRow: contact + marketing status + jumlah claim + slug claim (distinct, `;`-join). `search` = ILIKE pada email. `unsubscribed` = marketing_subscriptions.status = 'unsubscribed'.
  - `getContactDetail(contactId)`: contact + subscription + consentEvents + claims (dengan campaign slug + status + tanggal).
  - `buildContactsCsv(filter): Promise<string>` — header `email,locale,confirmation_status,marketing_status,subscribed_at,unsubscribed_at,created_at,reward_claims`; TIDAK ada token/ip-hash/kolom rahasia; audit `contacts_exported` dengan filter.
  - `anonymizeContact(contactId, auditOpts)`: email → `deleted-<contactId>@invalid.local`, locale `id`, hapus access_tokens milik claims contact ini; riwayat claim + consent tetap (audit `contact_anonymized`).
- UI: tabel kontak (row 56px, badge Confirmed/Unsubscribed/Pending ikon+teks, filter chip aktif yang bisa dihapus, search input), tombol `Export CSV` (download), detail per contact dengan riwayat claim + tombol `Anonimkan` (destructive, konfirmasi kedua, Rose Error).

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { listContacts, buildContactsCsv, anonymizeContact, getContactDetail } from "../../src/lib/admin/contacts";
import { db } from "../../src/lib/db";
import { contacts, marketingSubscriptions, rewardCampaigns } from "../../src/lib/schema";
import { eq } from "drizzle-orm";
import { upsertClaim } from "../../src/lib/access";
import { resetDb } from "../helpers";

describe("contacts admin", () => {
  beforeEach(resetDb);
  async function seed() {
    const [c1] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    const [c2] = await db.insert(contacts).values({ emailNormalized: "sari@yahoo.com" }).returning();
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "c1", status: "published" }).returning();
    await upsertClaim(c1.id, camp.id);
    await db.insert(marketingSubscriptions).values({ contactId: c1.id, status: "active", subscribedAt: new Date() });
    return { c1, c2, camp };
  }
  it("lists with claims and filters", async () => {
    const { c1, camp } = await seed();
    const all = await listContacts({ limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const confirmed = await listContacts({ status: "confirmed", limit: 10, offset: 0 });
    expect(confirmed.rows.map((r) => r.emailNormalized)).toEqual(["budi@gmail.com"]);
    const byCampaign = await listContacts({ campaignId: camp.id, limit: 10, offset: 0 });
    expect(byCampaign.rows.map((r) => r.id)).toContain(c1.id);
    const searched = await listContacts({ search: "sari", limit: 10, offset: 0 });
    expect(searched.rows).toHaveLength(1);
  });
  it("csv has required columns and no secrets, and audits export", async () => {
    const { c1 } = await seed();
    const csv = await buildContactsCsv({ limit: 100, offset: 0 }, { adminUserId: null, ip: "1.1.1.1" });
    expect(csv.split("\n")[0]).toBe("email,locale,confirmation_status,marketing_status,subscribed_at,unsubscribed_at,created_at,reward_claims");
    expect(csv).toContain("budi@gmail.com");
    expect(csv).not.toContain("token");
    const { adminAuditLog } = await import("../../src/lib/schema");
    expect((await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "contacts_exported")))).toHaveLength(1);
  });
  it("anonymize masks email and deletes tokens", async () => {
    const { c1 } = await seed();
    await anonymizeContact(c1.id, { adminUserId: null, ip: "1.1.1.1" });
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c1.id));
    expect(row.emailNormalized).toBe(`deleted-${c1.id}@invalid.local`);
  });
});
```

- [ ] **Step 2: FAIL → implementasi lib** — CSV escaping: nilai yang mengandung koma/tanda kutip dibungkus `"..."` dengan kutip ganda ter-escape.

- [ ] **Step 3: Routes + UI** — export route set header `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="contacts-YYYY-MM-DD.csv"`. UI tabel per DESIGN.md §6 (badge `Confirmed` Success, `Pending` Warning, `Unsubscribed` Danger, masing-masing ikon + teks).

- [ ] **Step 4: PASS + build → Commit** — `git commit -m "feat: contacts list, detail, csv export with audit, and anonymization"`

---

### Task 15: Slug redirect publik + reset password + deferred fixes Plan 1

**Files:**
- Modify: `src/pages/r/[slug].astro`, `src/pages/en/r/[slug].astro` (cek redirect), `src/lib/subscribe.ts` (fix race), `src/lib/access.ts` (transaction), `src/lib/templates.ts` (escape), `src/components/ReflectionTabs.astro` (indikator 2px), `src/pages/akses/[token].astro` + `en/akses/[token].astro` (humanSize), `src/pages/r/[slug].astro` + `en/r/[slug].astro` (lang fallback policy)
- Create: `src/pages/404.astro`, `src/pages/admin/api/password.ts`, `src/pages/admin/reset.astro`
- Test: `test/admin/redirects.test.ts`, update `test/subscribe.test.ts`, `test/access.test.ts`, `test/templates.test.ts`

**Interfaces:**
- Produces:
  - `resolveSlugRedirect(slug: string): Promise<string | null>` — lookup `campaignRedirects` by oldSlug → new slug campaign, else null. Halaman publik: bila slug tak ditemukan sebagai campaign, cek redirect → `Astro.redirect(target, 301)`.
  - `requestPasswordReset(email, ip)`: hanya email admin yang diizinkan; buat token reset (reuse pattern: tabel? GUNAKAN `accessTokens` TIDAK cocok — buat helper: token disimpan hashed di `adminOtpChallenges`? TIDAK. Keputusan: reset password via OTP yang sudah ada — halaman reset memanggil `startLogin` tanpa password? Sederhanakan sesuai PRD: "Reset password hanya dikirim ke alamat Gmail admin" → `requestPasswordReset` = verifikasi email == ADMIN_EMAIL → issue OTP challenge + email dengan instruksi; `completePasswordReset(challengeId, code, newPassword)` = verifyOtpChallenge → changePassword. Tidak ada tabel baru.
  - Deferred fixes (semua harus ada testnya):
    1. `subscribe.ts`: upsert contact atomik — `insert().onConflictDoNothing().returning()`; bila kosong, select ulang (menghilangkan race 500).
    2. `access.ts`: `confirmContactByToken` dibungkus `db.transaction` (consume token + update contact + claim + subscription + consent dalam satu transaksi).
    3. `templates.ts`: `escapeHtml` untuk `rewardTitle` di subject/html/text (URL dibangun dari token opaque, aman; escape `&<>"'`).
    4. `404.astro` publik: halaman ramah token design (Ivory, kartu putih, CTA kembali ke beranda); halaman `r/[slug]` mengganti `Astro.redirect("/404")` dengan render 404 langsung (`new Response` via halamanNotFound atau redirect 302 ke `/404` — pilih render inline agar status 404 benar: gunakan `Astro.rewrite("/404")` bila tersedia di Astro 5, else `return new Response(html404, { status: 404 })`).
    5. `ReflectionTabs.astro`: tab aktif mendapat indikator bawah 2px Forest Action (border-bottom atau ::after).
    6. `humanSize` dipindah ke `src/lib/admin/format.ts` (export `humanSize(bytes: number): string`), kedua halaman akses meng-import; tidak ada duplikasi.
    7. Lang fallback policy: `html lang` mengikuti LOCALE KONTEN EFEKTIF — pada `/en/r/<slug>` dengan EN kosong, render `lang="id"` (konten memang ID) + `<link rel="alternate" hreflang="id" href="/r/<slug>">` + `hreflang="en"` (menunjuk /en/...). Update e2e Task 15 Plan 1 yang men-assert `lang="en"` pada fallback → ganti assertion: `lang="id"` + hreflang en ada. (Ruling: PRD meminta lang "benar pada halaman dan konten yang relevan"; konten ID berarti lang id.)
    8. Test wrong-campaign subscribe (token campaign A disubmit ke campaign B → `bad-request`) di `test/subscribe.test.ts`.

- [ ] **Step 1: Tulis semua test di atas (FAIL)** — redirects: buat campaign `a` → changeSlug ke `b` (confirmed) → `resolveSlugRedirect("a") === "b"`; race fix: tidak bisa dites race-nya, tapi test existing subscribe tetap hijau; transaction: test existing access tetap hijau; escape: `rewardAccessEmail("id", url, '<script>x</script> Sticker')` html TIDAK memuat `<script>`; lang: test render komponen dihapus dari unit, cukup e2e update.

- [ ] **Step 2: Implementasikan satu per satu, jalankan test setiap item, PASS semua** — `npm test && npm run build`

- [ ] **Step 3: Update e2e fallback assertion** (`test/e2e/funnel.spec.ts`) sesuai item 7; `npx playwright test` PASS.

- [ ] **Step 4: Commit** — `git commit -m "feat: slug redirects, otp-based password reset, and plan-1 deferred hardening"`

---

### Task 16: Playwright smoke admin end-to-end

**Files:**
- Create: `test/admin/e2e/admin.spec.ts`
- Modify: `playwright.config.ts` (webServer env tambah `ADMIN_PASSWORD`, `ADMIN_EMAIL`), `scripts/seed.ts` (panggil bootstrap admin bila `ADMIN_PASSWORD` env ada — reuse logika Task 2 via import fungsi `ensureAdmin()` yang diekspor dari `scripts/bootstrap-admin.ts` → pindahkan logika inti ke `src/lib/admin/bootstrap.ts` agar bisa diimport)

**Interfaces:**
- Produces: `ensureAdmin(): Promise<{ created: boolean; email: string }>` di `src/lib/admin/bootstrap.ts` (dipakai script + seed + e2e).
- E2E flow (satu test panjang, MO EMAILIT tetap true):
  1. Ke `/admin` → redirect `/admin/login`.
  2. Login email+password (`ADMIN_EMAIL`/`ADMIN_PASSWORD` env) → OTP page.
  3. Baca kode OTP: test membuka koneksi postgres langsung (`import postgres from "postgres"`) ke `DATABASE_URL`, query outbox `email_type='otp_admin'` terbaru, regex `\d{6}` dari kolom text.
  4. Submit OTP + trust device → dashboard.
  5. Buat campaign baru via UI (klik `Buat reward campaign`, isi slug + title ID, save) → editor terbuka.
  6. Publish → badge Published muncul.
  7. Buka `/r/<slug>` publik → heading terlihat.

- [ ] **Step 1: Tulis spec** — gunakan pola `page.goto/fill/click/expect` dari `test/e2e/funnel.spec.ts`; password dari `process.env.ADMIN_PASSWORD` (di-set playwright webServer env, nilai test `AdminPassword123`).

- [ ] **Step 2: Jalankan** — `npx playwright test` → semua PASS (funnel lama + admin baru).

- [ ] **Step 3: Commit** — `git commit -m "test: admin e2e login-otp-cms-publish flow"`

---

## Setelah Plan 2 selesai

- **Plan 3 — Broadcast & Delivery**: email campaign editor + segmentasi ANY/ALL + snapshot, queue prioritas + limit per menit/jam + worker, unsubscribe satu klik + suppression + re-subscribe consent, click tracking redirect aman, webhook Emailit (signature + idempoten), EMAIL_DELIVERY + reporting, delivery status di view contact, hardening launch (trusted-proxy IP, CSP/HSTS, backup test, alerting), plus deferred minors tersisa (SKIP LOCKED worker, TEST_TIMER_MS guard, referrer/cache hardening lanjutan).

---

## Addendum: Penyederhanaan Flow Campaign & Modul CMS Preset Doa (September 2026)

### 1. Instant Campaign Draft & Auto-slug
- **Masalah:** Alur pembuatan campaign sebelumnya mengharuskan admin mengisi slug di `/admin/campaigns/new`, lalu membuka halaman editor `/admin/campaigns/[id]` yang di dalamnya kembali menampilkan input slug.
- **Penyelesaian:**
  - Route `/admin/campaigns/new` kini langsung menginisiasi baris campaign baru berstatus `draft` dengan auto-slug acak unik (`draft-<nanoid>`), lalu melakukan 302 redirect langsung ke form editor lengkap `/admin/campaigns/[id]`.
  - Admin dapat langsung mengisi data lengkap (judul, deskripsi, upload file reward, preset doa) dan menyesuaikan slug kapan saja di satu tempat sebelum mempublikasikan campaign.

### 2. Visual Image Upload & Preview Card untuk Featured Image
- **Masalah:** Field featured image sebelumnya hanya berupa text input yang membingungkan bagi admin (apakah harus upload manual ke R2 lalu paste URL).
- **Penyelesaian:**
  - Mengintegrasikan dropzone visual dengan drag-and-drop & file picker (mendukung PNG, JPG, JPEG, WebP hingga 5 MB).
  - Mengunggah file secara asynchronous ke R2 melalui endpoint `/admin/api/campaigns/[id]/image`.
  - Menampilkan live thumbnail card dengan tombol ganti gambar dan hapus gambar.
  - State transisi dropzone vs preview card diatur secara konsisten dengan styling token aplikasi dan `display: none !important;` untuk menghindari konflik CSS `display: flex`.

### 3. Modul CMS Manajemen Preset Doa (`/admin/doa`)
- **Masalah:** Database produksi tidak memuat preset doa secara default (karena script dev `seed.ts` di-skip pada env produksi) dan tidak ada UI bagi admin untuk menginput atau memilih preset doa.
- **Penyelesaian:**
  - **Core Lib (`src/lib/admin/doa.ts`):**
    - `DEFAULT_DOA_TEMPLATES`: Template bawaan (Doa Muslim v1 dan Harapan Baik v1, bilingual ID/EN).
    - `listGroupedDoaTemplates()`: Mengelompokkan baris `doa_template` berdasarkan `(variant, name)`.
    - `ensureDefaultDoaTemplates()`: Seeding idempoten jika tabel kosong.
    - `upsertDoaTemplate()`: Tambah/edit preset doa ID dan EN.
    - `deleteDoaTemplateGroup()`: Hapus preset doa dengan validasi integritas (mencegah penghapusan bila template sedang dipilih di `doa_selections`).
  - **API Endpoints:**
    - `GET /admin/api/doa`: List semua grouped preset doa.
    - `POST /admin/api/doa`: Upsert preset doa (ID wajib, EN opsional).
    - `DELETE /admin/api/doa`: Hapus preset doa.
    - `POST /admin/api/doa/seed`: Trigger quick-seed template bawaan.
  - **Halaman Admin UI (`/admin/doa.astro`):**
    - Didaftarkan pada menu navigasi `src/layouts/AdminLayout.astro`.
    - Tampilan kartu terpisah untuk Doa Muslim dan Harapan Baik (Universal).
    - Modal dialog untuk Tambah / Edit preset dengan validasi form.
    - Tombol Quick-Seed preset bawaan jika database kosong.
  - **Integrasi di Campaign Editor (`src/pages/admin/campaigns/[id].astro`):**
    - Tautan langsung "Kelola Preset ↗" di header section Doa.
    - Kotak aksi dengan tombol "Muat Preset Doa Bawaan" jika belum ada template sama sekali di DB, sehingga admin dapat memuat template langsung dari halaman editor tanpa reload manual.
  - **Audit Logging:** Setiap mutasi preset doa dicatat ke `admin_audit_log` (`doa_templates_seeded`, `doa_template_saved`, `doa_template_deleted`).

