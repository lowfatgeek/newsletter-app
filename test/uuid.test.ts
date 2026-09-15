import { describe, expect, it } from "vitest";
import { isValidUuid } from "../src/lib/uuid";

describe("isValidUuid (task 1.9 / 08-N2)", () => {
  it("menerima UUID v4 normal", () => {
    expect(isValidUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });
  it("menolak bukan string / kosong", () => {
    expect(isValidUuid(null as unknown as string)).toBe(false);
    expect(isValidUuid(undefined as unknown as string)).toBe(false);
    expect(isValidUuid("")).toBe(false);
  });
  it("menolak input penyerang khas (favicon, 'abc', SQL, UUID tanpa dash)", () => {
    expect(isValidUuid("favicon.ico")).toBe(false);
    expect(isValidUuid("abc")).toBe(false);
    expect(isValidUuid("3f2504e04f8941d39a0c0305e82c3301")).toBe(false);
    expect(isValidUuid("3f2504e0-4f89-41d3-9a0c-0305e82c330'; DROP TABLE contacts;--")).toBe(false);
  });
  it("menolak digit hex salah di segmen versi/variant", () => {
    expect(isValidUuid("3f2504e0-4f89-61d3-9a0c-0305e82c3301")).toBe(false); // versi 6 bukan [1-5]
    expect(isValidUuid("3f2504e0-4f89-41d3-fa0c-0305e82c3301")).toBe(false); // variant f
  });
  it("case-insensitive", () => {
    expect(isValidUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });
});
