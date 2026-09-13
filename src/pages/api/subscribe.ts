import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { processSubscribe } from "../../lib/subscribe";
import { env } from "../../lib/env";

function cekEmailPath(locale: "id" | "en", errorSuffix: string): string {
  return `/${locale === "en" ? "en/cek-email" : "cek-email"}${errorSuffix}`;
}

/**
 * POST /api/subscribe (form-encoded, no-JS friendly).
 * The response is ALWAYS a generic 302/303 to the "check your email" page —
 * it never reveals whether the email exists or whether processing succeeded.
 * For UI messaging, ok:false results append ?e=<reason>.
 */
export const POST: APIRoute = async ({ request }) => {
  const siteUrl = env("PUBLIC_SITE_URL", new URL(request.url).origin);
  const redirect = (path: string) => Response.redirect(`${siteUrl}${path}`, 303);

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
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0",
    campaignId: camp.id,
    siteUrl,
    locale,
  });

  return redirect(cekEmailPath(locale, result.ok ? "" : `?e=${result.reason}`));
};
