import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { issueClaimToken, upsertClaim } from "../../src/lib/access";
import { anonymizeContact, buildContactsCsv, getContactDetail, listContacts } from "../../src/lib/admin/contacts";
import { db } from "../../src/lib/db";
import { accessTokens, contacts, emailDeliveries, marketingSubscriptions, rewardCampaigns } from "../../src/lib/schema";
import { resetDb } from "../helpers";

describe("contacts admin", () => {
  beforeEach(resetDb);
  async function seed() {
    const [c1] = await db
      .insert(contacts)
      .values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" })
      .returning();
    const [c2] = await db.insert(contacts).values({ emailNormalized: "sari@yahoo.com" }).returning();
    const [camp] = await db.insert(rewardCampaigns).values({ slug: "c1", status: "published" }).returning();
    await upsertClaim(c1.id, camp.id);
    await db.insert(marketingSubscriptions).values({ contactId: c1.id, status: "active", subscribedAt: new Date() });
    return { c1, c2, camp };
  }
  it("lists with claims and filters", async () => {
    const { c1, c2, camp } = await seed();
    const all = await listContacts({ limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const confirmed = await listContacts({ status: "confirmed", limit: 10, offset: 0 });
    expect(confirmed.rows.map((r) => r.emailNormalized)).toEqual(["budi@gmail.com"]);
    const byCampaign = await listContacts({ campaignId: camp.id, limit: 10, offset: 0 });
    expect(byCampaign.rows.map((r) => r.id)).toContain(c1.id);
    const searched = await listContacts({ search: "sari", limit: 10, offset: 0 });
    expect(searched.rows).toHaveLength(1);
    // unsubscribed = status pada marketing_subscription
    expect(await listContacts({ status: "unsubscribed", limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
    await db
      .insert(marketingSubscriptions)
      .values({ contactId: c2.id, status: "unsubscribed", unsubscribedAt: new Date() });
    const unsub = await listContacts({ status: "unsubscribed", limit: 10, offset: 0 });
    expect(unsub.rows.map((r) => r.emailNormalized)).toEqual(["sari@yahoo.com"]);
  });
  it("csv has required columns and no secrets, and audits export", async () => {
    const { c1 } = await seed();
    const csv = await buildContactsCsv({ limit: 100, offset: 0 }, { adminUserId: null, ip: "1.1.1.1" });
    expect(csv.split("\n")[0]).toBe(
      "email,locale,confirmation_status,marketing_status,subscribed_at,unsubscribed_at,created_at,reward_claims",
    );
    expect(csv).toContain("budi@gmail.com");
    expect(csv).not.toContain("token");
    const { adminAuditLog } = await import("../../src/lib/schema");
    expect(await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "contacts_exported"))).toHaveLength(1);
  });
  it("anonymize masks email and deletes tokens", async () => {
    const { c1 } = await seed();
    await anonymizeContact(c1.id, { adminUserId: null, ip: "1.1.1.1" });
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c1.id));
    expect(row.emailNormalized).toBe(`deleted-${c1.id}@invalid.local`);
    expect(row.locale).toBe("id");
  });
  it("anonymize deletes access tokens but keeps claims and consents", async () => {
    const { c1, camp } = await seed();
    const claimId = await upsertClaim(c1.id, camp.id);
    await issueClaimToken(claimId, "access");
    expect(await db.select().from(accessTokens).where(eq(accessTokens.claimId, claimId))).toHaveLength(1);

    await anonymizeContact(c1.id, { adminUserId: null, ip: "1.1.1.1" });

    expect(await db.select().from(accessTokens).where(eq(accessTokens.claimId, claimId))).toHaveLength(0);
    const detail = await getContactDetail(c1.id);
    expect(detail).not.toBeNull();
    expect(detail?.claims).toHaveLength(1); // riwayat claim tetap
    const { adminAuditLog } = await import("../../src/lib/schema");
    expect(await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, "contact_anonymized"))).toHaveLength(1);
  });
  it("paginates with total across pages", async () => {
    await seed();
    const page1 = await listContacts({ limit: 1, offset: 0 });
    const page2 = await listContacts({ limit: 1, offset: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page2.total).toBe(2);
    expect(page1.rows[0].id).not.toBe(page2.rows[0].id);
    // urutan created_at desc → offset melewati total mengembalikan kosong
    const page3 = await listContacts({ limit: 1, offset: 2 });
    expect(page3.rows).toHaveLength(0);
    expect(page3.total).toBe(2);
  });
  it("contact detail includes email delivery history (desc, limit 20)", async () => {
    const { c1 } = await seed();
    // 21 baris: hanya 20 terbaru (createdAt desc) yang dikembalikan
    for (let i = 0; i < 21; i++) {
      await db.insert(emailDeliveries).values({
        contactId: c1.id,
        emailType: i === 0 ? "broadcast_test" : "broadcast",
        status: i === 1 ? "delivered" : "sent",
        sentAt: new Date(Date.now() - i * 60_000),
        deliveredAt: i === 1 ? new Date() : null,
        bouncedAt: null,
        createdAt: new Date(Date.now() - i * 1000),
      });
    }
    const detail = await getContactDetail(c1.id);
    expect(detail).not.toBeNull();
    expect(detail?.deliveries).toHaveLength(20);
    const d = detail?.deliveries[0];
    expect(d).toMatchObject({ emailType: "broadcast_test", status: "sent" });
    expect(d?.sentAt).toBeInstanceOf(Date);
    // baris kedua adalah broadcast delivered
    expect(detail?.deliveries[1]).toMatchObject({ emailType: "broadcast", status: "delivered" });
    expect(detail?.deliveries[1]?.deliveredAt).toBeInstanceOf(Date);
  });

  it("csv escapes fields containing commas or quotes", async () => {
    await db.insert(contacts).values({ emailNormalized: "a,b@test.com" }).returning();
    const csv = await buildContactsCsv({ limit: 100, offset: 0 }, { adminUserId: null, ip: "1.1.1.1" });
    const line = csv.split("\n").find((l) => l.includes("a,b@test.com"));
    // email berisi koma dibungkus kutip; created_at ISO (diakhiri kolom reward_claims kosong)
    expect(line?.startsWith('"a,b@test.com",id,pending,,,')).toBe(true);
    expect(line?.endsWith(",")).toBe(true);
  });
});
