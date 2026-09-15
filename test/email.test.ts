import { describe, expect, it } from "vitest";
import { emailDomain, normalizeEmail } from "../src/lib/email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Budi@GMAIL.Com ")).toBe("budi@gmail.com");
  });
  it("rejects invalid syntax", () => {
    expect(normalizeEmail("budi")).toBeNull();
    expect(normalizeEmail("budi@")).toBeNull();
    expect(normalizeEmail("budi@@gmail.com")).toBeNull();
    expect(normalizeEmail("budi@nodot")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
  it("rejects over-long address", () => {
    const long = "a".repeat(250) + "@gmail.com";
    expect(normalizeEmail(long)).toBeNull();
  });
  it("extracts domain", () => {
    expect(emailDomain("budi@gmail.com")).toBe("gmail.com");
  });
});
