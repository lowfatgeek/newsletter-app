import { randomBytes } from "node:crypto";
import { packToken, unpackToken } from "./crypto";

const MIN_AGE_MS = 30_000;
const MAX_AGE_MS = 2 * 60 * 60_000;

type TimerPayload = { c: string; n: string; iat: number };

export function issueTimerToken(campaignId: string, issuedAt = Date.now()): string {
  return packToken({ c: campaignId, n: randomBytes(12).toString("base64url"), iat: issuedAt } satisfies TimerPayload);
}

export function verifyTimerToken(token: string, campaignId: string):
  | { ok: true } | { ok: false; reason: "invalid" | "wrong-campaign" | "too-fast" | "expired" } {
  const payload = unpackToken<TimerPayload>(token);
  if (!payload || typeof payload.c !== "string" || typeof payload.iat !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (payload.c !== campaignId) return { ok: false, reason: "wrong-campaign" };
  const age = Date.now() - payload.iat;
  if (age < MIN_AGE_MS) return { ok: false, reason: "too-fast" };
  if (age > MAX_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}
