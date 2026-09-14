import { test, expect } from "@playwright/test";
import postgres from "postgres";
import "dotenv/config";

test.setTimeout(120_000);

test("launch: sitemap hanya memuat campaign published + indexable (ID + EN)", async ({ request }) => {
  // Seed membuat starter-kit published tapi non-indexable (default skema) —
  // opt-in eksplisit di sini agar test repeatable; seed tidak me-resetnya.
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`update reward_campaign set indexable = true where slug = 'starter-kit'`;
    await sql`
      insert into reward_campaign (slug, status, indexable)
      values ('launch-e2e-tak-index', 'published', false)
      on conflict (slug) do update set status = 'published', indexable = false
    `;

    const res = await request.get("/api/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/xml");

    const body = await res.text();
    expect(body).toContain("/r/starter-kit");
    expect(body).toContain("/en/r/starter-kit");
    expect(body).not.toContain("launch-e2e-tak-index");
  } finally {
    await sql.end();
  }
});
