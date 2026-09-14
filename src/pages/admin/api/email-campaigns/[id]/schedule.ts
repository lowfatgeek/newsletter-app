import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../../lib/admin/guard";
import { scheduleCampaign } from "../../../../../lib/broadcast/machine";
import { progressOf } from "../../../../../lib/broadcast/stats";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/[id]/schedule — jadwalkan atau kirim sekarang.
 * Body JSON { scheduledAt: ISO string | null } (null = kirim sekarang).
 *
 * Sukses → { ok:true, status, recipients } (recipients = ukuran snapshot).
 * Gagal → 400 dengan reason machine: "missing-id" (konten ID belum lengkap),
 * "not-draft", "in-past", atau "limits" (+detail) — pesan spesifik dipetakan
 * di client review modal.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const id = params.id ?? "";
  if (!id) return json({ ok: false, reason: "invalid" }, 400);

  let body: { scheduledAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  let scheduledAt: Date | null = null;
  if (body.scheduledAt !== null && body.scheduledAt !== undefined) {
    const d = new Date(String(body.scheduledAt));
    if (Number.isNaN(d.getTime())) return json({ ok: false, reason: "invalid" }, 400);
    scheduledAt = d;
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const result = await scheduleCampaign(id, { scheduledAt }, { adminUserId: admin.id, ip });
  if (!result.ok) {
    return json(
      result.reason === "limits" ? { ok: false, reason: "limits", detail: result.detail } : { ok: false, reason: result.reason },
      400,
    );
  }

  // Snapshot recipients baru dibuat — progressOf.total = ukuran snapshot.
  const { total } = await progressOf(id);
  return json({ ok: true, status: result.status, recipients: total });
};
