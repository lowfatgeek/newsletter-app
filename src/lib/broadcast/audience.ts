import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contacts, emailSuppressions, marketingSubscriptions, rewardClaims,
} from "../schema";

export type AudienceLocale = "id" | "en";
export type AudienceClaimMode = "ANY" | "ALL";

export interface AudienceFilter {
  all?: true;
  locales?: AudienceLocale[];
  claimCampaignIds?: string[];
  claimMode?: AudienceClaimMode;
}

export type ValidateFilterResult =
  | { ok: true; filter: AudienceFilter }
  | { ok: false };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES: AudienceLocale[] = ["id", "en"];

/**
 * Validasi audience filter: minimal satu kriteria; `claimMode` wajib
 * bila `claimCampaignIds` ada.
 */
export function validateFilter(f: unknown): ValidateFilterResult {
  if (f === null || typeof f !== "object" || Array.isArray(f)) return { ok: false };
  const obj = f as Record<string, unknown>;

  const hasAll = obj.all === true;
  const hasLocales = obj.locales !== undefined;
  const hasClaims = obj.claimCampaignIds !== undefined;
  if (!hasAll && !hasLocales && !hasClaims) return { ok: false };

  if (obj.all !== undefined && obj.all !== true) return { ok: false };

  let locales: AudienceLocale[] | undefined;
  if (hasLocales) {
    const raw = obj.locales;
    if (
      !Array.isArray(raw) || raw.length === 0 ||
      raw.some((l) => l !== "id" && l !== "en")
    ) return { ok: false };
    locales = raw as AudienceLocale[];
  }

  let claimCampaignIds: string[] | undefined;
  let claimMode: AudienceClaimMode | undefined;
  if (hasClaims) {
    const raw = obj.claimCampaignIds;
    if (
      !Array.isArray(raw) || raw.length === 0 ||
      raw.some((id) => typeof id !== "string" || !UUID_RE.test(id))
    ) return { ok: false };
    if (obj.claimMode !== "ANY" && obj.claimMode !== "ALL") return { ok: false };
    claimCampaignIds = raw as string[];
    claimMode = obj.claimMode as AudienceClaimMode;
  } else if (obj.claimMode !== undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    filter: {
      ...(hasAll ? { all: true as const } : {}),
      ...(locales ? { locales } : {}),
      ...(claimCampaignIds ? { claimCampaignIds } : {}),
      ...(claimMode ? { claimMode } : {}),
    },
  };
}

/** Exclusions yang selalu berlaku + kriteria filter. */
function audienceQuery(filter: AudienceFilter) {
  const conds = [
    eq(contacts.confirmationStatus, "confirmed"),
    eq(marketingSubscriptions.status, "active"),
    isNull(emailSuppressions.emailNormalized), // suppression match terkeluar
  ];

  if (filter.locales && filter.locales.length > 0) {
    conds.push(inArray(contacts.locale, filter.locales));
  }

  if (filter.claimCampaignIds && filter.claimCampaignIds.length > 0) {
    const ids = filter.claimCampaignIds;
    if (filter.claimMode === "ALL") {
      // Harus punya claim pada SEMUA campaign terpilih.
      conds.push(
        and(
          ...ids.map((id) =>
            exists(
              db.select({ one: sql`1` }).from(rewardClaims).where(
                and(eq(rewardClaims.contactId, contacts.id), eq(rewardClaims.campaignId, id)),
              ),
            ),
          ),
        )!,
      );
    } else {
      // ANY: cukup claim pada salah satu campaign terpilih.
      conds.push(
        exists(
          db.select({ one: sql`1` }).from(rewardClaims).where(
            and(eq(rewardClaims.contactId, contacts.id), inArray(rewardClaims.campaignId, ids)),
          ),
        ),
      );
    }
  }

  return db
    .select({ id: contacts.id, locale: contacts.locale })
    .from(contacts)
    .innerJoin(marketingSubscriptions, eq(marketingSubscriptions.contactId, contacts.id))
    .leftJoin(emailSuppressions, eq(emailSuppressions.emailNormalized, contacts.emailNormalized))
    .where(and(...conds));
}

/**
 * Locale pilihan per contact: contact.locale bila lolos filter locale
 * (atau filter tanpa locale), else "id".
 */
function selectedLocale(contactLocale: string, filter: AudienceFilter): AudienceLocale {
  const offered = filter.locales && filter.locales.length > 0 ? filter.locales : LOCALES;
  return (offered as string[]).includes(contactLocale) ? (contactLocale as AudienceLocale) : "id";
}

export async function resolveAudience(
  filter: AudienceFilter,
): Promise<{ contactId: string; locale: AudienceLocale }[]> {
  const rows = await audienceQuery(filter);
  return rows.map((r) => ({ contactId: r.id, locale: selectedLocale(r.locale, filter) }));
}

export async function countAudience(filter: AudienceFilter): Promise<number> {
  const rows = await audienceQuery(filter);
  return rows.length;
}
