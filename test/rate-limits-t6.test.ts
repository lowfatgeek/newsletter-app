import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "../src/lib/db";
import {
  contacts, rewardCampaigns, rewardAssets, rewardClaims,
  emailCampaigns, emailCampaignRecipients,
} from "../src/lib/schema";
import { issueSessionToken, upsertClaim } from "../src/lib/access";
import { consumeRateLimit } from "../src/lib/ratelimit";
import { hashToken, generateOpaqueToken } from "../src/lib/crypto";
import { resetDb, setEnv } from "./helpers";
import { GET as downloadGET } from "../src/pages/api/download/[session]/[assetId]";
import { POST as timerPOST } from "../src/pages/api/timer-token";
import { GET as unsubGET } from "../src/pages/api/unsubscribe/[token]";
import { POST as resubPOST } from "../src/pages/api/unsubscribe/resubscribe";
import { POST as webhookPOST } from "../src/pages/api/webhooks/emailit";

const SECRET = "whsec-test-123";
function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function req(url: string, init?: RequestInit & { ip?: string }): Request {
  const headers = new Headers(init?.headers);
  if (init?.ip && !headers.has("x-forwarded-for")) headers.set("x-forwarded-for", init.ip);
  return new Request(url, { ...init, headers });
}

async function seedReward() {
  const [c] = await db.insert(contacts).values({ emailNormalized: "budi@gmail.com" }).returning();
  const [camp] = await db.insert(rewardCampaigns).values({ slug: "t6", status: "published" }).returning();
  const [asset] = await db.insert(rewardAssets).values({
    campaignId: camp.id, storageKey: "rewards/a.pdf", nameId: "File A",
    mimeType: "application/pdf", sizeBytes: 1024, checksum: "x",
  }).returning();
  const claimId = await upsertClaim(c.id, camp.id);
  const session = await issueSessionToken(claimId);
  return { camp, asset, session };
}

async function seedRecipientToken() {
  const [contact] = await db.insert(contacts).values({ emailNormalized: "u@gmail.com", confirmationStatus: "confirmed" }).returning();
  const [camp] = await db.insert(emailCampaigns).values({
    subjectId: "Halo", preheaderId: "p", bodyHtmlId: "<p>hai</p>",
    audienceFilter: { all: true }, maxPerMinute: 60, maxPerHour: 600,
  }).returning();
  const token = generateOpaqueToken();
  await db.insert(emailCampaignRecipients).values({
    campaignId: camp.id, contactId: contact.id, localeSelected: "id",
    clickTokenHash: hashToken(token),
  });
  return { token };
}

beforeEach(async () => {
  await resetDb();
  setEnv({
    R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s",
    R2_BUCKET: "b", EMAILIT_WEBHOOK_SECRET: SECRET,
  });
});

describe("T6 rate limits", () => {
  it("download: 30/jam per IP lalu 429, token invalid tetap 403", async () => {
    const { asset, session } = await seedReward();
    const good = `http://localhost/api/download/${session}/${asset.id}`;
    const bad = `http://localhost/api/download/bad/${asset.id}`;
    // token invalid sebelum limit → 403
    const r403 = await downloadGET({ params: { session: "bad", assetId: asset.id }, request: req(bad, { ip: "10.9.9.9" }) } as never);
    expect(r403.status).toBe(403);
    // habiskan budget 30 dengan IP lain
    for (let i = 0; i < 30; i++) {
      const r = await downloadGET({ params: { session, assetId: asset.id }, request: req(good, { ip: "10.8.8.8" }) } as never);
      expect(r.status).toBe(302);
    }
    const limited = await downloadGET({ params: { session, assetId: asset.id }, request: req(good, { ip: "10.8.8.8" }) } as never);
    expect(limited.status).toBe(429);
  });

  it("timer-token: 60/jam per IP lalu 429", async () => {
    const { camp } = await seedReward();
    const body = JSON.stringify({ slug: camp.slug });
    const mk = (ip: string) => timerPOST({ request: req("http://localhost/api/timer-token", { method: "POST", body, ip }) } as never);
    expect((await mk("10.7.7.7")).status).toBe(200);
    for (let i = 0; i < 59; i++) await mk("10.7.7.7");
    expect((await mk("10.7.7.7")).status).toBe(429);
    // IP lain tidak kena
    expect((await mk("10.7.7.8")).status).toBe(200);
  });

  it("unsubscribe GET: sebelum limit token valid 303 konfirmasi, sesudah limit 303 invalid generik", async () => {
    const { token } = await seedRecipientToken();
    const url = `http://localhost/api/unsubscribe/${token}`;
    const ok = await unsubGET({ params: { token }, request: req(url, { ip: "10.6.6.6" }) } as never);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe(`/batal-berlangganan/${token}`);
    // habiskan sisa budget (1 sudah dipakai) → 29 lagi
    for (let i = 0; i < 29; i++) {
      await unsubGET({ params: { token: "invalid" }, request: req(url, { ip: "10.6.6.6" }) } as never);
    }
    const limited = await unsubGET({ params: { token }, request: req(url, { ip: "10.6.6.6" }) } as never);
    expect(limited.status).toBe(303);
    expect(limited.headers.get("Location")).toBe("/batal-berlangganan/invalid");
    // token invalid biasa (IP segar) tetap 303 invalid — tidak dibedakan
    const inv = await unsubGET({ params: { token: "tidak-ada" }, request: req(url, { ip: "10.6.6.7" }) } as never);
    expect(inv.status).toBe(303);
    expect(inv.headers.get("Location")).toBe("/batal-berlangganan/invalid");
  });

  it("resubscribe POST: sesudah limit 303 invalid generik", async () => {
    const { token } = await seedRecipientToken();
    const url = "http://localhost/api/unsubscribe/resubscribe";
    const form = new FormData();
    form.set("token", token);
    for (let i = 0; i < 30; i++) {
      const f = new FormData();
      f.set("token", "invalid");
      await resubPOST({ request: req(url, { method: "POST", body: f, ip: "10.5.5.5" }) } as never);
    }
    const limited = await resubPOST({ request: req(url, { method: "POST", body: form, ip: "10.5.5.5" }) } as never);
    expect(limited.status).toBe(303);
    expect(limited.headers.get("Location")).toBe("/batal-berlangganan/invalid");
    // IP segar + token valid tetap 303 sukses
    const ok = await resubPOST({ request: req(url, { method: "POST", body: form, ip: "10.5.5.6" }) } as never);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe(`/subscribe-again/${token}?ok=1`);
  });

  it("webhook: tanpa signature valid tidak menyentuh budget (401 tanpa consume); 600 valid lalu 429", async () => {
    const url = "http://localhost/api/webhooks/emailit";
    const noSig = await webhookPOST({ request: req(url, { method: "POST", body: "{}", ip: "10.4.4.4" }) } as never);
    expect(noSig.status).toBe(401);
    // request invalid-signature tidak consume — buktikan via bucket message_id:
    // 600 request valid dengan message_id sama → 200 semua; ke-601 → 429.
    for (let i = 0; i < 600; i++) {
      const body = JSON.stringify({ type: "email.sent", message_id: "t6-flood" });
      const r = await webhookPOST({
        request: req(url, { method: "POST", body, ip: "10.4.4.4", headers: { "x-emailit-signature": sign(body) } }),
      } as never);
      expect(r.status).toBe(200);
    }
    const flood = JSON.stringify({ type: "email.sent", message_id: "t6-flood" });
    const limited = await webhookPOST({
      request: req(url, { method: "POST", body: flood, ip: "10.4.4.4", headers: { "x-emailit-signature": sign(flood) } }),
    } as never);
    expect(limited.status).toBe(429);
    // message_id lain tidak kena
    const other = JSON.stringify({ type: "email.sent", message_id: "t6-lain" });
    const okOther = await webhookPOST({
      request: req(url, { method: "POST", body: other, ip: "10.4.4.4", headers: { "x-emailit-signature": sign(other) } }),
    } as never);
    expect(okOther.status).toBe(200);
    void consumeRateLimit;
  });
});
