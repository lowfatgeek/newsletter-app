import { db } from "./db";
import { emailOutbox } from "./schema";

export type OutboxMessage = {
  emailType: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export async function enqueueTransactionalEmail(msg: OutboxMessage): Promise<void> {
  await db.insert(emailOutbox).values({
    emailType: msg.emailType,
    toEmail: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    idempotencyKey: msg.idempotencyKey,
  }).onConflictDoNothing();
}
