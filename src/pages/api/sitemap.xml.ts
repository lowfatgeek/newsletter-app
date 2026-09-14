import type { APIRoute } from "astro";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { env } from "../../lib/env";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * GET /api/sitemap.xml — publik. Hanya campaign published + indexable
 * (PRD §SEO), tiap slug di-emit dua URL: /r/<slug> dan /en/r/<slug>.
 */
export const GET: APIRoute = async ({ request }) => {
  const siteUrl = env("PUBLIC_SITE_URL", new URL(request.url).origin);

  const rows = await db
    .select({
      slug: rewardCampaigns.slug,
      publishedAt: rewardCampaigns.publishedAt,
      createdAt: rewardCampaigns.createdAt,
    })
    .from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.status, "published"), eq(rewardCampaigns.indexable, true)))
    .orderBy(asc(rewardCampaigns.sortOrder), asc(rewardCampaigns.slug));

  const urls = rows
    .map((r) => {
      const lastmod = (r.publishedAt ?? r.createdAt).toISOString();
      return [`/r/${r.slug}`, `/en/r/${r.slug}`]
        .map(
          (path) =>
            `  <url><loc>${escapeXml(siteUrl)}${escapeXml(path)}</loc><lastmod>${lastmod}</lastmod></url>`,
        )
        .join("\n");
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
