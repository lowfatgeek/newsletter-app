import { describe, it, expect } from "vitest";
import { packToken, unpackToken, generateOpaqueToken, hashToken, sha256Hex } from "../src/lib/crypto";

describe("packToken/unpackToken", () => {
  it("round-trips payload", () => {
    const t = packToken({ c: "abc", iat: 123 });
    expect(unpackToken<{ c: string; iat: number }>(t)).toEqual({ c: "abc", iat: 123 });
  });
  it("rejects tampered payload", () => {
    const t = packToken({ c: "abc", iat: 123 });
    const [body] = t.split(".");
    expect(unpackToken(`${body}.deadbeef`)).toBeNull();
    expect(unpackToken(`${body}x.${t.split(".")[1]}`)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(unpackToken("nonsense")).toBeNull();
    expect(unpackToken("")).toBeNull();
  });
});

describe("opaque tokens", () => {
  it("generates 43-char base64url token", () => {
    const t = generateOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("hashes deterministically", () => {
    expect(hashToken("abc")).toBe(sha256Hex("abc"));
  });
});
