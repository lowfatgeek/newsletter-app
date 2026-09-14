import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { rewardCampaigns } from "../../lib/schema";
import { issueTimerToken } from "../../lib/timer";

// Route on-demand — tidak pernah diprerender.
export const prerender = false;

/**
 * POST /api/timer-token  body: { slug: string }
 * Refreshes the anti-instant-submit timer token for a published campaign.
 * Without JS, the server-rendered token in the page is used instead (PRD 7.1).
 */
export const POST: APIRoute = async ({ request }) => {
  let slug: string | undefined;
  try {
    ({ slug } = (await request.json()) as { slug?: string });
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!slug) return new Response("bad request", { status: 400 });

  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, slug));
  if (!camp || camp.status !== "published") return new Response("not found", { status: 404 });

  return new Response(JSON.stringify({ token: issueTimerToken(camp.id) }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
