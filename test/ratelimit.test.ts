import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { consumeRateLimit, hashIp, pruneRateLimits } from "../src/lib/ratelimit";
import { rateLimits } from "../src/lib/schema";
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

describe("pruneRateLimits", () => {
  beforeEach(resetDb);
  it("prunes records older than specified duration", async () => {
    const oldDate = new Date(Date.now() - 25 * 3600_000);
    const recentDate = new Date();

    await db.insert(rateLimits).values([
      { key: "old_key", windowStart: oldDate, count: 1 },
      { key: "recent_key", windowStart: recentDate, count: 1 },
    ]);

    const deletedCount = await pruneRateLimits(24 * 3600_000);
    expect(deletedCount).toBe(1);

    const remaining = await db.select().from(rateLimits);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].key).toBe("recent_key");
  });
});

describe("hashIp", () => {
  it("is deterministic 64-char hex and not the raw ip", () => {
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4")).not.toContain("1.2.3.4");
  });
});
