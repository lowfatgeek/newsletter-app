import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { putObject } from "../src/lib/storage";
import { setEnv } from "./helpers";

// putObject menandatangani PUT dengan Content-Type (aws4fetch memasukkan semua
// header constructor ke signableHeaders) — objek reward tersimpan dengan MIME
// asli, bukan application/octet-stream, agar unduhan signed-URL bisa preview.
describe("putObject (MOCK_R2=false, fetch di-mock)", () => {
  beforeEach(() => setEnv({
    MOCK_R2: "false",
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "sec",
    R2_BUCKET: "bucket",
  }));
  afterEach(() => vi.unstubAllGlobals());

  it("mengirim Content-Type sesuai contentType dan tetap ter-signing", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await putObject("rewards/e2e/guide.pdf", new ArrayBuffer(8), "application/pdf");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/bucket/rewards/e2e/guide.pdf");
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/pdf");
    // Request benar-benar ter-signing (header auth AWS SigV4 ada).
    expect(headers.get("Authorization")).toContain("AWS4-HMAC-SHA256");
    expect(headers.get("X-Amz-Date")).toBeTruthy();
  });

  it("Content-Type mengikuti nilai yang diberikan (bukan hardcoded)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await putObject("rewards/e2e/hero.webp", new ArrayBuffer(4), "image/webp");

    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Content-Type")).toBe("image/webp");
  });

  it("gagal R2 (non-2xx) tetap melempar error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(putObject("rewards/x.pdf", new ArrayBuffer(1), "application/pdf")).rejects.toThrow(/403/);
  });

  it("menolak traversal key sebelum signing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(putObject("../secret", new ArrayBuffer(1), "application/pdf")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
