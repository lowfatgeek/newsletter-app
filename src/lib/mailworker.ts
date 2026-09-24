import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { sendViaEmailit } from "./emailit";
import { env } from "./env";
import { emailOutbox } from "./schema";

import {
  EMAIL_FROM_CAMPAIGN,
  EMAIL_FROM_TRANSACTIONAL,
  EMAIL_REPLY_TO_CAMPAIGN,
  EMAIL_REPLY_TO_TRANSACTIONAL,
} from "./templates";

const MAX_ATTEMPTS = 5;

export async function processOutbox(opts?: { fetchImpl?: typeof fetch }): Promise<{ sent: number; failed: number }> {
  // 1. Pemulihan baris "processing" yang macet/stale (mis. server mati saat pengiriman)
  // Kembalikan ke 'pending' jika sudah menggantung > 5 menit
  await db
    .update(emailOutbox)
    .set({ status: "pending" })
    .where(and(eq(emailOutbox.status, "processing"), sql`scheduled_at < now() - interval '5 minutes'`));

  // 2. Ambil dan kunci baris secara atomik dalam transaksi:
  // FOR UPDATE SKIP LOCKED di dalam transaksi memastikan baris terkunci,
  // lalu langsung ditandai "processing" sebelum commit.
  // Dua tick paralel/fast-drain tidak akan pernah mengambil baris yang sama.
  const batch = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.scheduledAt, new Date())))
      .orderBy(asc(emailOutbox.createdAt))
      .limit(20)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.update(emailOutbox).set({ status: "processing" }).where(inArray(emailOutbox.id, ids));

    return tx.select().from(emailOutbox).where(inArray(emailOutbox.id, ids));
  });

  let sent = 0;
  let failed = 0;
  for (const row of batch) {
    if (env("MOCK_EMAILIT", "false") === "true") {
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
      continue;
    }
    try {
      const isBroadcast = row.emailType.startsWith("broadcast");
      const from = isBroadcast ? EMAIL_FROM_CAMPAIGN : EMAIL_FROM_TRANSACTIONAL;
      const replyTo = isBroadcast ? EMAIL_REPLY_TO_CAMPAIGN : EMAIL_REPLY_TO_TRANSACTIONAL;
      await sendViaEmailit(
        {
          from,
          replyTo,
          to: row.toEmail,
          subject: row.subject,
          html: row.html,
          text: row.text,
          idempotencyKey: row.idempotencyKey,
        },
        opts?.fetchImpl,
      );
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db
          .update(emailOutbox)
          .set({ status: "failed", attempts, lastError: String(err).slice(0, 500) })
          .where(eq(emailOutbox.id, row.id));
        failed++;
      } else {
        const backoffMs = 2 ** attempts * 60_000;
        await db
          .update(emailOutbox)
          .set({
            status: "pending",
            attempts,
            lastError: String(err).slice(0, 500),
            scheduledAt: new Date(Date.now() + backoffMs),
          })
          .where(eq(emailOutbox.id, row.id));
      }
    }
  }
  return { sent, failed };
}
