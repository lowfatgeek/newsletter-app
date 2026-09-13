import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { emailDomains } from "./schema";

export const DEFAULT_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me",
];

export async function isDomainAllowed(domain: string): Promise<boolean> {
  const rows = await db.select().from(emailDomains)
    .where(and(eq(emailDomains.domain, domain.toLowerCase()), eq(emailDomains.active, true)))
    .limit(1);
  return rows.length > 0;
}
