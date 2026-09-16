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

// Peta ekstensi → MIME OOXML/image yang sah. Ekstensi harus cocok dengan MIME
// yang dikirim browser agar file bermimetype js/exe tidak lolos hanya karena
// berganti nama menjadi .pdf.
const EXT_TO_MIME: Record<string, string> = {
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

function extOf(filename: string): string {
  const base = filename.toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

export function validateUpload(input: ValidateInput): ValidateResult {
  if (!ALLOWED_MIME.includes(input.mimeType)) return { ok: false, reason: "mime-not-allowed" };
  const expected = EXT_TO_MIME[extOf(input.filename)];
  if (!expected || expected !== input.mimeType) return { ok: false, reason: "mime-not-allowed" };
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

  // Checksum dihitung langsung dari byte body (createHash — bukan sha256Hex
  // yang menerima string).
  const checksum = createHash("sha256").update(Buffer.from(input.body)).digest("hex");
  const storageKey = `rewards/${input.campaignId}/${crypto.randomUUID()}-${sanitizeFilename(input.filename)}`;
  await putObject(storageKey, input.body, input.mimeType);

  // nameId default: nama file asli tanpa ekstensi.
  const original = input.filename.replace(/\.[^.]+$/, "").trim();
  const nameId = (input.nameId ?? "").trim() || original || input.filename;

  const [row] = await db
    .insert(rewardAssets)
    .values({
      campaignId: input.campaignId,
      storageKey,
      nameId: nameId.slice(0, 200),
      mimeType: input.mimeType,
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
    },
  });
  return { ok: true, id: row.id, storageKey };
}

/** Hapus ROW asset saja — objek R2 tidak dihapus (PRD 7.2). */
export async function removeAsset(assetId: string, auditOpts?: AuditOpts): Promise<{ ok: true }> {
  const [row] = await db.select().from(rewardAssets).where(eq(rewardAssets.id, assetId));
  if (row) {
    await db.delete(rewardAssets).where(eq(rewardAssets.id, assetId));
    await audit("asset_removed", {
      adminUserId: auditOpts?.adminUserId ?? undefined,
      ip: auditOpts?.ip,
      detail: { campaignId: row.campaignId, assetId, storageKey: row.storageKey },
    });
  }
  return { ok: true };
}

/**
 * Simpan urutan tampil asset: sortOrder = index di array assetId yang
 * diberikan. Asset campaign lain yang tidak ada di array diabaikan.
 */
export async function reorderAssets(campaignId: string, assetIds: string[], auditOpts?: AuditOpts): Promise<void> {
  const owned = await db
    .select({ id: rewardAssets.id })
    .from(rewardAssets)
    .where(eq(rewardAssets.campaignId, campaignId));
  const ownedIds = new Set(owned.map((o) => o.id));
  let i = 0;
  for (const id of assetIds) {
    if (!ownedIds.has(id)) continue;
    await db.update(rewardAssets).set({ sortOrder: i }).where(eq(rewardAssets.id, id));
    i += 1;
  }
  await audit("asset_reordered", {
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
 * hero bukan file reward yang bisa diklaim, jadi hanya key-nya yang disimpan
 * di kolom featured_image_key oleh endpoint pemanggil.
 */
export async function storeFeaturedImage(input: FeaturedImageInput): Promise<FeaturedImageResult> {
  if (!IMAGE_MIME.includes(input.mimeType)) return { ok: false, reason: "mime-not-allowed" };
  const expected = EXT_TO_MIME[extOf(input.filename)];
  if (!expected || !IMAGE_MIME.includes(expected) || expected !== input.mimeType) {
    return { ok: false, reason: "mime-not-allowed" };
  }
  if (input.body.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };

  const storageKey = `featured/${input.campaignId}/${crypto.randomUUID()}-${sanitizeFilename(input.filename)}`;
  await putObject(storageKey, input.body, input.mimeType);
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
