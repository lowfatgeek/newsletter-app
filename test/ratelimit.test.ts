import { describe, it, expect, beforeEach } from "vitest";
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
