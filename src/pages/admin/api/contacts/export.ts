import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../lib/admin/guard";
import { buildContactsCsv } from "../../../../lib/admin/contacts";

export const prerender = false;

const STATUSES = ["pending", "confirmed", "unsubscribed"] as const;

/**
 * GET /admin/api/contacts/export — unduh CSV kontak (text/csv attachment,
 * filename contacts-YYYY-MM-DD.csv). Filter sama dengan halaman daftar
 * (status, campaignId, search, limit, offset). Cookie tidak valid → 401 JSON.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const status = (STATUSES as readonly string[]).includes(statusRaw ?? "")
    ? (statusRaw as (typeof STATUSES)[number])
    : undefined;
  const campaignId = url.searchParams.get("campaignId") || undefined;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "5000", 10);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50000) : 5000;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const csv = await buildContactsCsv(
    { status, campaignId, search, limit, offset },
    {
      adminUserId: admin.id,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    },
  );

  const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
