import sanitizeHtml from "sanitize-html";
import { broadcastLayout } from "../templates";

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
 * - href hanya https:; http/javascript/data dihapus atributnya
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

export type ValidateContentResult =
  | { ok: true; missing: ("en")[] }
  | { ok: false; reason: "missing-id" };

/**
 * ID wajib lengkap (subject, preheader, body). EN boleh kosong —
 * jika ada field EN yang kurang, fallback per field ke ID saat render
 * dan locale "en" dilaporkan di `missing`.
 */
export function validateContent(input: CampaignContent): ValidateContentResult {
  if (!input.subjectId.trim() || !input.preheaderId.trim() || !input.bodyHtmlId.trim()) {
    return { ok: false, reason: "missing-id" };
  }
  const enComplete = !!input.subjectEn?.trim() && !!input.preheaderEn?.trim() && !!input.bodyHtmlEn?.trim();
  return { ok: true, missing: enComplete ? [] : ["en"] };
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
  siteUrl: string;
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
 * - rewrite semua href https via `linkRewrite` (click tracking)
 * - bungkus dengan broadcastLayout (footer unsubscribe + reply-to note)
 * - text = strip tag html + unsubscribe url
 */
export function renderForRecipient(args: RenderForRecipientArgs): RenderedEmail {
  const { campaign, locale, email, unsubscribeUrl, linkRewrite } = args;
  const pick = (idVal: string, enVal?: string | null): string =>
    locale === "en" && enVal?.trim() ? enVal : idVal;

  const subject = replaceVar(pick(campaign.subjectId, campaign.subjectEn), "email", email)
    .replace(/\{\{locale\}\}/g, locale);
  const preheader = replaceVar(pick(campaign.preheaderId, campaign.preheaderEn), "email", email)
    .replace(/\{\{locale\}\}/g, locale);
  const bodyHtml = replaceVar(pick(campaign.bodyHtmlId, campaign.bodyHtmlEn), "email", email)
    .replace(/\{\{locale\}\}/g, locale);

  const rewritten = bodyHtml.replace(/href="(https:\/\/[^"]*)"/g, (_m, url: string) =>
    `href="${linkRewrite(url)}"`);

  const withPreheader =
    `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>${rewritten}`;
  const html = broadcastLayout(locale, withPreheader, unsubscribeUrl);
  const text = `${htmlToText(withPreheader)}\n\n${
    locale === "id" ? "Berhenti berlangganan" : "Unsubscribe"
  }: ${unsubscribeUrl}`;

  return { subject, preheader, html, text };
}
