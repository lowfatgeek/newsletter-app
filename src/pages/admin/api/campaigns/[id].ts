import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../lib/admin/guard";
import {
  changeSlug,
  getCampaignById,
  updateCampaignMeta,
  upsertCampaignLocale,
} from "../../../../lib/admin/campaigns";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

type RawItem = { name?: unknown; benefit?: unknown; format?: unknown; size?: unknown };
type LocaleBody = {
  title?: unknown;
  description?: unknown;
  rewardItems?: unknown;
  metaTitle?: unknown;
  metaDescription?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Normalisasi rewardItems dari body: buang baris kosong, batasi 20 item. */
function parseItems(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const items = (raw as RawItem[])
    .map((it) => ({
      name: str(it?.name).trim(),
      benefit: str(it?.benefit).trim(),
      format: str(it?.format).trim() || undefined,
      size: str(it?.size).trim() || undefined,
    }))
    .filter((it) => it.name !== "" && it.benefit !== "");
  return items.slice(0, 20);
}

/**
 * POST /admin/api/campaigns/[id] — simpan meta + kedua locale + perubahan slug.
 * Body JSON { slug, featuredImageKey, sortOrder, indexable,
 *             locales: { id: {...}, en: {...} }, redirectConfirmed? }.
 * Sukses → { ok: true }. Slug campaign non-draft tanpa redirectConfirmed → 409
 * { ok:false, reason:"published-requires-confirmation" } (klien konfirmasi lalu
 * submit ulang). Slug invalid/taken → 400. Campaign tidak ada → 404.
 * Cookie admin tidak valid → 401.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), { status: 401, headers: noStore });
  }

  const id = params.id ?? "";
  const existing = await getCampaignById(id);
  if (!existing) {
    return new Response(JSON.stringify({ ok: false, reason: "not-found" }), { status: 404, headers: noStore });
  }

  let body: {
    slug?: unknown;
    featuredImageKey?: unknown;
    sortOrder?: unknown;
    indexable?: unknown;
    redirectConfirmed?: unknown;
    locales?: Record<string, LocaleBody>;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "invalid" }), { status: 400, headers: noStore });
  }

  const locales = body.locales ?? {};
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const auditOpts = { adminUserId: admin.id, ip };

  // Validasi locale lebih dulu agar tidak ada tulisan sebelum error di slug.
  const normalized: Record<"id" | "en", ReturnType<typeof parseLocale> | null> = { id: null, en: null };
  function parseLocale(lb: LocaleBody | undefined) {
    if (!lb) return null;
    const title = str(lb.title).trim();
    const description = str(lb.description).trim();
    // Keduanya kosong → locale dianggap belum diisi, jangan ditulis.
    if (title === "" && description === "") return null;
    if (title === "") return { error: "missing-title" as const };
    return {
      error: null,
      fields: {
        title,
        description,
        rewardItems: parseItems(lb.rewardItems),
        metaTitle: str(lb.metaTitle).trim() || undefined,
        metaDescription: str(lb.metaDescription).trim() || undefined,
      },
    };
  }
  normalized.id = parseLocale(locales.id);
  normalized.en = parseLocale(locales.en);
  if (normalized.id?.error || normalized.en?.error) {
    return new Response(JSON.stringify({ ok: false, reason: "missing-title" }), { status: 400, headers: noStore });
  }

  // Slug divalidasi + ditulis lebih dulu (no-op bila sama). 409 → klien minta
  // konfirmasi redirect lalu submit ulang dengan redirectConfirmed: true.
  const slug = str(body.slug).trim();
  const slugResult = await changeSlug(id, slug, body.redirectConfirmed === true, auditOpts);
  if (!slugResult.ok) {
    const status = slugResult.reason === "published-requires-confirmation" ? 409 : 400;
    return new Response(JSON.stringify({ ok: false, reason: slugResult.reason }), { status, headers: noStore });
  }

  await updateCampaignMeta(
    id,
    {
      featuredImageKey: str(body.featuredImageKey).trim() || null,
      order: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : existing.campaign.sortOrder,
      indexable: body.indexable === true,
    },
    auditOpts,
  );

  for (const locale of ["id", "en"] as const) {
    const parsed = normalized[locale];
    if (parsed && !parsed.error) await upsertCampaignLocale(id, locale, parsed.fields, auditOpts);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: noStore });
};
