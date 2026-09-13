import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "./db";
import { emailOutbox } from "./schema";
import { env } from "./env";
import { sendViaEmailit } from "./emailit";

const MAX_ATTEMPTS = 5;
const FROM = "KelasWFA <admin@kelaswfa.my.id>";

export async function processOutbox(opts?: { fetchImpl?: typeof fetch }): Promise<{ sent: number; failed: number }> {
  const batch = await db.select().from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.scheduledAt, new Date())))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(20);

  let sent = 0;
  let failed = 0;
  for (const row of batch) {
    if (env("MOCK_EMAILIT", "false") === "true") {
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
      continue;
    }
    try {
      await sendViaEmailit({
        from: FROM,
        to: row.toEmail,
        subject: row.subject,
        html: row.html,
        text: row.text,
        idempotencyKey: row.idempotencyKey,
      }, opts?.fetchImpl);
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.update(emailOutbox)
          .set({ status: "failed", attempts, lastError: String(err).slice(0, 500) })
          .where(eq(emailOutbox.id, row.id));
        failed++;
      } else {
        const backoffMs = Math.pow(2, attempts) * 60_000;
        await db.update(emailOutbox)
          .set({ attempts, lastError: String(err).slice(0, 500), scheduledAt: new Date(Date.now() + backoffMs) })
          .where(eq(emailOutbox.id, row.id));
      }
    }
  }
  return { sent, failed };
}
