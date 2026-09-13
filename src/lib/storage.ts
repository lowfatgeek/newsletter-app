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

export async function presignDownloadUrl(storageKey: string, expiresInSec = 3600): Promise<string> {
  if (storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key");
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const url = new URL(`https://${host}/${env("R2_BUCKET")}/${storageKey}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSec));
  const signer = new AwsV4Signer({
    url,
    method: "GET",
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    signQuery: true,
  });
  const signed = await signer.sign();
  return signed.url;
}
