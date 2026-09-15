import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { emailDomains } from "../schema";
import { audit } from "./audit";
import type { AuditOpts } from "./campaigns";

/**
 * Allowlist domain email penerima. Domain dinormalisasi lowercase;
 * validasi minimal: mengandung titik, tanpa @, tanpa spasi.
 */

export type DomainResult = { ok: true; domain: string } | { ok: false; reason: "invalid-domain" | "already-exists" };

export function validateDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  if (domain === "") return null;
  if (domain.includes("@") || /\s/.test(domain)) return null;
  if (!domain.includes(".")) return null;
  // Label: huruf/angka + hyphen, tidak kosong, tidak diawali/diakhiri hyphen.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return null;
  if (domain.length > 254) return null;
  return domain;
}

export async function addDomain(raw: string, auditOpts?: AuditOpts): Promise<DomainResult> {
  const domain = validateDomain(raw);
  if (!domain) return { ok: false, reason: "invalid-domain" };
  const inserted = await db
    .insert(emailDomains)
    .values({ domain })
    .onConflictDoNothing({ target: emailDomains.domain })
    .returning({ domain: emailDomains.domain });
  if (inserted.length === 0) return { ok: false, reason: "already-exists" };
  await audit("domain_added", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { domain },
  });
  return { ok: true, domain };
}

export async function setDomainActive(raw: string, active: boolean, auditOpts?: AuditOpts): Promise<DomainResult> {
  const domain = validateDomain(raw);
  if (!domain) return { ok: false, reason: "invalid-domain" };
  const updated = await db
    .update(emailDomains)
    .set({ active })
    .where(eq(emailDomains.domain, domain))
    .returning({ domain: emailDomains.domain });
  if (updated.length === 0) return { ok: false, reason: "invalid-domain" };
  await audit("domain_toggled", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { domain, active },
  });
  return { ok: true, domain };
}

export async function removeDomain(raw: string, auditOpts?: AuditOpts): Promise<DomainResult> {
  const domain = validateDomain(raw);
  if (!domain) return { ok: false, reason: "invalid-domain" };
  const deleted = await db
    .delete(emailDomains)
    .where(eq(emailDomains.domain, domain))
    .returning({ domain: emailDomains.domain });
  if (deleted.length === 0) return { ok: false, reason: "invalid-domain" };
  await audit("domain_removed", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { domain },
  });
  return { ok: true, domain };
}

export async function listDomains() {
  return db.select().from(emailDomains).orderBy(asc(emailDomains.domain));
}
