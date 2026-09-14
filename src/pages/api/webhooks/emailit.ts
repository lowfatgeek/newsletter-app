import type { APIRoute } from "astro";
import { processEmailitEvent, verifyEmailitSignature } from "../../../lib/broadcast/webhooks";
import { clientIp } from "../../../lib/ip";
import { consumeRateLimit, hashIp } from "../../../lib/ratelimit";

/**
 * POST /api/webhooks/emailit — endpoint webhook provider Emailit.
 *
 * Signature diverifikasi terhadap RAW body (`await request.text()`) SEBELUM
 * parse JSON — HMAC dihitung atas byte persis yang dikirim provider.
 * Gagal signature → 401 (event tidak disentuh); body bukan JSON valid → 400.
 * Selain itu selalu 200 dengan hasil pemrosesan (recorded | ignored |
 * unknown-message) agar provider tidak retry karena kondisi aplikatif.
 * Cache-Control: no-store — respons webhook tidak boleh di-cache.
 */
export const prerender = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();

  if (!verifyEmailitSignature(rawBody, request.headers.get("x-emailit-signature"))) {
    return json(401, { error: "invalid-signature" });
  }

  let parsed: { type?: unknown; message_id?: unknown; recipient_email?: unknown };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid-json" });
  }

  // Rate limit SESUDAH verifikasi HMAC: request tanpa signature valid tidak
  // menghabiskan budget identitas valid, dan penyerang tanpa secret tidak
  // bisa memicu kerja DB. Identitas = message_id bila ada, else hash IP.
  const messageId = typeof parsed.message_id === "string" ? parsed.message_id : "";
  const identity = messageId !== "" ? messageId : hashIp(clientIp(request));
  if (!(await consumeRateLimit("webhook", identity, 600))) {
    return json(429, { error: "too-many-requests" });
  }

  const result = await processEmailitEvent({
    type: typeof parsed.type === "string" ? parsed.type : "",
    message_id: messageId !== "" ? messageId : undefined,
    recipient_email: typeof parsed.recipient_email === "string" ? parsed.recipient_email : undefined,
    raw: parsed,
  });

  return json(200, { result });
};

export const GET: APIRoute = async () => json(405, { error: "method-not-allowed" });
