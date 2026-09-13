import { describe, it, expect } from "vitest";
import { issueTimerToken, verifyTimerToken } from "../src/lib/timer";

describe("verifyTimerToken", () => {
  it("rejects token younger than 30 seconds", () => {
    const t = issueTimerToken("camp-1");
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: false, reason: "too-fast" });
  });
  it("accepts token aged 30s..2h for the right campaign", () => {
    const t = issueTimerToken("camp-1", Date.now() - 31_000);
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: true });
  });
  it("rejects wrong campaign", () => {
    const t = issueTimerToken("camp-1", Date.now() - 31_000);
    expect(verifyTimerToken(t, "camp-2")).toEqual({ ok: false, reason: "wrong-campaign" });
  });
  it("rejects token older than 2 hours", () => {
    const t = issueTimerToken("camp-1", Date.now() - (2 * 3600_000 + 1000));
    expect(verifyTimerToken(t, "camp-1")).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects garbage", () => {
    expect(verifyTimerToken("garbage", "camp-1")).toEqual({ ok: false, reason: "invalid" });
  });
});
