import type { APIRoute } from "astro";
import { listAssets, removeAsset, reorderAssets, storeAsset } from "../../../../../lib/admin/assets";
import { getCampaignById } from "../../../../../lib/admin/campaigns";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { clientIp } from "../../../../../lib/ip";
import { MAX_UPLOAD_BYTES } from "../../../../../lib/storage";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

function unauthorized() {
  return json({ ok: false, reason: "unauthorized" }, 401);
}

function auditIp(request: Request) {
  return clientIp(request);
}

/** Shape asset untuk klien (tanpa checksum/storageKey penuh). */
function assetView(a: { id: string; nameId: string; mimeType: string; sizeBytes: number; sortOrder: number }) {
  return { id: a.id, nameId: a.nameId, mimeType: a.mimeType, sizeBytes: a.sizeBytes, sortOrder: a.sortOrder };
}

/**
 * GET /admin/api/campaigns/[id]/assets — daftar asset campaign terurut
 * sortOrder. Dipakai klien untuk me-refresh list tanpa reload halaman.
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return unauthorized();
  const data = await getCampaignById(params.id ?? "");
  if (!data) return json({ ok: false, reason: "not-found" }, 404);
  return json({ ok: true, assets: data.assets.map(assetView) });
};

/**
 * POST /admin/api/campaigns/[id]/assets — upload multipart (field "file";
 * "nameId" opsional). Validasi mime/ekstensi/ukuran di lib; sukses →
 * { ok:true, asset }. Pelanggaran validasi → 400 { ok:false, reason }.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return unauthorized();

  const campaignId = params.id ?? "";
  const existing = await getCampaignById(campaignId);
  if (!existing) return json({ ok: false, reason: "not-found" }, 404);

  // Pre-check sebelum membaca multipart body penuh: Content-Length melebihi
  // MAX_UPLOAD_BYTES (+1KB overhead multipart) ditolak lebih awal supaya body
  // besar tidak dibuffer ke memori. Header absen (chunked) → lanjut, validasi
  // ukuran tetap dijalankan lib admin/assets.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024) {
    return json({ ok: false, reason: "too-large" }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const nameId = typeof form.get("nameId") === "string" ? String(form.get("nameId")) : undefined;
  const maxOrder = existing.assets.reduce((m, a) => Math.max(m, a.sortOrder + 1), 0);

  try {
    const body = await file.arrayBuffer();
    const res = await storeAsset(
      {
        campaignId,
        filename: file.name,
        mimeType: file.type,
        body,
        nameId,
        sortOrder: maxOrder,
      },
      { adminUserId: admin.id, ip: auditIp(request) },
    );
    if (!res.ok) return json({ ok: false, reason: res.reason }, 400);
    const assets = await listAssets(campaignId);
    return json({ ok: true, asset: assetView(assets.find((a) => a.id === res.id)!), assets: assets.map(assetView) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Asset Upload Error] campaign=${campaignId}:`, err);
    return json({ ok: false, reason: "upload-failed", error: msg }, 500);
  }
};

/**
 * PATCH /admin/api/campaigns/[id]/assets — simpan urutan tampil.
 * Body JSON { order: [assetId, ...] } → sortOrder = index. Ini endpoint
 * reorder khusus (dokumentasi ruling brief: PATCH di route assets).
 */
export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return unauthorized();

  const campaignId = params.id ?? "";
  const existing = await getCampaignById(campaignId);
  if (!existing) return json({ ok: false, reason: "not-found" }, 404);

  let body: { order?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  if (!Array.isArray(body.order) || body.order.some((id) => typeof id !== "string")) {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  await reorderAssets(campaignId, body.order as string[], { adminUserId: admin.id, ip: auditIp(request) });
  const assets = await listAssets(campaignId);
  return json({ ok: true, assets: assets.map(assetView) });
};

/**
 * DELETE /admin/api/campaigns/[id]/assets?assetId=<uuid> — hapus ROW asset
 * saja (objek R2 tidak dihapus — PRD 7.2). Variant handler agar lebih mudah
 * dipanggil klien tanpa route terpisah.
 */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return unauthorized();
  const campaignId = params.id ?? "";
  const existing = await getCampaignById(campaignId);
  if (!existing) return json({ ok: false, reason: "not-found" }, 404);

  const assetId = new URL(request.url).searchParams.get("assetId") ?? "";
  if (!existing.assets.some((a) => a.id === assetId)) {
    return json({ ok: false, reason: "not-found" }, 404);
  }
  await removeAsset(assetId, { adminUserId: admin.id, ip: auditIp(request) });
  const assets = await listAssets(campaignId);
  return json({ ok: true, assets: assets.map(assetView) });
};
