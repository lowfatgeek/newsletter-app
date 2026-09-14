import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../lib/admin/guard";
import { updateEmailCampaignDraft } from "../../../../lib/broadcast/crud";
import { validateContent } from "../../../../lib/broadcast/content";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * POST /admin/api/email-campaigns/[id] — simpan draft.
 * Body JSON: { subjectId, preheaderId, bodyHtmlId, subjectEn?, preheaderEn?,
 * bodyHtmlEn?, audienceFilter, maxPerMinute, maxPerHour }.
 *
 * Persistence seam: updateEmailCampaignDraft menyimpan body hasil
 * sanitizeBody (HTML mentah hanya ada di editor). Save draft menerima
 * konten belum lengkap (draft) — response membawa `missing` berisi locale
 * yang belum lengkap ([] | ["en"] | ["id", ...]) sebagai warning; kelengkapan
 * ID dipaksa ulang saat schedule oleh machine.scheduleCampaign.
 *
 * 200 { ok:true, missing } · 400 invalid/not-draft/invalid-filter · 404 not-found · 401.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const id = params.id ?? "";
  if (!id) return json({ ok: false, reason: "invalid" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const input = {
    subjectId: str(body.subjectId),
    preheaderId: str(body.preheaderId),
    bodyHtmlId: str(body.bodyHtmlId),
    subjectEn: str(body.subjectEn),
    preheaderEn: str(body.preheaderEn),
    bodyHtmlEn: str(body.bodyHtmlEn),
  };
  const maxPerMinute = num(body.maxPerMinute);
  const maxPerHour = num(body.maxPerHour);
  if (!Number.isInteger(maxPerMinute) || !Number.isInteger(maxPerHour)) {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  // Warning kelengkapan (draft boleh belum lengkap):
  // - "id" bila kolom ID wajib kosong (validateContent gagal);
  // - "en" bila konten EN tidak lengkap (fallback per field ke ID saat render).
  const content = validateContent(input);
  const missing: string[] = [];
  if (!content.ok) missing.push("id");
  else if (content.missing.includes("en")) missing.push("en");

  const result = await updateEmailCampaignDraft(
    id,
    { ...input, audienceFilter: body.audienceFilter, maxPerMinute, maxPerHour },
    { adminUserId: admin.id, ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
  );
  if (result.ok) return json({ ok: true, missing });
  return json({ ok: false, reason: result.reason }, result.reason === "not-found" ? 404 : 400);
};
