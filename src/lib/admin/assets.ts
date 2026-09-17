import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { listCampaignAssets } from "../rewards";
import { rewardAssets, rewardCampaigns } from "../schema";
import { ALLOWED_MIME, IMAGE_MIME, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, putObject } from "../storage";
import { audit } from "./audit";
import type { AuditOpts } from "./campaigns";

/**
 * Upload + management asset reward (objek privat di R2).
 * PRD 7.2: removeAsset menghapus ROW saja — objek R2 lama TIDAK dihapus
 * otomatis karena mungkin masih direferensiasi klaim/riwayat.
 */

export type ValidateInput = { filename: string; mimeType: string; sizeBytes: number };
export type ValidateResult = { ok: true } | { ok: false; reason: "mime-not-allowed" | "too-large" };

// Canonical MIME untuk setiap format ekstensi yang didukung saat disimpan ke DB/R2.
export const CANONICAL_MIME: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// Peta ekstensi → variasi MIME yang sah dikirim browser/OS.
// Di Windows, file ZIP sering dikirim sebagai application/x-zip-compressed oleh Chrome/Edge.
// Beberapa sistem/browser juga dapat mengirim application/octet-stream atau x-zip.
export const EXT_TO_ALLOWED_MIMES: Record<string, string[]> = {
  pdf: ["application/pdf", "application/x-pdf", "application/octet-stream"],
  zip: [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-zip",
    "multipart/x-zip",
    "application/octet-stream",
  ],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  png: ["image/png", "image/x-png"],
  jpg: ["image/jpeg", "image/pjpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/pjpeg", "image/jpg"],
  webp: ["image/webp"],
};

function extOf(filename: string): string {
  const base = filename.toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

export function validateUpload(input: ValidateInput): ValidateResult {
  const ext = extOf(input.filename);
  const allowed = EXT_TO_ALLOWED_MIMES[ext];
  if (!allowed) return { ok: false, reason: "mime-not-allowed" };

  const mime = input.mimeType || "application/octet-stream";
  if (!ALLOWED_MIME.includes(mime)) return { ok: false, reason: "mime-not-allowed" };
  if (!allowed.includes(mime)) return { ok: false, reason: "mime-not-allowed" };
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "too-large" };
  return { ok: true };
}

/** Sanitasi nama file untuk storage key: lowercase, non [a-z0-9.-] → "-", dibatasi panjang. */
export function sanitizeFilename(name: string): string {
  const flat = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return flat.slice(0, 80) || "file";
}

export async function storeAsset(
  input: {
    campaignId: string;
    filename: string;
    mimeType: string;
    body: ArrayBuffer;
    nameId?: string;
    sortOrder?: number;
  },
  auditOpts?: AuditOpts,
): Promise<{ ok: true; id: string; storageKey: string } | { ok: false; reason: "mime-not-allowed" | "too-large" }> {
  const validation = validateUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.body.byteLength,
  });
  if (!validation.ok) return validation;

  const ext = extOf(input.filename);
  const canonicalMime = CANONICAL_MIME[ext] ?? (input.mimeType || "application/octet-stream");

  // Checksum dihitung langsung dari byte body (createHash — bukan sha256Hex
  // yang menerima string).
  const checksum = createHash("sha256").update(Buffer.from(input.body)).digest("hex");
  const storageKey = `rewards/${input.campaignId}/${crypto.randomUUID()}-${sanitizeFilename(input.filename)}`;
  await putObject(storageKey, input.body, canonicalMime);

  // nameId default: nama file asli tanpa ekstensi.
  const original = input.filename.replace(/\.[^.]+$/, "").trim();
  const nameId = (input.nameId ?? "").trim() || original || input.filename;

  const [row] = await db
    .insert(rewardAssets)
    .values({
      campaignId: input.campaignId,
      storageKey,
      nameId: nameId.slice(0, 200),
      mimeType: canonicalMime,
      sizeBytes: input.body.byteLength,
      checksum,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning({ id: rewardAssets.id });

  await audit("asset_uploaded", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: {
      campaignId: input.campaignId,
      assetId: row.id,
      filename: input.filename,
      storageKey,
      sizeBytes: input.body.byteLength,
      checksum,
    },
  });

  return { ok: true, id: row.id, storageKey };
}

/** Hapus asset dari database (file R2 sengaja tidak dihapus otomatis). */
export async function removeAsset(assetId: string, auditOpts?: AuditOpts): Promise<void> {
  const [deleted] = await db.delete(rewardAssets).where(eq(rewardAssets.id, assetId)).returning();
  if (deleted) {
    await audit("asset_removed", {
      adminUserId: auditOpts?.adminUserId ?? undefined,
      ip: auditOpts?.ip,
      detail: { campaignId: deleted.campaignId, assetId: deleted.id, storageKey: deleted.storageKey },
    });
  }
}

/** Reorder array of asset ids: sort_order di-assign 0..N-1. */
export async function reorderAssets(campaignId: string, assetIds: string[], auditOpts?: AuditOpts): Promise<void> {
  const existing = await listCampaignAssets(campaignId);
  const ownedIds = new Set(existing.map((a) => a.id));

  await db.transaction(async (tx) => {
    let order = 0;
    for (const id of assetIds) {
      if (!ownedIds.has(id)) continue;
      await tx.update(rewardAssets).set({ sortOrder: order }).where(eq(rewardAssets.id, id));
      order++;
    }
  });

  await audit("assets_reordered", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { campaignId, order: assetIds.filter((id) => ownedIds.has(id)) },
  });
}

/** Aset campaign untuk panel admin — satu implementasi dengan halaman akses publik. */
export const listAssets = listCampaignAssets;

export type FeaturedImageInput = { campaignId: string; filename: string; mimeType: string; body: ArrayBuffer };
export type FeaturedImageResult = { ok: true; key: string } | { ok: false; reason: "mime-not-allowed" | "too-large" };

/**
 * Featured image campaign: validasi image-only (MIME + ekstensi harus cocok),
 * batas 5 MB, lalu tulis objek ke R2. Tidak ada baris reward_asset — gambar
 * hero bukan file reward yang bisa klaim, jadi hanya key-nya yang disimpan
 * di kolom featured_image_key oleh endpoint pemanggil.
 */
export async function storeFeaturedImage(input: FeaturedImageInput): Promise<FeaturedImageResult> {
  const ext = extOf(input.filename);
  const allowed = EXT_TO_ALLOWED_MIMES[ext];
  const mime = input.mimeType || "application/octet-stream";
  if (!IMAGE_MIME.includes(mime) && !["image/x-png", "image/pjpeg", "image/jpg"].includes(mime)) {
    return { ok: false, reason: "mime-not-allowed" };
  }
  if (!allowed || !allowed.includes(mime)) {
    return { ok: false, reason: "mime-not-allowed" };
  }
  if (input.body.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };

  const canonicalMime = CANONICAL_MIME[ext] ?? input.mimeType;
  const storageKey = `featured/${input.campaignId}/${crypto.randomUUID()}-${sanitizeFilename(input.filename)}`;
  await putObject(storageKey, input.body, canonicalMime);
  return { ok: true, key: storageKey };
}

/** Objek lama sengaja tidak dihapus dari R2 (mengikuti kebijakan removeAsset). */
export async function removeFeaturedImage(campaignId: string, auditOpts?: AuditOpts): Promise<void> {
  await db.update(rewardCampaigns).set({ featuredImageKey: null }).where(eq(rewardCampaigns.id, campaignId));
  await audit("campaign_image_removed", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { campaignId },
  });
}
