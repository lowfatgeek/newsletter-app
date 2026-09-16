import { describe, expect, it } from "vitest";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "../src/lib/pgerror";

describe("pgErrorCode", () => {
  it("reads SQLSTATE stored directly on the error (postgres-js)", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
  });

  it("follows the cause chain (drizzle-orm wraps PostgresError)", () => {
    expect(pgErrorCode({ cause: { cause: { code: PG_UNIQUE_VIOLATION } } })).toBe("23505");
  });

  it("returns undefined for unknown shapes and cycles", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(pgErrorCode(cyclic)).toBeUndefined();
  });
});
