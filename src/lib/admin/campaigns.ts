import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  campaignRedirects,
  doaSelections,
  doaTemplates,
  rewardAssets,
  rewardCampaignLocales,
  rewardCampaigns,
} from "../schema";
import { isValidUuid } from "../uuid";
import { audit } from "./audit";

// Opsi audit untuk semua mutasi CMS. adminUserId boleh null (aksi sistem),
// ip boleh kosong (hash disimpan null).
export type AuditOpts = { adminUserId?: string | null; ip?: string };

function auditArgs(opts?: AuditOpts) {
  return {
    adminUserId: opts?.adminUserId ?? undefined,
    ip: opts?.ip,
  };
}

export function validateSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 1 && slug.length <= 120;
}

export async function createCampaign(
  input: { slug: string },
  auditOpts?: AuditOpts,
): Promise<{ ok: true; id: string } | { ok: false; reason: "invalid-slug" | "slug-taken" }> {
  if (!validateSlug(input.slug)) return { ok: false, reason: "invalid-slug" };
  const inserted = await db
    .insert(rewardCampaigns)
    .values({ slug: input.slug })
    .onConflictDoNothing({ target: rewardCampaigns.slug })
    .returning({ id: rewardCampaigns.id });
  if (inserted.length === 0) return { ok: false, reason: "slug-taken" };
  await audit("campaign_created", {
    ...auditArgs(auditOpts),
    detail: { campaignId: inserted[0].id, slug: input.slug },
  });
  return { ok: true, id: inserted[0].id };
}

export async function updateCampaignMeta(
  id: string,
  patch: Partial<{ featuredImageKey: string | null; order: number; indexable: boolean }>,
  auditOpts?: AuditOpts,
): Promise<void> {
  const values: Partial<typeof rewardCampaigns.$inferInsert> = {};
  if ("featuredImageKey" in patch) values.featuredImageKey = patch.featuredImageKey ?? null;
  if ("order" in patch) values.sortOrder = patch.order;
  if ("indexable" in patch) values.indexable = patch.indexable;
  if (Object.keys(values).length === 0) return; // tidak ada perubahan → tidak ada update/audit
  await db.update(rewardCampaigns).set(values).where(eq(rewardCampaigns.id, id));
  await audit("campaign_updated", {
    ...auditArgs(auditOpts),
    detail: { campaignId: id, patch: values },
  });
}

export async function upsertCampaignLocale(
  campaignId: string,
  locale: "id" | "en",
  fields: {
    title: string;
    description: string;
    rewardItems: Array<{ name: string; benefit: string; format?: string; size?: string }>;
    metaTitle?: string;
    metaDescription?: string;
  },
  auditOpts?: AuditOpts,
): Promise<void> {
  await db
    .insert(rewardCampaignLocales)
    .values({
      campaignId,
      locale,
      title: fields.title,
      description: fields.description,
      rewardItems: fields.rewardItems,
      metaTitle: fields.metaTitle ?? null,
      metaDescription: fields.metaDescription ?? null,
    })
    .onConflictDoUpdate({
      target: [rewardCampaignLocales.campaignId, rewardCampaignLocales.locale],
      set: {
        title: fields.title,
        description: fields.description,
        rewardItems: fields.rewardItems,
        metaTitle: fields.metaTitle ?? null,
        metaDescription: fields.metaDescription ?? null,
      },
    });
  await audit("campaign_updated", {
    ...auditArgs(auditOpts),
    detail: { campaignId, locale, op: "locale_upsert" },
  });
}

export async function changeSlug(
  id: string,
  newSlug: string,
  confirmed: boolean,
  auditOpts?: AuditOpts,
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: "invalid-slug" | "slug-taken" | "not-found" | "published-requires-confirmation";
    }
> {
  if (!validateSlug(newSlug)) return { ok: false, reason: "invalid-slug" };
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
  if (!camp) return { ok: false, reason: "not-found" };
  if (camp.slug === newSlug) return { ok: true }; // rename ke slug sama → no-op

  // Slug baru tidak boleh sama dengan slug AKTIF campaign lain
  // (slug lama yang sudah dialihkan lewat redirect boleh dipakai lagi).
  const [taken] = await db
    .select({ id: rewardCampaigns.id })
    .from(rewardCampaigns)
    .where(eq(rewardCampaigns.slug, newSlug));
  if (taken && taken.id !== id) return { ok: false, reason: "slug-taken" };

  if (camp.status !== "draft" && !confirmed) {
    return { ok: false, reason: "published-requires-confirmation" };
  }

  const oldSlug = camp.slug;
  await db.transaction(async (tx) => {
    await tx.update(rewardCampaigns).set({ slug: newSlug }).where(eq(rewardCampaigns.id, id));
    // Kalau slug baru adalah slug lama campaign ini sendiri (rename balik),
    // hapus redirect lama yang menunjuk ke diri sendiri agar resolver publik
    // tidak loop. Redirect milik campaign lain (slug diklaim kembali) dipindah
    // ke campaign ini lewat onConflictDoUpdate di bawah.
    await tx
      .delete(campaignRedirects)
      .where(and(eq(campaignRedirects.oldSlug, newSlug), eq(campaignRedirects.campaignId, id)));
    await tx
      .insert(campaignRedirects)
      .values({ campaignId: id, oldSlug })
      .onConflictDoUpdate({
        target: campaignRedirects.oldSlug,
        set: { campaignId: id },
      });
  });
  await audit("slug_changed", {
    ...auditArgs(auditOpts),
    detail: { campaignId: id, oldSlug, newSlug },
  });
  return { ok: true };
}

/**
 * Resolver redirect publik: oldSlug → campaignId → slug campaign TERKINI.
 * Slug di baris redirect tidak dianggap stabil (campaign bisa di-rename lagi),
 * jadi slug selalu dibaca dari rewardCampaigns saat ini. Null bila oldSlug
 * tidak dikenal.
 */
export async function resolveSlugRedirect(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ currentSlug: rewardCampaigns.slug })
    .from(campaignRedirects)
    .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, campaignRedirects.campaignId))
    .where(eq(campaignRedirects.oldSlug, slug));
  return row?.currentSlug ?? null;
}

export async function setCampaignStatus(
  id: string,
  action: "publish" | "pause" | "unpause" | "archive",
  auditOpts?: AuditOpts,
): Promise<{ ok: true } | { ok: false; reason: "invalid-transition" | "not-found" }> {
  const [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
  if (!camp) return { ok: false, reason: "not-found" };

  // Mesin status: draft→published; published↔paused; published|paused→archived.
  // Paused→archived diizinkan: tombol "Arsipkan" memang dirender untuk campaign
  // paused di editor (PRD tidak melarang pause-then-archive).
  const allowed: Record<typeof action, string[]> = {
    publish: ["draft"],
    pause: ["published"],
    unpause: ["paused"],
    archive: ["published", "paused"],
  };
  if (!allowed[action].includes(camp.status)) return { ok: false, reason: "invalid-transition" };

  const nextStatus =
    action === "publish" || action === "unpause" ? "published" : action === "pause" ? "paused" : "archived";

  // publishedAt diset sekali saja — unpause tidak menimpanya.
  if (action === "publish" && camp.publishedAt === null) {
    await db
      .update(rewardCampaigns)
      .set({ status: nextStatus, publishedAt: new Date() })
      .where(eq(rewardCampaigns.id, id));
  } else {
    await db.update(rewardCampaigns).set({ status: nextStatus }).where(eq(rewardCampaigns.id, id));
  }

  const auditAction =
    action === "archive" ? "campaign_archived" : action === "pause" ? "campaign_paused" : "campaign_published";
  await audit(auditAction, {
    ...auditArgs(auditOpts),
    detail: { campaignId: id, from: camp.status, to: nextStatus },
  });
  return { ok: true };
}

export async function duplicateCampaign(id: string, auditOpts?: AuditOpts): Promise<string> {
  const newId = await db.transaction(async (tx) => {
    const [src] = await tx.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    if (!src) throw new Error("campaign-not-found");

    // Cari slug unik: <slug>-copy, <slug>-copy-2, dst. Dasar slug dipangkas
    // agar hasil akhir tetap muat di varchar(120).
    let suffix = "-copy";
    let n = 1;
    let newSlug = "";
    for (;;) {
      // Pangkas dasar slug agar muat varchar(120) DAN buang dash di ekor yang
      // muncul karena pemotongan, supaya hasilnya tidak jadi "slug---copy".
      const base = src.slug.slice(0, 120 - suffix.length).replace(/-+$/, "");
      newSlug = `${base}${suffix}`;
      const [clash] = await tx
        .select({ id: rewardCampaigns.id })
        .from(rewardCampaigns)
        .where(eq(rewardCampaigns.slug, newSlug));
      if (!clash) break;
      n += 1;
      suffix = `-copy-${n}`;
    }

    const [copy] = await tx
      .insert(rewardCampaigns)
      .values({
        slug: newSlug,
        status: "draft",
        indexable: false,
        featuredImageKey: src.featuredImageKey,
        sortOrder: src.sortOrder,
        publishedAt: null,
      })
      .returning({ id: rewardCampaigns.id });

    const locales = await tx.select().from(rewardCampaignLocales).where(eq(rewardCampaignLocales.campaignId, id));
    if (locales.length > 0) {
      await tx.insert(rewardCampaignLocales).values(
        locales.map((l) => ({
          campaignId: copy.id,
          locale: l.locale,
          title: l.title,
          description: l.description,
          rewardItems: l.rewardItems,
          metaTitle: l.metaTitle,
          metaDescription: l.metaDescription,
        })),
      );
    }

    // Baris asset disalin apa adanya (storageKey sama — objek storage shared,
    // TIDAK di-re-upload).
    const assets = await tx.select().from(rewardAssets).where(eq(rewardAssets.campaignId, id));
    if (assets.length > 0) {
      await tx.insert(rewardAssets).values(
        assets.map((a) => ({
          campaignId: copy.id,
          storageKey: a.storageKey,
          nameId: a.nameId,
          nameEn: a.nameEn,
          descId: a.descId,
          descEn: a.descEn,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          checksum: a.checksum,
          sortOrder: a.sortOrder,
        })),
      );
    }

    const selections = await tx.select().from(doaSelections).where(eq(doaSelections.campaignId, id));
    if (selections.length > 0) {
      await tx.insert(doaSelections).values(
        selections.map((s) => ({
          campaignId: copy.id,
          variant: s.variant,
          templateId: s.templateId,
        })),
      );
    }

    return copy.id;
  });

  await audit("campaign_duplicated", {
    ...auditArgs(auditOpts),
    detail: { sourceId: id, newId },
  });
  return newId;
}

export async function getCampaignById(id: string) {
  // Guard 1.9: id non-UUID dari path parameter → null (404), bukan 500 dari
  // error syntax PostgreSQL 22P02.
  if (!isValidUuid(id)) return null;
  const [campaign] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
  if (!campaign) return null;
  const locales = await db.select().from(rewardCampaignLocales).where(eq(rewardCampaignLocales.campaignId, id));
  const assets = await db
    .select()
    .from(rewardAssets)
    .where(eq(rewardAssets.campaignId, id))
    .orderBy(asc(rewardAssets.sortOrder));
  const selections = await db.select().from(doaSelections).where(eq(doaSelections.campaignId, id));
  return { campaign, locales, assets, doaSelections: selections };
}

/**
 * Simpan pilihan preset doa untuk kedua variant (upsert pada unique
 * (campaign, variant)). TemplateId divalidasi: variant template HARUS sama
 * dengan variant yang dipilih — kalau tidak, seluruh operasi ditolak tanpa
 * menulis apa pun (reason "variant-mismatch"; template tidak dikenal juga
 * ditolak dengan reason yang sama karena tidak bisa dibuktikan cocok).
 */
export async function setDoaSelections(
  campaignId: string,
  sel: { muslim: string; universal: string },
  auditOpts?: AuditOpts,
): Promise<{ ok: true } | { ok: false; reason: "variant-mismatch" }> {
  const wanted: Array<{ variant: "muslim" | "universal"; templateId: string }> = [
    { variant: "muslim", templateId: sel.muslim },
    { variant: "universal", templateId: sel.universal },
  ];
  for (const w of wanted) {
    const [tpl] = await db
      .select({ variant: doaTemplates.variant })
      .from(doaTemplates)
      .where(eq(doaTemplates.id, w.templateId));
    if (!tpl || tpl.variant !== w.variant) return { ok: false, reason: "variant-mismatch" };
  }
  await db.transaction(async (tx) => {
    for (const w of wanted) {
      await tx
        .insert(doaSelections)
        .values({ campaignId, variant: w.variant, templateId: w.templateId })
        .onConflictDoUpdate({
          target: [doaSelections.campaignId, doaSelections.variant],
          set: { templateId: w.templateId },
        });
    }
  });
  await audit("campaign_updated", {
    ...auditArgs(auditOpts),
    detail: { campaignId, op: "doa_selection_set", muslim: sel.muslim, universal: sel.universal },
  });
  return { ok: true };
}
