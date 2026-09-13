import { env } from "./env";

export type ProviderMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export async function sendViaEmailit(msg: ProviderMessage, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl("https://api.emailit.com/v1/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("EMAILIT_API_KEY")}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Emailit ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}
