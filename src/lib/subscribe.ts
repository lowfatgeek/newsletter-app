import { eq } from "drizzle-orm";
import { db } from "./db";
import { consentEvents, contacts, marketingSubscriptions, rewardCampaignLocales, rewardCampaigns, rewardClaims } from "./schema";
import { verifyTimerToken } from "./timer";
import { consumeRateLimit, hashIp } from "./ratelimit";
import { normalizeEmail, emailDomain } from "./email";
import { isDomainAllowed } from "./allowlist";
import { upsertClaim, issueClaimToken } from "./access";
import { enqueueTransactionalEmail } from "./outbox";
import { confirmationEmail, rewardAccessEmail, maskedEmail } from "./templates";
import { env } from "./env";

export type SubscribeInput = {
  email: string;
  timerToken: string;
  honeypot?: string;
  ip: string;
  campaignId: string;
  siteUrl: string;
  locale: "id" | "en";
  resubscribeConsent?: boolean;
};

export type SubscribeResult =
  | { ok: true; alreadyConfirmed: boolean }
  | {
      ok: false;
      reason: "bad-request" | "too-fast" | "rate-limited" | "domain-not-allowed" | "campaign-unavailable";
    };

function localizedPrefix(locale: "id" | "en"): string {
  return locale === "en" ? "en/" : "";
}

export async function processSubscribe(input: SubscribeInput): Promise<SubscribeResult> {
  // Honeypot: pretend success without touching anything (bot trap, generic response).
  if (input.honeypot) return { ok: true, alreadyConfirmed: false };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "bad-request" };

  const timer = verifyTimerToken(input.timerToken, input.campaignId);
  if (!timer.ok) return { ok: false, reason: timer.reason === "too-fast" ? "too-fast" : "bad-request" };

  const ipLimit = Number(env("RATE_LIMIT_IP_PER_HOUR", "10"));
  const emailLimit = Number(env("RATE_LIMIT_EMAIL_PER_HOUR", "5"));
  if (!(await consumeRateLimit("ip", hashIp(input.ip), ipLimit))) return { ok: false, reason: "rate-limited" };
  if (!(await consumeRateLimit("email", email, emailLimit))) return { ok: false, reason: "rate-limited" };

  if (!(await isDomainAllowed(emailDomain(email)))) return { ok: false, reason: "domain-not-allowed" };

  // Only published campaigns accept submissions.
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, input.campaignId));
  if (!camp || camp.status !== "published") return { ok: false, reason: "campaign-unavailable" };

  const locales = await db.select().from(rewardCampaignLocales).where(eq(rewardCampaignLocales.campaignId, input.campaignId));
  const loc = locales.find((l) => l.locale === input.locale) ?? locales.find((l) => l.locale === "id");
  if (!loc) return { ok: false, reason: "campaign-unavailable" };

  // Upsert atomik: insert dengan onConflictDoNothing menghindari race
  // select-then-insert (dua request konkuren bisa sama-sama gagal select dan
  // lalu salah satu insert menabrak constraint unik → 500). Bila insert tidak
  // mengembalikan baris (sudah ada), ambil baris yang sudah ada.
  let [contact] = await db
    .insert(contacts)
    .values({ emailNormalized: email, locale: input.locale })
    .onConflictDoNothing({ target: contacts.emailNormalized })
    .returning();
  if (!contact) {
    [contact] = await db.select().from(contacts).where(eq(contacts.emailNormalized, email));
  }
  const claimId = await upsertClaim(contact.id, input.campaignId);

  if (contact.confirmationStatus === "confirmed") {
    // Re-subscribe eksplisit (PRD 7.1, task 01-F1): kontak yang berhenti
    // berlangganan hanya diaktifkan kembali lewat checkbox consent. Tanpa
    // centang, reward access email tetap dikirim tapi status marketing
    // 'unsubscribed' dihormati apa adanya.
    if (input.resubscribeConsent) {
      const [sub] = await db
        .select()
        .from(marketingSubscriptions)
        .where(eq(marketingSubscriptions.contactId, contact.id));
      if (sub?.status === "unsubscribed") {
        await db
          .update(marketingSubscriptions)
          .set({ status: "active", subscribedAt: new Date(), unsubscribedAt: null })
          .where(eq(marketingSubscriptions.contactId, contact.id));
        await db.insert(consentEvents).values({ contactId: contact.id, event: "resubscribed" });
      }
    }
    // Already confirmed: hand out a fresh access link, no double opt-in again.
    const raw = await issueClaimToken(claimId, "access");
    const url = `${input.siteUrl}/${localizedPrefix(input.locale)}akses/${raw}`;
    const m = rewardAccessEmail(input.locale, url, loc.title);
    await enqueueTransactionalEmail({
      emailType: "reward_access",
      to: email,
      ...m,
      idempotencyKey: `access-${claimId}-${raw.slice(0, 12)}`,
    });
    await db.update(rewardClaims).set({ lastAccessSentAt: new Date(), status: "access_sent" }).where(eq(rewardClaims.id, claimId));
    void import("./mailworker").then((w) => w.processOutbox()).catch(() => {}); // best-effort fast drain
    return { ok: true, alreadyConfirmed: true };
  }

  const raw = await issueClaimToken(claimId, "confirm");
  const url = `${input.siteUrl}/${localizedPrefix(input.locale)}konfirmasi/${raw}`;
  const m = confirmationEmail(input.locale, url);
  await enqueueTransactionalEmail({
    emailType: "confirmation",
    to: email,
    ...m,
    idempotencyKey: `confirm-${claimId}-${raw.slice(0, 12)}`,
  });
  await db.update(rewardClaims).set({ lastAccessSentAt: new Date() }).where(eq(rewardClaims.id, claimId));
  void import("./mailworker").then((w) => w.processOutbox()).catch(() => {}); // best-effort fast drain
  return { ok: true, alreadyConfirmed: false };
}

export { maskedEmail };
