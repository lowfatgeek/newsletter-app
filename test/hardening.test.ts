import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { csvEscape, listContacts } from "../src/lib/admin/contacts";
import { mintTrustedDevice, resolveTrustedDevice } from "../src/lib/admin/devices";
import { verifyAdminOrigin } from "../src/lib/admin/guard";
import { startLogin } from "../src/lib/admin/login";
import { hashPassword } from "../src/lib/admin/password";
import { ADMIN_DEVICE_COOKIE } from "../src/lib/admin/sessions";
import { cronAuthorized } from "../src/lib/cron-auth";
import { db } from "../src/lib/db";
import { clientIp } from "../src/lib/ip";
import { adminUsers, contacts, emailOutbox, trustedDevices } from "../src/lib/schema";
import { applySecurityHeaders, cspWithInlineScriptHashes, onRequest, SECURITY_CSP } from "../src/middleware";
import { POST as logoutPOST } from "../src/pages/admin/api/logout";
import { resetDb, setEnv } from "./helpers";

describe("hardening: csvEscape formula injection", () => {
  it("prefixes cells starting with = + - @ with a single quote", () => {
    expect(csvEscape("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvEscape("+1234567890")).toBe("'+1234567890");
    expect(csvEscape("-2+3")).toBe("'-2+3");
    expect(csvEscape("@import")).toBe("'@import");
  });

  it("leaves normal cells untouched and still quotes CSV-special chars", () => {
    expect(csvEscape("normal@example.com")).toBe("normal@example.com");
    expect(csvEscape('a"b,c')).toBe('"a""b,c"');
    // prefix guard berjalan sebelum quoting
    expect(csvEscape('=a"b')).toBe('"\'=a""b"');
  });
});

describe("hardening: clientIp trusted proxy parsing", () => {
  it("takes the LAST hop of X-Forwarded-For (single trusted proxy)", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" } });
    expect(clientIp(req)).toBe("9.10.11.12");
  });

  it("falls back to x-real-ip, then 0.0.0.0", () => {
    expect(clientIp(new Request("http://x/", { headers: { "x-real-ip": "203.0.113.5" } }))).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x/"))).toBe("0.0.0.0");
  });
});

describe("hardening: security headers middleware", () => {
  it("sets CSP/nosniff/referrer on every response (no HSTS in non-prod)", async () => {
    const out = (await onRequest({} as never, (async () => new Response("ok")) as never)) as Response;
    expect(out.headers.get("Content-Security-Policy")).toBe(SECURITY_CSP);
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(out.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does NOT override an existing CSP (preview route frame-ancestors 'self')", async () => {
    const preview = new Response("ok", { headers: { "Content-Security-Policy": "frame-ancestors 'self'" } });
    const out = (await onRequest({} as never, (async () => preview) as never)) as Response;
    expect(out.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'self'");
    // header lain tetap ditambahkan
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("adds HSTS only in production", () => {
    const prod = new Headers();
    applySecurityHeaders(prod, true);
    expect(prod.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });
});

describe("hardening: CSP inline-script hashing (astro build meng-inline <script>)", () => {
  const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

  it("no inline scripts → CSP unchanged", () => {
    expect(cspWithInlineScriptHashes(SECURITY_CSP, "<html><body>halo</body></html>")).toBe(SECURITY_CSP);
  });

  it("external src script is not hashed", () => {
    const html = '<script src="/_astro/x.js"></script>';
    expect(cspWithInlineScriptHashes(SECURITY_CSP, html)).toBe(SECURITY_CSP);
  });

  it("inline script body is added as sha256 hash to script-src", () => {
    const body = "console.log('hai');";
    const out = cspWithInlineScriptHashes(SECURITY_CSP, `<script>${body}</script>`);
    expect(out).toContain(`'sha256-${sha256(body)}'`);
    expect(out).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    // Direktif lain tidak berubah; 'unsafe-inline' tidak pernah ditambahkan ke script-src.
    expect(out).toContain("frame-ancestors 'none'");
    expect(out).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("script type=module is hashed; type=application/json is skipped", () => {
    const mod = "import x from 'y';";
    const json = '{"a":1}';
    const out = cspWithInlineScriptHashes(
      SECURITY_CSP,
      `<script type="module">${mod}</script><script type="application/json">${json}</script>`,
    );
    expect(out).toContain(`'sha256-${sha256(mod)}'`);
    expect(out).not.toContain(`'sha256-${sha256(json)}'`);
  });

  it("tag with nonce or src attr is not hashable (skipped)", () => {
    const body = "alert(1)";
    expect(cspWithInlineScriptHashes(SECURITY_CSP, `<script nonce="abc">${body}</script>`)).not.toContain(sha256(body));
    expect(cspWithInlineScriptHashes(SECURITY_CSP, `<script src="/a.js">${body}</script>`)).toBe(SECURITY_CSP);
  });

  it("onRequest on an HTML page response extends the CSP header with the inline hash", async () => {
    const body = "document.getElementById('x');";
    const html = `<html><head><script>${body}</script></head><body>ok</body></html>`;
    const page = new Response(html, {
      headers: { "Content-Security-Policy": SECURITY_CSP, "content-type": "text/html; charset=utf-8" },
    });
    const out = (await onRequest({} as never, (async () => page) as never)) as Response;
    expect(out.headers.get("Content-Security-Policy")).toContain(`'sha256-${sha256(body)}'`);
    // Body tetap utuh setelah dibuffer ulang.
    expect(await out.clone().text()).toBe(html);
  });

  it("onRequest leaves non-HTML responses unbuffered and CSP untouched", async () => {
    const api = new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    const out = (await onRequest({} as never, (async () => api) as never)) as Response;
    expect(out.headers.get("Content-Security-Policy")).toBe(SECURITY_CSP);
  });
});

describe("hardening: cron auth accepts x-cron-secret and Vercel Bearer", () => {
  beforeEach(() => setEnv({ CRON_SECRET: "test-cron-secret" }));

  it("accepts x-cron-secret", () => {
    const req = new Request("http://x/api/cron/outbox", { headers: { "x-cron-secret": "test-cron-secret" } });
    expect(cronAuthorized(req)).toBe(true);
  });

  it("accepts Authorization: Bearer", () => {
    const req = new Request("http://x/api/cron/outbox", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(cronAuthorized(req)).toBe(true);
  });

  it("rejects missing/wrong secret", () => {
    expect(cronAuthorized(new Request("http://x/api/cron/outbox"))).toBe(false);
    expect(
      cronAuthorized(
        new Request("http://x/api/cron/outbox", {
          headers: { "x-cron-secret": "wrong", authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects Bearer with a different-length secret without leaking via throw (task 2.3)", () => {
    // Sebelum fix, secret beda panjang tetap return false; setelah fix,
    // hash-then-compare memberi hasil sama TANPA perbandingan string langsung.
    expect(
      cronAuthorized(
        new Request("http://x/api/cron/outbox", {
          headers: { authorization: "Bearer test-cron-secret-EXTREME-LONG" },
        }),
      ),
    ).toBe(false);
    expect(
      cronAuthorized(
        new Request("http://x/api/cron/outbox", {
          headers: { authorization: "Bearer short" },
        }),
      ),
    ).toBe(false);
  });
});

describe("hardening: admin mutation same-origin guard (task 2.2)", () => {
  const same = (url = "https://kado.test/admin/api/domains") =>
    new Request(url, { method: "POST", headers: { origin: new URL(url).origin } });

  it("accepts same-origin and origin-less (server-to-server) requests", () => {
    expect(verifyAdminOrigin(same())).toBe(true);
    expect(verifyAdminOrigin(new Request("https://kado.test/admin/api/domains", { method: "POST" }))).toBe(true);
  });

  it("accepts request whose Origin matches PUBLIC_SITE_URL behind a proxy", () => {
    setEnv({ PUBLIC_SITE_URL: "https://kado.test" });
    const req = new Request("http://127.0.0.1:4321/admin/api/domains", {
      method: "POST",
      headers: { origin: "https://kado.test" },
    });
    expect(verifyAdminOrigin(req)).toBe(true);
  });

  it("rejects a foreign origin", () => {
    const req = new Request("https://kado.test/admin/api/domains", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    });
    expect(verifyAdminOrigin(req)).toBe(false);
  });
});

describe("hardening: third-party fetch timeout contract (task 2.1)", () => {
  const srcOf = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("emailit provider call passes an AbortSignal timeout", () => {
    expect(srcOf("../src/lib/emailit.ts")).toMatch(/signal:\s*AbortSignal\.timeout\([\d_]+\)/);
  });

  it("R2 storage PUT passes an AbortSignal timeout", () => {
    expect(srcOf("../src/lib/storage.ts")).toMatch(/signal:\s*AbortSignal\.timeout\([\d_]+\)/);
  });
});

describe("hardening: db-backed behaviors", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_EMAILIT: "true" });
  });

  it("ILIKE search escapes %, _ and backslash (literal match, not wildcard)", async () => {
    await db.insert(contacts).values([
      { emailNormalized: "plain@example.com", locale: "id", confirmationStatus: "confirmed" },
      { emailNormalized: "a%b@example.com", locale: "id", confirmationStatus: "confirmed" },
      { emailNormalized: "a_b@example.com", locale: "id", confirmationStatus: "confirmed" },
    ]);
    const base = { limit: 50, offset: 0 } as const;

    // Tanpa escape, "%" akan match SEMUA baris. Dengan escape → hanya literal.
    const pct = await listContacts({ ...base, search: "%" });
    expect(pct.total).toBe(1);
    expect(pct.rows[0].emailNormalized).toBe("a%b@example.com");

    const underscore = await listContacts({ ...base, search: "_" });
    expect(underscore.total).toBe(1);
    expect(underscore.rows[0].emailNormalized).toBe("a_b@example.com");

    const plain = await listContacts({ ...base, search: "plain" });
    expect(plain.total).toBe(1);
    expect(plain.rows[0].emailNormalized).toBe("plain@example.com");
  });

  it("startLogin with unknown email stays generic invalid and sends nothing", async () => {
    const result = await startLogin({ email: "nobody@example.com", password: "Whatever12345", ip: "1.1.1.1" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("startLogin rejects a non-ADMIN_EMAIL account even with correct password (task 2.9)", async () => {
    setEnv({ ADMIN_EMAIL: "kelaswfa@gmail.com" });
    await db.insert(adminUsers).values({
      email: "ghost-admin@gmail.com",
      passwordHash: await hashPassword("GoodPassword123"),
    });
    const result = await startLogin({ email: "ghost-admin@gmail.com", password: "GoodPassword123", ip: "1.1.1.1" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("logout revokes the trusted device token from the cookie (by hash)", async () => {
    const [admin] = await db
      .insert(adminUsers)
      .values({
        email: "kelaswfa@gmail.com",
        passwordHash: await hashPassword("GoodPassword123"),
      })
      .returning();
    const device = await mintTrustedDevice(admin.id, "vitest");
    expect(await resolveTrustedDevice(device.raw)).not.toBeNull();

    const req = new Request("http://localhost/admin/api/logout", {
      method: "POST",
      headers: { cookie: `${ADMIN_DEVICE_COOKIE}=${device.raw}` },
    });
    const res = await logoutPOST({ request: req } as never);
    expect(res.status).toBe(303);

    expect(await resolveTrustedDevice(device.raw)).toBeNull();
    const [row] = await db.select().from(trustedDevices).where(eq(trustedDevices.id, device.id));
    expect(row.revokedAt).not.toBeNull();
  });
});
