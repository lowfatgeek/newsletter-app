import { env } from "./env";
import { EMAIL_REPLY_TO } from "./templates";

export type ProviderMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
};

export async function sendViaEmailit(msg: ProviderMessage, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl("https://api.emailit.com/v1/emails", {
    method: "POST",
    // Timeout eksplisit (task 2.1): tanpa ini koneksi pihak ketiga yang
    // menggantung menahan satu slot worker tanpa batas.
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${env("EMAILIT_API_KEY")}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: msg.from,
      to: [msg.to],
      reply_to: msg.replyTo ?? EMAIL_REPLY_TO,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Emailit ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}
