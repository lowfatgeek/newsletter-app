import { describe, it, expect, beforeEach } from "vitest";
import { addDomain, setDomainActive, removeDomain } from "../../src/lib/admin/domains";
import { db } from "../../src/lib/db";
import { adminAuditLog, emailDomains } from "../../src/lib/schema";
import { eq, asc } from "drizzle-orm";
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

  it("rejects domains with spaces or empty input", async () => {
    expect(await addDomain("has space.com")).toEqual({ ok: false, reason: "invalid-domain" });
    expect(await addDomain("  ")).toEqual({ ok: false, reason: "invalid-domain" });
  });

  it("writes audit for add/toggle/remove", async () => {
    await addDomain("example.com", { adminUserId: null, ip: "1.1.1.1" });
    await setDomainActive("example.com", false, { adminUserId: null, ip: "1.1.1.1" });
    await removeDomain("example.com", { adminUserId: null, ip: "1.1.1.1" });
    const audits = await db.select().from(adminAuditLog).orderBy(asc(adminAuditLog.createdAt));
    expect(audits.map((a) => a.action)).toEqual(["domain_added", "domain_toggled", "domain_removed"]);
  });
});
