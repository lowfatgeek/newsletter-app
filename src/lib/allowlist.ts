import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { emailDomains } from "./schema";

export const DEFAULT_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
];

export async function isDomainAllowed(domain: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(emailDomains)
    .where(and(eq(emailDomains.domain, domain.toLowerCase()), eq(emailDomains.active, true)))
    .limit(1);
  return rows.length > 0;
}

const POPULAR_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];

function sortDomains(domains: string[]): string[] {
  return [...domains].sort((a, b) => {
    const ai = POPULAR_DOMAINS.indexOf(a);
    const bi = POPULAR_DOMAINS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Mengambil daftar domain yang aktif untuk ditampilkan pada placeholder form klaim.
 * Diurutkan dengan domain umum (gmail, yahoo, hotmail, outlook) di awal.
 */
export async function listActiveDomains(): Promise<string[]> {
  try {
    const rows = await db
      .select({ domain: emailDomains.domain })
      .from(emailDomains)
      .where(eq(emailDomains.active, true));

    if (rows.length > 0) {
      return sortDomains(rows.map((r) => r.domain));
    }
  } catch {
    // Fallback jika query database gagal
  }
  return sortDomains(DEFAULT_DOMAINS);
}
