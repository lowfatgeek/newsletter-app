import { describe, expect, it } from "vitest";
import { confirmationEmail, EMAIL_FROM, escapeHtml, otpEmail, rewardAccessEmail } from "../src/lib/templates";

describe("confirmationEmail", () => {
  it("id content mentions confirmation and link", () => {
    const m = confirmationEmail("id", "https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.subject).toContain("Konfirmasi");
    expect(m.html).toContain("https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.html).toContain('lang="id"');
  });
  it("en content falls back structure", () => {
    const m = confirmationEmail("en", "https://x/konfirmasi/t");
    expect(m.html).toContain('lang="en"');
    expect(m.subject).not.toContain("Konfirmasi");
  });
});

describe("rewardAccessEmail", () => {
  it("includes reward title and access link", () => {
    const m = rewardAccessEmail("id", "https://x/akses/t", "Starter Checklist");
    expect(m.html).toContain("Starter Checklist");
    expect(m.html).toContain("https://x/akses/t");
  });
  it("sets from header constant", () => {
    expect(EMAIL_FROM).toBe("KelasWFA <admin@kelaswfa.my.id>");
  });
  it("escapes HTML-dangerous characters in html body only; subject/text keep raw title", () => {
    const m = rewardAccessEmail("id", "https://x/akses/t", '<script>x</script> Sticker & "Gift"');
    // HTML di-escape penuh — tidak ada raw tag atau raw & di html.
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&amp;");
    expect(m.html).toContain("Sticker");
    // Subject/text plain-text memakai judul MENTAH: "&" tampil apa adanya
    // (bukan "&amp;") — escaping di plain-text justru merusak tampilan.
    expect(m.subject).toContain('Sticker & "Gift"');
    expect(m.subject).not.toContain("&amp;");
    expect(m.text).toContain('Sticker & "Gift"');
    expect(m.text).not.toContain("&amp;");
  });
  it("escapeHtml escapes all dangerous characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("otpEmail", () => {
  it("includes code in html and text, renders no empty link", () => {
    const m = otpEmail("123456");
    expect(m.subject).toContain("Kode login");
    expect(m.html).toContain("123456");
    expect(m.text).toContain("123456");
    expect(m.html).not.toContain('<a href=""');
  });
  it("still renders CTA for url-bearing templates", () => {
    const m = confirmationEmail("id", "https://x/konfirmasi/t");
    expect(m.html).toContain('<a href="https://x/konfirmasi/t"');
  });
});
