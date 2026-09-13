export const EMAIL_FROM = "KelasWFA <admin@kelaswfa.my.id>";
export const EMAIL_REPLY_TO = "admin@kelaswfa.my.id";

export function maskedEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}**@${domain}`;
}

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
  const replyNote = lang === "id"
    ? "Balas email ini jika butuh bantuan."
    : "Reply to this email if you need help.";
  return `<!doctype html><html lang="${lang}"><body style="font-family:Arial,Helvetica,sans-serif;color:#36514B;background:#FFFCF5;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E7DED0;border-radius:20px;padding:32px;">
<div style="font-size:16px;line-height:1.6;">${bodyHtml}</div>
<p style="color:#6C7E79;font-size:13px;">${replyNote} (${EMAIL_REPLY_TO})</p>
<p style="color:#6C7E79;font-size:13px;"><a href="${unsubscribeUrl}" style="color:#6C7E79;">${unsubLabel}</a></p>
</div></body></html>`;
}

function layout(lang: "id" | "en", title: string, bodyHtml: string, linkLabel: string, url: string): string {
  const replyNote = lang === "id"
    ? "Balas email ini jika butuh bantuan."
    : "Reply to this email if you need help.";
  const cta = url
    ? `<p style="margin:24px 0;"><a href="${url}" style="background:#176B5B;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;display:inline-block;">${linkLabel}</a></p>`
    : "";
  return `<!doctype html><html lang="${lang}"><body style="font-family:Arial,Helvetica,sans-serif;color:#36514B;background:#FFFCF5;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E7DED0;border-radius:20px;padding:32px;">
<h1 style="color:#153B35;font-size:22px;margin:0 0 16px;">${title}</h1>
<div style="font-size:16px;line-height:1.6;">${bodyHtml}</div>
${cta}
<p style="color:#6C7E79;font-size:13px;">${replyNote} (${EMAIL_REPLY_TO})</p>
</div></body></html>`;
}

export function confirmationEmail(locale: "id" | "en", confirmUrl: string) {
  if (locale === "en") {
    return {
      subject: "Confirm your email to open your KelasWFA gift",
      html: layout("en", "Confirm your email",
        "<p>Tap the button below to confirm your email and unlock your reward.</p><p>Your link is valid for 7 days.</p>",
        "Confirm my email", confirmUrl),
      text: "Confirm your email to open your KelasWFA gift: " + confirmUrl + " (valid 7 days)",
    };
  }
  return {
    subject: "Konfirmasi email untuk membuka hadiah KelasWFA",
    html: layout("id", "Satu langkah lagi",
      "<p>Klik tombol di bawah untuk mengonfirmasi emailmu dan membuka hadiah dari KelasWFA.</p><p>Tautan berlaku 7 hari.</p>",
      "Konfirmasi emailku", confirmUrl),
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
      html: layout("en", "Your gift is ready",
        `<p>Your reward <strong>${rewardTitle}</strong> is ready to download.</p><p>This access link is valid for 7 days. The download link itself is valid for 1 hour.</p>`,
        "Open my gift", accessUrl),
      text: `Your KelasWFA gift "${rawRewardTitle}" is ready: ${accessUrl} (valid 7 days)`,
    };
  }
  return {
    subject: `Hadiah KelasWFA-mu: ${rawRewardTitle}`,
    html: layout("id", "Kadonya siap dibuka",
      `<p>Hadiah <strong>${rewardTitle}</strong> sudah siap diunduh.</p><p>Tautan akses berlaku 7 hari. Link unduhan berlaku 1 jam.</p>`,
      "Buka hadiahku", accessUrl),
    text: `Hadiah KelasWFA "${rawRewardTitle}" sudah siap: ${accessUrl} (berlaku 7 hari)`,
  };
}

export function otpEmail(code: string) {
  return {
    subject: "Kode login KelasWFA Admin",
    html: layout("id", "Kode login Anda",
      `<p>Kode OTP Anda:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#153B35;">${code}</p><p>Berlaku 10 menit. Jangan bagikan kode ini.</p>`,
      "", ""),
    text: `Kode OTP KelasWFA Admin: ${code} (berlaku 10 menit)`,
  };
}
