import sanitizeHtml from "sanitize-html";
import { broadcastLayout, escapeHtml } from "../templates";

/**
 * Konten kampanye broadcast.
 *
 * KONTRAK PERSISTENCE: body yang disimpan ke database (persistence seam
 * admin, Task 11) HARUS hasil `sanitizeBody(...)` — `validateContent`
 * mengembalikan versi sanitized untuk dipakai persistence. Renderer
 * (snapshot) memakai body tersimpan apa adanya dan TIDAK melakukan
 * sanitize ulang (rewritten click URLs memakai skema siteUrl, bisa http
 * di dev, sehingga sanitize saat render akan membuangnya).
 */

/** Konten kampanye (versi EN opsional; fallback ke ID per field). */
export interface CampaignContent {
  subjectId: string;
  preheaderId: string;
  bodyHtmlId: string;
  subjectEn?: string | null;
  preheaderEn?: string | null;
  bodyHtmlEn?: string | null;
}

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "h2", "h3", "blockquote"];

/**
 * Sanitasi body HTML kampanye (input admin):
 * - allowlist tag & atribut saja (script/style/event handler terbuang)
 * - semua <a> dipaksa target="_blank" rel="noopener"
 * - href hanya https:; http/javascript/data/protocol-relative dihapus
 *   atributnya
 */
export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["https"],
    transformTags: {
      a: (_tagName, attribs) => {
        const href = typeof attribs.href === "string" && attribs.href.startsWith("https://")
          ? attribs.href
          : undefined;
        return {
          tagName: "a",
          attribs: href ? { href, target: "_blank", rel: "noopener" } : {},
        };
      },
    },
  });
}

/** Decode entity dasar (hasil escaping atribut sanitize-html). `&amp;` terakhir. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export type ValidateContentResult =
  | {
    ok: true;
    missing: ("en")[];
    sanitized: { bodyHtmlId: string; bodyHtmlEn: string | null };
  }
  | { ok: false; reason: "missing-id" };

/**
 * ID wajib lengkap (subject, preheader, body). EN boleh kosong —
 * jika ada field EN yang kurang, fallback per field ke ID saat render
 * dan locale "en" dilaporkan di `missing`.
 *
 * `sanitized` berisi body hasil `sanitizeBody` yang HARUS dipersistenkan
 * oleh seam admin (body tersimpan = body sanitized; bodyHtmlId wajib,
 * bodyHtmlEn di-sanitize hanya bila ada).
 */
export function validateContent(input: CampaignContent): ValidateContentResult {
  if (!input.subjectId.trim() || !input.preheaderId.trim() || !input.bodyHtmlId.trim()) {
    return { ok: false, reason: "missing-id" };
  }
  const enComplete = !!input.subjectEn?.trim() && !!input.preheaderEn?.trim() && !!input.bodyHtmlEn?.trim();
  return {
    ok: true,
    missing: enComplete ? [] : ["en"],
    sanitized: {
      bodyHtmlId: sanitizeBody(input.bodyHtmlId),
      bodyHtmlEn: input.bodyHtmlEn?.trim() ? sanitizeBody(input.bodyHtmlEn) : null,
    },
  };
}

/** Ganti semua kemunculan `{{key}}` tanpa regex replacement-pattern pitfalls. */
function replaceVar(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

/** Strip tag html, decode entity dasar, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

export interface RenderForRecipientArgs {
  campaign: CampaignContent;
  locale: "id" | "en";
  email: string;
  unsubscribeUrl: string;
  linkRewrite: (url: string) => string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/**
 * Render final satu email untuk satu recipient:
 * - pilih konten locale (fallback ID per field bila kosong)
 * - replace variabel aman `{{email}}` dan `{{locale}}`
 * - rewrite semua href https via `linkRewrite` (click tracking);
 *   url yang diteruskan ke callback SUDAH di-decode dari entity HTML
 *   (sanitize-html menulis `&amp;` di atribut) supaya cocok dengan
 *   kunci Map dari prepareLinks
 * - preheader di-escape sebelum masuk div tersembunyi
 * - bungkus dengan broadcastLayout (footer unsubscribe + reply-to note)
 * - text = strip tag html + unsubscribe url
 */
export function renderForRecipient(args: RenderForRecipientArgs): RenderedEmail {
  const { campaign, locale, email, unsubscribeUrl, linkRewrite } = args;
  const pick = (idVal: string, enVal?: string | null): string =>
    locale === "en" && enVal?.trim() ? enVal : idVal;

  const subject = replaceVar(
    replaceVar(pick(campaign.subjectId, campaign.subjectEn), "email", email),
    "locale",
    locale,
  );
  const preheader = replaceVar(
    replaceVar(pick(campaign.preheaderId, campaign.preheaderEn), "email", email),
    "locale",
    locale,
  );
  const bodyHtml = replaceVar(
    replaceVar(pick(campaign.bodyHtmlId, campaign.bodyHtmlEn), "email", email),
    "locale",
    locale,
  );

  const rewritten = bodyHtml.replace(/href="(https:\/\/[^"]*)"/g, (_m, url: string) =>
    `href="${linkRewrite(decodeEntities(url))}"`);

  const withPreheader =
    `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>${rewritten}`;
  const html = broadcastLayout(locale, withPreheader, unsubscribeUrl);
  const text = `${htmlToText(withPreheader)}\n\n${
    locale === "id" ? "Berhenti berlangganan" : "Unsubscribe"
  }: ${unsubscribeUrl}`;

  return { subject, preheader, html, text };
}
