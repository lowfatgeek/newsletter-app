import { AwsV4Signer } from "aws4fetch";
import { env } from "./env";

export const ALLOWED_MIME = [
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
];
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Featured image halaman reward: hanya raster, dibatasi jauh lebih kecil dari
// file reward karena dimuat eager di hero (RewardHero 1200×630).
export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function assertAssetDownloadable(asset: { mimeType: string; sizeBytes: number }): void {
  if (!ALLOWED_MIME.includes(asset.mimeType)) throw new Error(`MIME not allowed: ${asset.mimeType}`);
  if (asset.sizeBytes > MAX_UPLOAD_BYTES) throw new Error("File exceeds 100 MB limit");
}

export function getR2Config() {
  const rawAccountId = env("R2_ACCOUNT_ID", "");
  const accountId = rawAccountId
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.r2\.cloudflarestorage\.com.*$/, "")
    .replace(/\/.*$/, "")
    .trim();
  const bucket = env("R2_BUCKET", "").trim();
  const accessKeyId = env("R2_ACCESS_KEY_ID", "").trim();
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY", "").trim();
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

/**
 * PUT objek privat ke R2. MOCK_R2=true melewatkan PUT (test CI / dev tanpa
 * kredensial R2) — baris DB tetap ditulis oleh pemanggil.
 */
export async function putObject(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
  if (env("MOCK_R2", "false") === "true") return;
  const { accountId, bucket, accessKeyId, secretAccessKey } = getR2Config();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Kredensial R2 tidak lengkap (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;
  const signer = new AwsV4Signer({
    url,
    accessKeyId,
    secretAccessKey,
    method: "PUT",
    // Content-Type ikut ditandatangani (aws4fetch memasukkan semua header ke
    // signableHeaders) supaya objek tersimpan dengan MIME benar dan unduhan
    // bertanda tangan bisa preview inline (bukan application/octet-stream).
    headers: { "Content-Type": contentType },
  });
  const signed = await signer.sign();
  // Timeout eksplisit (task 2.1): upload ke R2 tidak boleh menggantung tanpa batas.
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300);
    throw new Error(`R2 PUT ${res.status}: ${errText}`);
  }
}

export async function presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  if (storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key");
  if (env("MOCK_R2", "false") === "true") {
    return `https://mock-r2.local/download/${encodeURIComponent(storageKey)}?expiresIn=${expiresInSec}`;
  }
  const { accountId, bucket, accessKeyId, secretAccessKey } = getR2Config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = new URL(`https://${host}/${bucket}/${storageKey}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSec));
  const signer = new AwsV4Signer({
    url: url.toString(),
    method: "GET",
    accessKeyId,
    secretAccessKey,
    signQuery: true,
  });
  const signed = await signer.sign();
  return signed.url.toString();
}

/**
 * Uji koneksi ke Cloudflare R2 dengan menulis & membaca file diagnostik kecil.
 * Dipakai oleh endpoint admin untuk mendeteksi masalah kredensial, izin token, atau nama bucket.
 */
export async function testR2Connection(): Promise<{
  ok: boolean;
  mock: boolean;
  accountId?: string;
  bucket?: string;
  error?: string;
  detail?: string;
}> {
  if (env("MOCK_R2", "false") === "true") {
    return { ok: true, mock: true, detail: "MOCK_R2 aktif (simulasi dev/test, tidak memanggil R2 nyata)." };
  }
  try {
    const { accountId, bucket, accessKeyId, secretAccessKey } = getR2Config();
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
      const missing: string[] = [];
      if (!accountId) missing.push("R2_ACCOUNT_ID");
      if (!bucket) missing.push("R2_BUCKET");
      if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
      if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
      return { ok: false, mock: false, error: `Variabel environment belum lengkap: ${missing.join(", ")}` };
    }

    const testKey = `_diagnostic/conn-check-${Date.now()}.txt`;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const url = `https://${host}/${bucket}/${testKey}`;
    const signer = new AwsV4Signer({
      url,
      accessKeyId,
      secretAccessKey,
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
    });
    const signed = await signer.sign();
    const res = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: new TextEncoder().encode("connection-test-ok"),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      let hint = "";
      if (res.status === 403) {
        hint = " Token API R2 tidak memiliki izin 'Object Read & Write' atau dibatasi pada bucket lain.";
      } else if (res.status === 404) {
        hint = ` Bucket '${bucket}' tidak ditemukan di Cloudflare R2. Pastikan nama bucket sama persis.`;
      } else if (res.status === 401) {
        hint = " Access Key ID atau Secret Access Key salah.";
      }
      return {
        ok: false,
        mock: false,
        accountId: `${accountId.slice(0, 6)}...`,
        bucket,
        error: `R2 HTTP ${res.status}: ${errText.slice(0, 200)}.${hint}`,
      };
    }

    return {
      ok: true,
      mock: false,
      accountId: `${accountId.slice(0, 6)}...`,
      bucket,
      detail: `Koneksi R2 berhasil! Bucket '${bucket}' siap digunakan.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint = "";
    if (msg.includes("SSL") || msg.includes("handshake")) {
      hint = " (Periksa R2_ACCOUNT_ID, pastikan 32 karakter hex tanpa awalan https:// atau domain)";
    } else if (msg.includes("ENOTFOUND")) {
      hint = " (Domain host R2 tidak dapat diakses, periksa R2_ACCOUNT_ID)";
    }
    return { ok: false, mock: false, error: `${msg}${hint}` };
  }
}
