import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { doaSelections, doaTemplates } from "../schema";
import { audit } from "./audit";
import type { AuditOpts } from "./campaigns";

export type DoaVariant = "muslim" | "universal";

export const DEFAULT_DOA_TEMPLATES = [
  {
    variant: "muslim" as const,
    locale: "id",
    name: "Doa Muslim v1",
    content:
      "Ya Allah, berkahilah setiap usaha dan kerja keras kami hari ini. Lapangkan setiap langkah, mudahkan setiap urusan, dan jadikan ilmu yang kami pelajari bermanfaat bagi kami dan orang banyak. Aamiin.",
  },
  {
    variant: "muslim" as const,
    locale: "en",
    name: "Doa Muslim v1",
    content:
      "O Allah, bless every effort and hard work we put in today. Ease every step, smooth every matter, and make the knowledge we gain beneficial for us and for many. Ameen.",
  },
  {
    variant: "universal" as const,
    locale: "id",
    name: "Harapan Baik v1",
    content:
      "Semoga setiap langkah kecilmu hari ini membawamu lebih dekat ke tujuan besarmu. Semoga usahamu yang konsisten melunakkan jalan di depan — pelan-pelan, tapi pasti.",
  },
  {
    variant: "universal" as const,
    locale: "en",
    name: "Harapan Baik v1",
    content:
      "May every small step you take today bring you closer to your big goal. May your consistent effort soften the road ahead — slowly, but surely.",
  },
] as const;

export interface DoaTemplateGroup {
  variant: DoaVariant;
  name: string;
  idTemplate?: { id: string; content: string };
  enTemplate?: { id: string; content: string };
}

/**
 * Mengambil semua template doa dan mengelompokkannya per (variant, name).
 */
export async function listGroupedDoaTemplates(): Promise<DoaTemplateGroup[]> {
  const rows = await db
    .select()
    .from(doaTemplates)
    .orderBy(asc(doaTemplates.variant), asc(doaTemplates.name), asc(doaTemplates.locale));

  const map = new Map<string, DoaTemplateGroup>();
  for (const row of rows) {
    const key = `${row.variant}::${row.name}`;
    let group = map.get(key);
    if (!group) {
      group = { variant: row.variant as DoaVariant, name: row.name };
      map.set(key, group);
    }
    if (row.locale === "id") {
      group.idTemplate = { id: row.id, content: row.content };
    } else if (row.locale === "en") {
      group.enTemplate = { id: row.id, content: row.content };
    }
  }
  return Array.from(map.values());
}

/**
 * Muat template doa bawaan jika tabel masih kosong.
 */
export async function ensureDefaultDoaTemplates(auditOpts?: AuditOpts): Promise<{ inserted: number }> {
  let count = 0;
  for (const tpl of DEFAULT_DOA_TEMPLATES) {
    const [existing] = await db
      .select()
      .from(doaTemplates)
      .where(
        and(
          eq(doaTemplates.variant, tpl.variant),
          eq(doaTemplates.locale, tpl.locale),
          eq(doaTemplates.name, tpl.name),
        ),
      );
    if (!existing) {
      await db.insert(doaTemplates).values(tpl);
      count++;
    }
  }

  if (count > 0) {
    await audit("doa_templates_seeded", {
      adminUserId: auditOpts?.adminUserId ?? undefined,
      ip: auditOpts?.ip,
      detail: { count },
    });
  }
  return { inserted: count };
}

/**
 * Tambah atau perbarui pasangan template doa (ID dan EN opsional).
 */
export async function upsertDoaTemplate(
  input: {
    variant: DoaVariant;
    name: string;
    contentId: string;
    contentEn?: string;
  },
  auditOpts?: AuditOpts,
): Promise<{ ok: true } | { ok: false; reason: "invalid" }> {
  const name = input.name.trim();
  const contentId = input.contentId.trim();
  const contentEn = (input.contentEn ?? "").trim();

  if (!name || !contentId || (input.variant !== "muslim" && input.variant !== "universal")) {
    return { ok: false, reason: "invalid" };
  }

  await db.transaction(async (tx) => {
    // 1. Upsert locale ID
    const [existingId] = await tx
      .select()
      .from(doaTemplates)
      .where(and(eq(doaTemplates.variant, input.variant), eq(doaTemplates.locale, "id"), eq(doaTemplates.name, name)));

    if (existingId) {
      await tx.update(doaTemplates).set({ content: contentId }).where(eq(doaTemplates.id, existingId.id));
    } else {
      await tx.insert(doaTemplates).values({
        variant: input.variant,
        locale: "id",
        name,
        content: contentId,
      });
    }

    // 2. Upsert / Delete locale EN
    const [existingEn] = await tx
      .select()
      .from(doaTemplates)
      .where(and(eq(doaTemplates.variant, input.variant), eq(doaTemplates.locale, "en"), eq(doaTemplates.name, name)));

    if (contentEn) {
      if (existingEn) {
        await tx.update(doaTemplates).set({ content: contentEn }).where(eq(doaTemplates.id, existingEn.id));
      } else {
        await tx.insert(doaTemplates).values({
          variant: input.variant,
          locale: "en",
          name,
          content: contentEn,
        });
      }
    } else if (existingEn) {
      // Hapus jika EN dikosongkan
      await tx.delete(doaTemplates).where(eq(doaTemplates.id, existingEn.id));
    }
  });

  await audit("doa_template_saved", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { variant: input.variant, name },
  });

  return { ok: true };
}

/**
 * Hapus preset doa berdasarkan variant dan name.
 * Menolak jika template sedang dipilih oleh salah satu reward campaign aktif.
 */
export async function deleteDoaTemplateGroup(
  variant: DoaVariant,
  name: string,
  auditOpts?: AuditOpts,
): Promise<{ ok: true } | { ok: false; reason: "in-use" | "not-found" }> {
  const matching = await db
    .select()
    .from(doaTemplates)
    .where(and(eq(doaTemplates.variant, variant), eq(doaTemplates.name, name)));

  if (matching.length === 0) return { ok: false, reason: "not-found" };

  const ids = matching.map((m) => m.id);

  // Periksa apakah sedang dipakai di reward campaign
  const used = await db
    .select({ id: doaSelections.id })
    .from(doaSelections)
    .where(inArray(doaSelections.templateId, ids));

  if (used.length > 0) {
    return { ok: false, reason: "in-use" };
  }

  await db.delete(doaTemplates).where(inArray(doaTemplates.id, ids));

  await audit("doa_template_deleted", {
    adminUserId: auditOpts?.adminUserId ?? undefined,
    ip: auditOpts?.ip,
    detail: { variant, name, deletedCount: ids.length },
  });

  return { ok: true };
}
