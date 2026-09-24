export const EMAIL_FROM_TRANSACTIONAL = "KelasWFA <hi@kelaswfa.my.id>";
export const EMAIL_REPLY_TO_TRANSACTIONAL = "hi@kelaswfa.my.id";

export const EMAIL_FROM_CAMPAIGN = "KelasWFA <kurir@kelaswfa.my.id>";
export const EMAIL_REPLY_TO_CAMPAIGN = "kurir@kelaswfa.my.id";

export const EMAIL_FROM = EMAIL_FROM_TRANSACTIONAL;
export const EMAIL_REPLY_TO = EMAIL_REPLY_TO_TRANSACTIONAL;

/** Escape karakter HTML berbahaya (&<>"') untuk konten email. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/**
 * Layout email broadcast: body sudah siap (render per recipient),
 * plus footer unsubscribe (link per-recipient) dan reply-to note.
 */
export function broadcastLayout(lang: "id" | "en", bodyHtml: string, unsubscribeUrl: string): string {
  const unsubLabel = lang === "id" ? "Berhenti berlangganan" : "Unsubscribe";
  const replyNote = lang === "id" ? "Balas email ini jika butuh bantuan." : "Reply to this email if you need help.";
  return `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px 12px;background-color:#FFFCF5;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;">
  <tr>
    <td style="padding:0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#FFFFFF;border:1px solid #E7DED0;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(21, 59, 53, 0.04);">
        <tr>
          <td style="height:6px;background:#176B5B;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:36px 32px 32px 32px;">
            <div style="font-size:16px;line-height:1.65;color:#36514B;">${bodyHtml}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#FAF8F5;border-top:1px solid #E7DED0;padding:20px 32px;">
            <p style="margin:0 0 6px 0;font-size:12px;color:#6C7E79;line-height:1.5;">${replyNote} (<a href="mailto:${EMAIL_REPLY_TO_CAMPAIGN}" style="color:#176B5B;text-decoration:none;">${EMAIL_REPLY_TO_CAMPAIGN}</a>)</p>
            <p style="margin:0;font-size:12px;"><a href="${unsubscribeUrl}" style="color:#6C7E79;text-decoration:underline;">${unsubLabel}</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table></body></html>`;
}

export type LayoutOptions = {
  badge?: string;
  voucher?: {
    title: string;
    sub: string;
  };
};

function layout(
  lang: "id" | "en",
  title: string,
  bodyHtml: string,
  linkLabel: string,
  url: string,
  opts?: LayoutOptions,
): string {
  const replyNote = lang === "id" ? "Butuh bantuan? Cukup balas email ini" : "Need help? Just reply to this email";
  const privacyNote =
    lang === "id"
      ? "Email ini dikirim atas permintaan kado di KelasWFA. Kami tidak pernah membagikan emailmu kepada pihak mana pun."
      : "This email was sent in response to your gift request on KelasWFA. We respect your privacy.";
  const fallbackLabel =
    lang === "id"
      ? "Tombol di atas tidak bisa diklik? Salin tautan berikut ke browsermu:"
      : "Button not working? Copy and paste this URL into your browser:";
  const closing =
    lang === "id"
      ? "Semoga bermanfaat untuk langkah dan kemandirian kerjamu,"
      : "Wishing you all the best in your remote work journey,";
  const sender = lang === "id" ? "Tim KelasWFA" : "The KelasWFA Team";

  const badgeHtml = opts?.badge
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
        <tr>
          <td style="background:#E5F2EE;color:#176B5B;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 12px;border-radius:999px;">
            ${opts.badge}
          </td>
        </tr>
      </table>`
    : "";

  const voucherHtml = opts?.voucher
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#F7F1E6;border:1px solid #E7DED0;border-radius:14px;margin-bottom:28px;">
        <tr>
          <td style="padding:16px 20px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:14px;font-weight:700;color:#153B35;margin-bottom:3px;">
                    ${opts.voucher.title}
                  </div>
                  <div style="font-size:12px;color:#6C7E79;font-weight:500;">
                    ${opts.voucher.sub}
                  </div>
                </td>
                <td align="right" style="vertical-align:middle;width:40px;">
                  <div style="font-size:24px;line-height:1;">🎁</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    : "";

  const ctaHtml =
    url && linkLabel
      ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
        <tr>
          <td>
            <a href="${url}" target="_blank" style="display:inline-block;background:#176B5B;color:#FFFFFF;text-decoration:none;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;padding:14px 28px;border-radius:12px;line-height:1;letter-spacing:-0.01em;">
              ${linkLabel}
            </a>
          </td>
        </tr>
      </table>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#FFFCF5;border:1px solid #E7DED0;border-radius:10px;margin-bottom:32px;">
        <tr>
          <td style="padding:12px 14px;">
            <div style="font-size:11px;font-weight:600;color:#6C7E79;margin-bottom:4px;">
              ${fallbackLabel}
            </div>
            <div style="font-size:12px;color:#176B5B;word-break:break-all;line-height:1.4;">
              <a href="${url}" style="color:#176B5B;text-decoration:underline;">${url}</a>
            </div>
          </td>
        </tr>
      </table>`
      : "";

  return `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px 12px;background-color:#FFFCF5;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;">
  <tr>
    <td style="padding:0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#FFFFFF;border:1px solid #E7DED0;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(21, 59, 53, 0.04);">
        <tr>
          <td style="height:6px;background:#176B5B;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:36px 32px 32px 32px;">
            ${badgeHtml}
            <h1 style="color:#153B35;font-size:24px;font-weight:700;line-height:1.25;letter-spacing:-0.025em;margin:0 0 16px 0;">${title}</h1>
            <div style="font-size:16px;line-height:1.65;color:#36514B;margin-bottom:24px;">${bodyHtml}</div>
            ${voucherHtml}
            ${ctaHtml}
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
              <tr>
                <td style="height:1px;background:#E7DED0;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>
            <div style="font-size:14px;color:#36514B;line-height:1.6;margin-bottom:4px;">${closing}</div>
            <div style="font-size:14px;font-weight:700;color:#153B35;">${sender}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#FAF8F5;border-top:1px solid #E7DED0;padding:20px 32px;">
            <p style="margin:0 0 6px 0;font-size:12px;color:#6C7E79;line-height:1.5;">${replyNote} (<a href="mailto:${EMAIL_REPLY_TO}" style="color:#176B5B;text-decoration:none;">${EMAIL_REPLY_TO}</a>)</p>
            <p style="margin:0;font-size:11px;color:#95A4A0;line-height:1.5;">${privacyNote}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table></body></html>`;
}

export function confirmationEmail(locale: "id" | "en", confirmUrl: string) {
  if (locale === "en") {
    return {
      subject: "Confirm your email to open your KelasWFA gift",
      html: layout(
        "en",
        "Confirm your email",
        '<p style="margin:0 0 16px 0;">Tap the button below to confirm your email and unlock your reward.</p>',
        "Confirm Email & Unlock Gift →",
        confirmUrl,
        {
          badge: "GIFT FROM KELASWFA",
          voucher: {
            title: "Digital Gift Package Ready",
            sub: "Encrypted token · Valid for 7 days",
          },
        },
      ),
      text: "Confirm your email to open your KelasWFA gift: " + confirmUrl + " (valid 7 days)",
    };
  }
  return {
    subject: "Konfirmasi email untuk membuka hadiah KelasWFA",
    html: layout(
      "id",
      "Satu langkah lagi",
      '<p style="margin:0 0 16px 0;">Klik tombol di bawah untuk mengonfirmasi emailmu dan membuka hadiah dari KelasWFA.</p>',
      "Konfirmasi Email & Buka Hadiah →",
      confirmUrl,
      {
        badge: "KADO DARI KELASWFA",
        voucher: {
          title: "Paket Kado Digital Siap Dibuka",
          sub: "Tautan terenkripsi · Berlaku 7 hari",
        },
      },
    ),
    text: "Konfirmasi email untuk membuka hadiah KelasWFA: " + confirmUrl + " (berlaku 7 hari)",
  };
}

export function rewardAccessEmail(locale: "id" | "en", accessUrl: string, rawRewardTitle: string) {
  // rewardTitle berasal dari input admin (nama reward) — di-escape HANYA untuk
  // interpolasi HTML supaya tidak bisa menyuntikkan HTML/script. Subject dan
  // text plain-text memakai judul mentah (escapeHtml di plain-text membuat
  // judul dengan "&" tampil literal "&amp;").
  const rewardTitle = escapeHtml(rawRewardTitle);
  if (locale === "en") {
    return {
      subject: `Your KelasWFA gift: ${rawRewardTitle}`,
      html: layout(
        "en",
        "Your gift is ready",
        `<p style="margin:0 0 16px 0;">Your reward <strong>${rewardTitle}</strong> is ready to download.</p>`,
        "Open Download Page →",
        accessUrl,
        {
          badge: "GIFT ACCESS UNLOCKED",
          voucher: {
            title: rewardTitle,
            sub: "Page access valid 7 days · Download link 1 hour",
          },
        },
      ),
      text: `Your KelasWFA gift "${rawRewardTitle}" is ready: ${accessUrl} (valid 7 days)`,
    };
  }
  return {
    subject: `Hadiah KelasWFA-mu: ${rawRewardTitle}`,
    html: layout(
      "id",
      "Kadonya siap dibuka",
      `<p style="margin:0 0 16px 0;">Hadiah <strong>${rewardTitle}</strong> sudah siap diunduh.</p>`,
      "Buka Halaman Unduhan →",
      accessUrl,
      {
        badge: "AKSES KADO DIBUKA",
        voucher: {
          title: rewardTitle,
          sub: "Akses halaman berlaku 7 hari · Link unduhan 1 jam",
        },
      },
    ),
    text: `Hadiah KelasWFA "${rawRewardTitle}" sudah siap: ${accessUrl} (berlaku 7 hari)`,
  };
}

export function otpEmail(code: string) {
  return {
    subject: "Kode login KelasWFA Admin",
    html: layout(
      "id",
      "Kode login Anda",
      `<p style="margin:0 0 16px 0;">Gunakan kode OTP berikut untuk masuk ke dashboard admin KelasWFA:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#153B35;background:#F7F1E6;padding:16px 24px;border-radius:12px;border:1px solid #E7DED0;display:inline-block;margin-bottom:16px;">${code}</div><p style="margin:0;font-size:14px;color:#6C7E79;">Kode ini berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.</p>`,
      "",
      "",
      {
        badge: "KELASWFA ADMIN",
      },
    ),
    text: `Kode OTP KelasWFA Admin: ${code} (berlaku 10 menit)`,
  };
}
