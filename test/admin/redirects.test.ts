import { beforeEach, describe, expect, it } from "vitest";
import { changeSlug, createCampaign, resolveSlugRedirect, setCampaignStatus } from "../../src/lib/admin/campaigns";
import { resetDb } from "../helpers";

describe("resolveSlugRedirect", () => {
  beforeEach(resetDb);

  it("returns null for unknown slug", async () => {
    expect(await resolveSlugRedirect("tidak-ada")).toBeNull();
  });

  it("resolves old slug to the campaign's CURRENT slug after confirmed rename", async () => {
    const created = await createCampaign({ slug: "a" });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : "";
    await setCampaignStatus(id, "publish");
    // Rename campaign yang sudah published butuh konfirmasi.
    expect((await changeSlug(id, "b", true)).ok).toBe(true);
    expect(await resolveSlugRedirect("a")).toBe("b");

    // Rename lagi ke "c": resolver harus mengikuti slug TERKINI, bukan slug
    // yang tertulis di baris redirect lama.
    expect((await changeSlug(id, "c", true)).ok).toBe(true);
    expect(await resolveSlugRedirect("a")).toBe("c");
    expect(await resolveSlugRedirect("b")).toBe("c");
  });
});
