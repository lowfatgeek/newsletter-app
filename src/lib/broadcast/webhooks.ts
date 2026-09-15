import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { normalizeEmail } from "../email";
import { env } from "../env";
import { emailDeliveries, emailProviderEvents, emailSuppressions } from "../schema";

/**
 * Verifikasi signature webhook Emailit.
 *
 * Signature = HMAC-SHA256 hex dari RAW body (persis apa yang diterima,
 * sebelum parse JSON) dengan kunci EMAILIT_WEBHOOK_SECRET. Perbandingan
 * timing-safe dengan guard panjang buffer yang sama (pola packToken).
 */
export function verifyEmailitSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", env("EMAILIT_WEBHOOK_SECRET")).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Guard: status terminal tidak boleh diturunkan ke failed. */
function isTerminal(status: string): boolean {
  return status === "delivered" || status === "bounced";
}

/**
 * Proses satu event webhook Emailit.
 *
 * Selalu simpan raw event ke email_provider_events dulu (audit) — idempoten
 * via unique (provider_message_id, event_type); duplicate → "ignored".
 * Mapping ke email_deliveries hanya bila message_id ada DAN delivery-nya
 * ditemukan; selain itu "unknown-message" (event tetap tersimpan).
 *
 * deliveredAt/bouncedAt memakai semantik coalesce: tidak pernah ditimpa
 * jika sudah terisi sebelumnya.
 */
export async function processEmailitEvent(event: {
  type: string;
  message_id?: string;
  recipient_email?: string;
  raw: unknown;
}): Promise<"recorded" | "ignored" | "unknown-message"> {
  const messageId = event.message_id ?? "no-message-id";

  const inserted = await db
    .insert(emailProviderEvents)
    .values({
      providerMessageId: messageId,
      eventType: event.type,
      payload: event.raw as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: emailProviderEvents.id });

  if (inserted.length === 0) return "ignored";
  if (!event.message_id) return "unknown-message";

  const [delivery] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.providerMessageId, event.message_id));
  if (!delivery) return "unknown-message";

  const now = new Date();

  switch (event.type) {
    case "email.delivered": {
      await db
        .update(emailDeliveries)
        .set({ status: "delivered", deliveredAt: delivery.deliveredAt ?? now })
        .where(eq(emailDeliveries.id, delivery.id));
      return "recorded";
    }
    case "email.bounced": {
      await db
        .update(emailDeliveries)
        .set({ status: "bounced", bouncedAt: delivery.bouncedAt ?? now })
        .where(eq(emailDeliveries.id, delivery.id));

      // Suppression hard bounce — hanya bila recipient_email valid;
      // email invalid tidak boleh membuat event gagal diproses.
      const normalized = event.recipient_email ? normalizeEmail(event.recipient_email) : null;
      if (normalized) {
        await db
          .insert(emailSuppressions)
          .values({ emailNormalized: normalized, reason: "hard_bounce" })
          .onConflictDoNothing();
      }
      return "recorded";
    }
    case "email.complaint": {
      await db.update(emailDeliveries).set({ status: "suppressed" }).where(eq(emailDeliveries.id, delivery.id));

      const normalized = event.recipient_email ? normalizeEmail(event.recipient_email) : null;
      if (normalized) {
        await db
          .insert(emailSuppressions)
          .values({ emailNormalized: normalized, reason: "complaint" })
          .onConflictDoNothing();
      }
      return "recorded";
    }
    case "email.failed": {
      if (!isTerminal(delivery.status)) {
        await db.update(emailDeliveries).set({ status: "failed" }).where(eq(emailDeliveries.id, delivery.id));
      }
      return "recorded";
    }
    default:
      // Tipe tidak dikenal: event sudah tersimpan untuk audit, delivery tidak diubah.
      return "recorded";
  }
}
