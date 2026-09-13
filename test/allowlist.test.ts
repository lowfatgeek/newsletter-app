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
