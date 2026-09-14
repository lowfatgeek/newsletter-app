import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { processSubscribe } from "../../lib/subscribe";
import { env } from "../../lib/env";
import { clientIp } from "../../lib/ip";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

function cekEmailPath(locale: "id" | "en", errorSuffix: string, slug?: string): string {
  const base = `/${locale === "en" ? "en/cek-email" : "cek-email"}`;
  if (!slug) return `${base}${errorSuffix}`;
  // Slug bersifat publik — dibawa sebagai ?s= agar tombol "Kirim ulang" di
  // halaman cek-email menaut kembali ke landing campaign yang benar.
  const sep = errorSuffix ? "&" : "?";
  return `${base}${errorSuffix}${sep}s=${encodeURIComponent(slug)}`;
}

/**
 * POST /api/subscribe (form-encoded, no-JS friendly).
 * The response is ALWAYS a generic 302/303 to the "check your email" page —
 * it never reveals whether the email exists or whether processing succeeded.
 * For UI messaging, ok:false results append ?e=<reason>.
 */
export const POST: APIRoute = async ({ request }) => {
  const siteUrl = env("PUBLIC_SITE_URL", new URL(request.url).origin);
  // Redirect dibangun manual (bukan Response.redirect) supaya bisa menambah
  // Cache-Control: no-store — respons POST ini jangan pernah di-cache.
  const redirect = (path: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${siteUrl}${path}`, "Cache-Control": "no-store" },
    });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(cekEmailPath("id", "?e=bad-request"));
  }

  const slug = String(form.get("slug") ?? "");
  const locale = String(form.get("locale") ?? "id") === "en" ? "en" : "id";

  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp) return redirect(cekEmailPath(locale, "?e=campaign-unavailable"));

  const result = await processSubscribe({
    email: String(form.get("email") ?? ""),
    timerToken: String(form.get("timer_token") ?? ""),
    honeypot: String(form.get("website") ?? ""),
    ip: clientIp(request),
    campaignId: camp.id,
    siteUrl,
    locale,
  });

  return redirect(cekEmailPath(locale, result.ok ? "" : `?e=${result.reason}`, slug));
};
