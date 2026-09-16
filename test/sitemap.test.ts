import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { rewardCampaignLocales, rewardCampaigns } from "../src/lib/schema";
import { GET } from "../src/pages/api/sitemap.xml";
import { resetDb, setEnv } from "./helpers";

async function insertCampaign(slug: string, status: "published" | "draft", indexable: boolean) {
  const [camp] = await db.insert(rewardCampaigns).values({ slug, status, indexable }).returning();
  await db.insert(rewardCampaignLocales).values({
    campaignId: camp.id,
    locale: "id",
    title: `KelasWFA ${slug}`,
    description: `Deskripsi campaign ${slug}.`,
  });
  return camp;
}

describe("GET /api/sitemap.xml", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ PUBLIC_SITE_URL: "https://contoh.test" });
  });

  it("only includes published+indexable campaigns, both locales", async () => {
    await insertCampaign("boleh", "published", true);
    await insertCampaign("tak-boleh", "published", false);
    await insertCampaign("draf", "draft", true);

    const res = await GET({ request: new Request("https://contoh.test/api/sitemap.xml") } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");

    const body = await res.text();
    expect(body).toContain("<loc>https://contoh.test/r/boleh</loc>");
    expect(body).toContain("<loc>https://contoh.test/en/r/boleh</loc>");
    expect(body).not.toContain("tak-boleh");
    expect(body).not.toContain("draf");
  });

  it("root sitemap exports identical handler", async () => {
    const { GET: rootGET } = await import("../src/pages/sitemap.xml");
    await insertCampaign("root-test", "published", true);
    const res = await rootGET({ request: new Request("https://contoh.test/sitemap.xml") } as any);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<loc>https://contoh.test/r/root-test</loc>");
  });
});
