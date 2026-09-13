import { describe, it, expect, beforeEach } from "vitest";
import { presignDownloadUrl, assertAssetDownloadable } from "../src/lib/storage";
import { setEnv } from "./helpers";

describe("presignDownloadUrl", () => {
  beforeEach(() => setEnv({
    R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "sec", R2_BUCKET: "bucket",
  }));
  it("produces signed url with 1h expiry", async () => {
    const url = await presignDownloadUrl("rewards/2026/file.pdf");
    const u = new URL(url);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("acct.r2.cloudflarestorage.com");
    expect(u.pathname).toContain("/bucket/rewards/2026/file.pdf");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
  it("rejects traversal keys", async () => {
    await expect(presignDownloadUrl("../secret")).rejects.toThrow();
  });
});

describe("assertAssetDownloadable", () => {
  it("allows allowed mime within 100MB", () => {
    expect(() => assertAssetDownloadable({ mimeType: "application/pdf", sizeBytes: 50_000_000 })).not.toThrow();
  });
  it("rejects disallowed mime and oversize", () => {
    expect(() => assertAssetDownloadable({ mimeType: "application/x-msdownload", sizeBytes: 1 })).toThrow();
    expect(() => assertAssetDownloadable({ mimeType: "application/pdf", sizeBytes: 101 * 1024 * 1024 })).toThrow();
  });
});
