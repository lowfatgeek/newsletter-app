import type { APIRoute } from "astro";
import { removeFeaturedImage, storeFeaturedImage } from "../../../../../lib/admin/assets";
import { getCampaignById, updateCampaignMeta } from "../../../../../lib/admin/campaigns";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../../../lib/admin/guard";
import { clientIp } from "../../../../../lib/ip";
import { MAX_IMAGE_BYTES, presignDownloadUrl } from "../../../../../lib/storage";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

/**
 * GET /admin/api/campaigns/[id]/image — thumbnail editor. Berbeda dari
 * /api/image/[key] publik (campaign published saja), route ini menerima cookie
 * admin sehingga gambar draft pun tampil. 302 → presigned URL TTL pendek.
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const data = await getCampaignById(params.id ?? "");
  if (!data) return json({ ok: false, reason: "not-found" }, 404);

  const key = data.campaign.featuredImageKey;
  if (!key) return json({ ok: false, reason: "no-image" }, 404);

  let url: string;
  try {
    url = await presignDownloadUrl(key, 300);
  } catch (err) {
    console.error(`[Admin Campaign Image] Presign error for campaign=${params.id} key=${key}:`, err);
    return json({ ok: false, reason: "storage-error" }, 502);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
    },
  });
};

/**
 * POST /admin/api/campaigns/[id]/image — upload featured image (multipart,
 * field "file"). Image-only: MIME png/jpeg/webp + ekstensi cocok, maksimal
 * 5 MB. Sukses → { ok:true, key } DAN kolom featured_image_key langsung
 * ditulis, sehingga gambar tidak hilang bila admin menutup halaman tanpa
 * menekan Simpan. Tidak ada baris reward_asset: gambar hero bukan file reward
 * yang bisa diklaim.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const id = params.id ?? "";
  const data = await getCampaignById(id);
  if (!data) return json({ ok: false, reason: "not-found" }, 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, reason: "invalid" }, 400);

  const ip = clientIp(request);
  let body: ArrayBuffer;
  try {
    body = await file.arrayBuffer();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  try {
    const stored = await storeFeaturedImage({
      campaignId: id,
      filename: file.name,
      mimeType: file.type,
      body,
    });
    if (!stored.ok) {
      // Sertakan batas agar klien bisa menampilkan pesan ukuran tanpa hardcode.
      return json({ ok: false, reason: stored.reason, maxBytes: MAX_IMAGE_BYTES }, 400);
    }

    await updateCampaignMeta(id, { featuredImageKey: stored.key }, { adminUserId: admin.id, ip });
    return json({ ok: true, key: stored.key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Featured Image Upload Error] campaign=${id}:`, err);
    return json({ ok: false, reason: "storage-failed", error: msg }, 500);
  }
};

/** DELETE /admin/api/campaigns/[id]/image — lepas referensi featured image. */
export const DELETE: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const id = params.id ?? "";
  const data = await getCampaignById(id);
  if (!data) return json({ ok: false, reason: "not-found" }, 404);

  await removeFeaturedImage(id, { adminUserId: admin.id, ip: clientIp(request) });
  return json({ ok: true });
};
