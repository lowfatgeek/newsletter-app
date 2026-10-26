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

const DEFAULT_MAX_PER_SECOND = 2;
let nextSendAt = 0;
let sendQueue: Promise<void> = Promise.resolve();

function maxPerSecond(): number {
  const parsed = Number.parseInt(process.env.EMAILIT_MAX_PER_SECOND ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 100) : DEFAULT_MAX_PER_SECOND;
}

/**
 * Batasi laju mulai request lintas semua pemanggil (transaksional + broadcast).
 * Tanpa ini, satu batch outbox 20 baris menembak Emailit beruntun dan kena 429.
 */
function paceSendStart(): Promise<void> {
  const turn = sendQueue.then(async () => {
    const waitMs = nextSendAt - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextSendAt = Date.now() + Math.ceil(1000 / maxPerSecond());
  });
  sendQueue = turn.catch(() => {});
  return turn;
}

export async function sendViaEmailit(msg: ProviderMessage, fetchImpl?: typeof fetch): Promise<string | null> {
  // Transport kustom (mis. test) dianggap mengatur laju sendiri; pacing hanya
  // untuk transport default yang menembak provider langsung.
  if (!fetchImpl) await paceSendStart();
  const doFetch = fetchImpl ?? fetch;
  // Emailit mematikan /v1 (edge membalas 502 kosong); /v2 memakai skema body yang sama.
  const res = await doFetch("https://api.emailit.com/v2/emails", {
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
