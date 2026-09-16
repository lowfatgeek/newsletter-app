/**
 * Parsing murni form editor campaign — tanpa DOM, tanpa DB, agar unit-testable.
 * Dipakai klien [id].astro (mode edit & mode buat) untuk mengubah nilai input
 * menjadi body API create/update; server tetap memvalidasi ulang segalanya.
 */

export type LocaleFormInput = {
  title: string;
  description: string;
  metaTitle?: string;
  metaDescription?: string;
  items: unknown[];
};

export type CampaignFormInput = {
  slug: string;
  featuredImageKey: string;
  sortOrderRaw: string | number;
  indexable: boolean;
  id: LocaleFormInput;
  en: LocaleFormInput;
};

export type CampaignFormIssue = {
  field: "slug" | "titleId";
  reason: "invalid-slug" | "slug-taken" | "missing-title";
};

export type CampaignFormPayload = {
  ok: true;
  body: {
    slug: string;
    featuredImageKey: string | null;
    sortOrder: number;
    indexable: boolean;
    locales: {
      id: { title: string; description: string; metaTitle: string; metaDescription: string; rewardItems: unknown[] };
      en: { title: string; description: string; metaTitle: string; metaDescription: string; rewardItems: unknown[] };
    };
    redirectConfirmed?: boolean;
  };
};
export type CampaignFormErrors = { ok: false; issues: CampaignFormIssue[] };

/** Slug slug-ify dari judul: lower, non-alnum → hubung, tanpa hubung tepi. */
export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

const LOCALE_EMPTY = (items: unknown[]) => ({
  title: "",
  description: "",
  metaTitle: "",
  metaDescription: "",
  rewardItems: items,
});

/**
 * Validasi + normalisasi nilai mentah form menjadi body JSON API campaign.
 * Aturan sengaja cermin dari server (parseSlug, syarat pasangan
 * title/description di upsertLocaleRows) agar error muncul inline, bukan
 * sebagai kegagalan generik.
 */
export function parseCampaignForm(input: CampaignFormInput): CampaignFormPayload | CampaignFormErrors {
  const issues: CampaignFormIssue[] = [];
  const slug = (input.slug || "").trim();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    issues.push({ field: "slug", reason: "invalid-slug" });
  }

  const idTitle = input.id.title.trim();
  const idDesc = input.id.description.trim();
  const enTitle = input.en.title.trim();
  const enDesc = input.en.description.trim();
  const idHasAny = Boolean(idTitle || idDesc || input.id.items.length);
  const enHasAny = Boolean(enTitle || enDesc || input.en.items.length);
  if ((idHasAny || enHasAny) && !idTitle) {
    issues.push({ field: "titleId", reason: "missing-title" });
  }

  if (issues.length) return { ok: false, issues };

  const sortNum = Math.floor(Number(input.sortOrderRaw));
  return {
    ok: true,
    body: {
      // Slug kosong di mode create berarti "belum ditentukan" — dikirim apa
      // adanya agar API create membalas { ok:false, reason:"invalid" } dan
      // klien menampilkan error inline; mapSlugReason menambal pemetaan
      // 'invalid' bila muncul.
      slug,
      featuredImageKey: (input.featuredImageKey || "").trim() || null,
      sortOrder: Number.isFinite(sortNum) && sortNum >= 0 ? sortNum : 0,
      indexable: Boolean(input.indexable),
      locales: {
        id: {
          title: idTitle,
          description: idDesc,
          metaTitle: (input.id.metaTitle ?? "").trim(),
          metaDescription: (input.id.metaDescription ?? "").trim(),
          rewardItems: input.id.items,
        },
        en: {
          title: enTitle,
          description: enDesc,
          metaTitle: (input.en.metaTitle ?? "").trim(),
          metaDescription: (input.en.metaDescription ?? "").trim(),
          rewardItems: input.en.items,
        },
      },
    },
  };
}

/**
 * Payload create untuk mode buat. Field lain form dihimpun di `rest`; mode
 * buat selalu mengirim locales penuh + metadata. Slug kosong ditolak di sini
 * (panggilan hanya terjadi setelah parseCampaignForm lolos + slug terisi).
 */
export function toCreateBody(input: CampaignFormInput): CampaignFormPayload | CampaignFormErrors {
  const parsed = parseCampaignForm(input);
  if (!parsed.ok) return parsed;
  if (!parsed.body.slug) return { ok: false, issues: [{ field: "slug", reason: "invalid-slug" }] };
  return parsed;
}

/** Payload update untuk mode edit (persis body yang dulu dibangun inline). */
export function toUpdateBody(
  input: CampaignFormInput,
  redirectConfirmed: boolean,
): CampaignFormPayload | CampaignFormErrors {
  const parsed = parseCampaignForm(input);
  if (!parsed.ok) return parsed;
  return { ok: true, body: { ...parsed.body, redirectConfirmed } };
}

/** Locale kosong untuk render awal mode buat (nol baris item). */
export const emptyIdLocale = () => LOCALE_EMPTY([]);
export const emptyEnLocale = () => LOCALE_EMPTY([]);

/**
 * Petakan `reason` respons API ke pesan & lokasi error. Unknown reason →
 * null (panggilan memakai fallback generik). 'invalid' dipetakan ke slug
 * karena satu-satunya input route create yang bisa menghasilkan 'invalid'
 * dari klien yang sudah validasi lokal adalah slug kosong/kotor.
 */
export function mapSlugReason(
  reason: string | undefined,
): { field: "slug"; message: string } | { field: "titleId"; message: string } | { field: "global"; message: string } | null {
  switch (reason) {
    case "invalid-slug":
    case "invalid":
      return { field: "slug", message: "Slug hanya boleh huruf kecil, angka, dan tanda hubung (tanpa spasi)." };
    case "slug-taken":
      return { field: "slug", message: "Slug sudah dipakai campaign lain. Coba slug lain." };
    case "missing-title":
      return { field: "titleId", message: "Judul wajib diisi bila konten diisi." };
    case "unauthorized":
      return { field: "global", message: "Sesi berakhir. Muat ulang halaman untuk masuk kembali." };
    default:
      return null;
  }
}
