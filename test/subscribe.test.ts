import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  contacts,
  emailDomains,
  emailOutbox,
  rewardCampaignLocales,
  rewardCampaigns,
} from "../src/lib/schema";
import { processSubscribe } from "../src/lib/subscribe";
import { issueTimerToken } from "../src/lib/timer";
import { resetDb, setEnv } from "./helpers";

// Timer tokens must be at least 30s old to verify; produce an already-aged
// token instead of sleeping (issueTimerToken accepts an explicit issuedAt).
const agedToken = (campaignId: string) => issueTimerToken(campaignId, Date.now() - 31_000);

async function insertCampaign(slug: string, status: "published" | "draft") {
  const [camp] = await db.insert(rewardCampaigns).values({ slug, status }).returning();
  await db.insert(rewardCampaignLocales).values({
    campaignId: camp.id,
    locale: "id",
    title: `KelasWFA ${slug}`,
    description: `Deskripsi campaign ${slug}.`,
  });
  return camp;
}

let camp: typeof rewardCampaigns.$inferSelect;

const input = (over: Partial<Parameters<typeof processSubscribe>[0]> = {}) => ({
  email: "budi@gmail.com",
  timerToken: "",
  honeypot: "",
  ip: "1.2.3.4",
  campaignId: camp.id,
  siteUrl: "http://localhost:4321",
  locale: "id" as const,
  ...over,
});

describe("processSubscribe", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ MOCK_EMAILIT: "true" });
    await db.insert(emailDomains).values({ domain: "gmail.com" });
    camp = await insertCampaign("starter", "published");
  });

  it("rejects timer token younger than 30s", async () => {
    const r = await processSubscribe(input({ timerToken: issueTimerToken(camp.id) }));
    expect(r).toEqual({ ok: false, reason: "too-fast" });
  });

  it("rejects invalid timer token as bad-request", async () => {
    const r = await processSubscribe(input({ timerToken: "garbage" }));
    expect(r).toEqual({ ok: false, reason: "bad-request" });
  });

  it("rejects honeypot silently but generically", async () => {
    const r = await processSubscribe(input({ honeypot: "http://spam", timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: false });
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("rejects malformed email as bad-request", async () => {
    const r = await processSubscribe(input({ email: "not-an-email", timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: false, reason: "bad-request" });
  });

  it("rejects domain outside allowlist", async () => {
    const r = await processSubscribe(input({ email: "x@evil.example", timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: false, reason: "domain-not-allowed" });
  });

  it("rejects campaign that is not published", async () => {
    const draft = await insertCampaign("draft-camp", "draft");
    const r = await processSubscribe(input({ timerToken: agedToken(draft.id), campaignId: draft.id }));
    expect(r).toEqual({ ok: false, reason: "campaign-unavailable" });
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("rate-limits per ip after 10 submits", async () => {
    const token = agedToken(camp.id);
    for (let i = 0; i < 10; i++) {
      await processSubscribe(input({ email: `u${i}@gmail.com`, timerToken: token }));
    }
    const r = await processSubscribe(input({ email: "u99@gmail.com", timerToken: token }));
    expect(r).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("new contact: creates contact pending + claim + confirmation email", async () => {
    const r = await processSubscribe(input({ timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: false });
    const [c] = await db.select().from(contacts).where(eq(contacts.emailNormalized, "budi@gmail.com"));
    expect(c.confirmationStatus).toBe("pending");
    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0].emailType).toBe("confirmation");
  });

  it("confirmed contact: access email without re-opt-in, no duplicate claim", async () => {
    await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    const r = await processSubscribe(input({ timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: true, alreadyConfirmed: true });
    const mails = await db.select().from(emailOutbox);
    expect(mails[0].emailType).toBe("reward_access");
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("email rate limit: 5 per hour for same email", async () => {
    await db.insert(contacts).values({ emailNormalized: "budi@gmail.com", confirmationStatus: "confirmed" }).returning();
    for (let i = 0; i < 5; i++) {
      const r = await processSubscribe(input({ timerToken: agedToken(camp.id) }));
      expect(r).toEqual({ ok: true, alreadyConfirmed: true });
    }
    const r = await processSubscribe(input({ timerToken: agedToken(camp.id) }));
    expect(r).toEqual({ ok: false, reason: "rate-limited" });
  });
});
