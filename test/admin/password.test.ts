import { describe, expect, it } from "vitest";
import { assertPasswordStrength, hashPassword, verifyPassword } from "../../src/lib/admin/password";

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
