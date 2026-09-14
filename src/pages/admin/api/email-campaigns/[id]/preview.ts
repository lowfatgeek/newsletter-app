import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../../lib/admin/guard";
import { getCampaignForBroadcast } from "../../../../../lib/broadcast/machine";
import { renderForRecipient, type CampaignContent } from "../../../../../lib/broadcast/content";
import { env } from "../../../../../lib/env";

export const prerender = false;

/**
 * GET /admin/api/email-campaigns/[id]/preview?locale=id|en
 *
 * HTML email lengkap untuk iframe preview composer:
 * - recipient dummy admin@example.com (tidak menyentuh recipient/data lain)
 * - locale pilihan query (default "id"); fallback per field ke ID saat EN kosong
 * - linkRewrite identitas (tanpa click tracking) + unsubscribe placeholder
 *   /api/unsubscribe/preview (bukan milik kontak mana pun)
 *
 * Header CSP `frame-ancestors 'self'` diset langsung di sini agar route bisa
 * di-iframe oleh composer (middleware CSP global menyusul di hardening).
 */
export const GET: APIRoute = async ({ params, cookies, url }) => {
  const admin = await getAdmin(cookies);
  if (!admin) {
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }

  const campaign = await getCampaignForBroadcast(params.id ?? "");
  if (!campaign) {
    return new Response(JSON.stringify({ ok: false, reason: "not-found" }), {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }

  const locale = url.searchParams.get("locale") === "en" ? "en" : "id";
  const content: CampaignContent = {
    subjectId: campaign.subjectId,
    preheaderId: campaign.preheaderId ?? "",
    bodyHtmlId: campaign.bodyHtmlId,
    subjectEn: campaign.subjectEn,
    preheaderEn: campaign.preheaderEn,
    bodyHtmlEn: campaign.bodyHtmlEn,
  };

  if (!content.subjectId.trim() || !content.preheaderId.trim() || !content.bodyHtmlId.trim()) {
    return new Response(JSON.stringify({ ok: false, reason: "missing-id" }), {
      status: 400,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }

  const siteUrl = env("PUBLIC_SITE_URL", "http://localhost:4321");
  const rendered = renderForRecipient({
    campaign: content,
    locale,
    email: "admin@example.com",
    unsubscribeUrl: `${siteUrl}/api/unsubscribe/preview`,
    linkRewrite: (u) => u,
  });

  return new Response(rendered.html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      // Composer meng-embed route ini via iframe — izinkan hanya same-origin.
      "Content-Security-Policy": "frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
