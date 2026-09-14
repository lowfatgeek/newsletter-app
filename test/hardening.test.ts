import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { adminUsers, contacts, emailOutbox, trustedDevices } from "../src/lib/schema";
import { hashPassword } from "../src/lib/admin/password";
import { startLogin } from "../src/lib/admin/login";
import { mintTrustedDevice, resolveTrustedDevice } from "../src/lib/admin/devices";
import { ADMIN_DEVICE_COOKIE } from "../src/lib/admin/sessions";
import { csvEscape, listContacts } from "../src/lib/admin/contacts";
import { clientIp } from "../src/lib/ip";
import { onRequest, applySecurityHeaders, SECURITY_CSP } from "../src/middleware";
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
    const out = await onRequest({} as never, (async () => new Response("ok")) as never);
    expect(out.headers.get("Content-Security-Policy")).toBe(SECURITY_CSP);
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(out.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does NOT override an existing CSP (preview route frame-ancestors 'self')", async () => {
    const preview = new Response("ok", { headers: { "Content-Security-Policy": "frame-ancestors 'self'" } });
    const out = await onRequest({} as never, (async () => preview) as never);
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

  it("logout revokes the trusted device token from the cookie (by hash)", async () => {
    const [admin] = await db.insert(adminUsers).values({
      email: "kelaswfa@gmail.com",
      passwordHash: await hashPassword("GoodPassword123"),
    }).returning();
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
