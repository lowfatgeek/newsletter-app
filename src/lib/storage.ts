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

export function assertAssetDownloadable(asset: { mimeType: string; sizeBytes: number }): void {
  if (!ALLOWED_MIME.includes(asset.mimeType)) throw new Error(`MIME not allowed: ${asset.mimeType}`);
  if (asset.sizeBytes > MAX_UPLOAD_BYTES) throw new Error("File exceeds 100 MB limit");
}

/**
 * PUT objek privat ke R2. MOCK_R2=true melewatkan PUT (test CI / dev tanpa
 * kredensial R2) — baris DB tetap ditulis oleh pemanggil.
 */
export async function putObject(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
  if (env("MOCK_R2", "false") === "true") return;
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${env("R2_BUCKET")}/${key}`;
  const signer = new AwsV4Signer({
    url,
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
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
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  if (storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key");
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const url = new URL(`https://${host}/${env("R2_BUCKET")}/${storageKey}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSec));
  const signer = new AwsV4Signer({
    url: url.toString(),
    method: "GET",
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    signQuery: true,
  });
  const signed = await signer.sign();
  return signed.url.toString();
}
