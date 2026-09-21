import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DOMAINS, isDomainAllowed, listActiveDomains } from "../src/lib/allowlist";
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
      "gmail.com",
      "googlemail.com",
      "outlook.com",
      "hotmail.com",
      "live.com",
      "yahoo.com",
      "icloud.com",
      "me.com",
      "proton.me",
    ]);
  });
});

describe("listActiveDomains", () => {
  beforeEach(resetDb);
  it("returns active domains sorted with popular consumer domains first", async () => {
    await db.insert(emailDomains).values([
      { domain: "custom.com", active: true },
      { domain: "yahoo.com", active: true },
      { domain: "inactive.com", active: false },
      { domain: "gmail.com", active: true },
      { domain: "hotmail.com", active: true },
    ]);
    const domains = await listActiveDomains();
    expect(domains).toContain("gmail.com");
    expect(domains).toContain("yahoo.com");
    expect(domains).toContain("hotmail.com");
    expect(domains).toContain("custom.com");
    expect(domains).not.toContain("inactive.com");
    // gmail.com, yahoo.com, hotmail.com should appear before custom.com
    expect(domains.indexOf("gmail.com")).toBeLessThan(domains.indexOf("custom.com"));
    expect(domains.indexOf("yahoo.com")).toBeLessThan(domains.indexOf("custom.com"));
    expect(domains.indexOf("hotmail.com")).toBeLessThan(domains.indexOf("custom.com"));
  });

  it("falls back to default domains when database table is empty", async () => {
    const domains = await listActiveDomains();
    expect(domains.length).toBeGreaterThan(0);
    expect(domains).toContain("gmail.com");
    expect(domains[0]).toBe("gmail.com");
  });
});
