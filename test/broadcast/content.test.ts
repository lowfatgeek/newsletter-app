import { describe, expect, it } from "vitest";
import { htmlToText, renderForRecipient, sanitizeBody, validateContent } from "../../src/lib/broadcast/content";

describe("sanitizeBody", () => {
  it("strips scripts, handlers, and non-https hrefs, forces rel/target", () => {
    const out = sanitizeBody(`<p onclick="x()">Hai</p><script>alert(1)</script>
      <a href="https://a.b">ok</a><a href="http://a.b">no</a><a href="javascript:alert(1)">js</a>`);
    expect(out).toContain("<p>Hai</p>");
    expect(out).not.toContain("script");
    expect(out).toContain('href="https://a.b"');
    expect(out).not.toContain('href="http://a.b"');
    expect(out).not.toContain("javascript:");
    expect(out).toContain('rel="noopener"');
  });
  it("strips style tags and event handlers on anchors", () => {
    const out = sanitizeBody(`<style>.x{}</style><a href="https://a.b" onclick="y()">klik</a>`);
    expect(out).not.toContain("style");
    expect(out).not.toContain(".x{}");
    expect(out).not.toContain("onclick");
    expect(out).toContain('href="https://a.b"');
    expect(out).toContain('target="_blank"');
  });
  it("keeps the allowlisted formatting tags", () => {
    const out = sanitizeBody(
      "<h2>Judul</h2><p><strong>tebal</strong> <em>miring</em> <u>garis</u></p><ul><li>satu</li></ul><blockquote>q</blockquote>",
    );
    expect(out).toContain("<h2>Judul</h2>");
    expect(out).toContain("<strong>tebal</strong>");
    expect(out).toContain("<em>miring</em>");
    expect(out).toContain("<u>garis</u>");
    expect(out).toContain("<li>satu</li>");
    expect(out).toContain("<blockquote>q</blockquote>");
  });
  it("drops disallowed tags like img and table", () => {
    const out = sanitizeBody('<p>A</p><img src="https://x.y/i.png"><table><tr><td>B</td></tr></table>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<table");
    expect(out).toContain("<p>A</p>");
  });
  it("strips protocol-relative hrefs", () => {
    const out = sanitizeBody('<p><a href="//evil.com">x</a></p>');
    expect(out).not.toContain("href");
    expect(out).toContain("x");
  });
});

describe("validateContent", () => {
  const id = { subjectId: "s", preheaderId: "p", bodyHtmlId: "<p>b</p>" };
  it("ok with id only, missing en flagged, sanitized id body returned", () => {
    expect(validateContent(id)).toEqual({
      ok: true,
      missing: ["en"],
      sanitized: { bodyHtmlId: "<p>b</p>", bodyHtmlEn: null },
    });
  });
  it("ok complete when en filled", () => {
    expect(validateContent({ ...id, subjectEn: "s", preheaderEn: "p", bodyHtmlEn: "<p>b</p>" })).toEqual({
      ok: true,
      missing: [],
      sanitized: { bodyHtmlId: "<p>b</p>", bodyHtmlEn: "<p>b</p>" },
    });
  });
  it("rejects incomplete id", () => {
    expect(validateContent({ subjectId: "s", preheaderId: "", bodyHtmlId: "" }).ok).toBe(false);
  });
  it("flags en missing when only some en fields are filled", () => {
    expect(validateContent({ ...id, subjectEn: "s" })).toEqual({
      ok: true,
      missing: ["en"],
      sanitized: { bodyHtmlId: "<p>b</p>", bodyHtmlEn: null },
    });
  });
  it("returns sanitized bodies with scripts, handlers, and styles stripped", () => {
    const r = validateContent({
      subjectId: "s",
      preheaderId: "p",
      bodyHtmlId: '<p onclick="x()">b</p><script>alert(1)</script>',
      bodyHtmlEn: "<p>ok</p><style>a{color:red}</style>",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sanitized.bodyHtmlId).toBe("<p>b</p>");
    expect(r.sanitized.bodyHtmlEn).toBe("<p>ok</p>");
  });
});

describe("renderForRecipient", () => {
  const campaign = {
    subjectId: "Halo {{email}}",
    preheaderId: "p",
    bodyHtmlId: '<p>Hai <a href="https://a.b">link</a> {{locale}}</p>',
    subjectEn: "Hello {{email}}",
    preheaderEn: "pe",
    bodyHtmlEn: '<p>Hi {{locale}} <a href="https://a.b">link</a></p>',
  };
  it("uses en locale and rewrites links + unsubscribe footer", () => {
    const r = renderForRecipient({
      campaign,
      locale: "en",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/tok",
      linkRewrite: (u) => `https://kado.test/api/click/L1/tok`,
    });
    expect(r.subject).toBe("Hello a@b.c");
    expect(r.html).toContain("https://kado.test/api/click/L1/tok");
    expect(r.html).toContain("unsubscribe");
    expect(r.html).toContain("https://kado.test/api/unsubscribe/tok");
    expect(r.text).toContain("Hi en");
  });
  it("falls back to id when en empty for that field", () => {
    const r = renderForRecipient({
      campaign: { ...campaign, subjectEn: "" },
      locale: "en",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(r.subject).toBe("Halo a@b.c");
  });
  it("renders id locale with id footer and replaced variables", () => {
    const r = renderForRecipient({
      campaign,
      locale: "id",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/tok",
      linkRewrite: (u) => `https://kado.test/api/click/L1/${u.includes("a.b") ? "tok" : "x"}`,
    });
    expect(r.subject).toBe("Halo a@b.c");
    expect(r.preheader).toBe("p");
    expect(r.html).toContain("https://kado.test/api/click/L1/tok");
    expect(r.html).toContain("Berhenti berlangganan");
  });
  it("text version strips tags, decodes entities, and includes unsubscribe url", () => {
    const r = renderForRecipient({
      campaign: { subjectId: "s", preheaderId: "p", bodyHtmlId: "<p>Tips &amp; trik &lt;b&gt;</p>" },
      locale: "id",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/tok",
      linkRewrite: (u) => u,
    });
    expect(r.text).toContain("Tips & trik <b>");
    expect(r.text).toContain("https://kado.test/api/unsubscribe/tok");
    expect(r.text).not.toMatch(/<p>/);
  });
  it("replaces {{email}} safely even with $-patterns in the email", () => {
    const r = renderForRecipient({
      campaign: { subjectId: "Hai $& $1 {{email}}", preheaderId: "p", bodyHtmlId: "<p>x</p>" },
      locale: "id",
      email: "a$&b@c.d",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(r.subject).toBe("Hai $& $1 a$&b@c.d");
  });
  it("replaces {{locale}} via the safe split/join helper (no regex expansion)", () => {
    const r = renderForRecipient({
      campaign: { subjectId: "Bahasa {{locale}} {{email}}", preheaderId: "p", bodyHtmlId: "<p>{{locale}}</p>" },
      locale: "id",
      email: "a$&b@c.d",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(r.subject).toBe("Bahasa id a$&b@c.d"); // literal, NOT regex replacement expansion
  });
  it("escapes the preheader after variable replacement (id and en)", () => {
    const escapeCampaign = {
      subjectId: "s",
      preheaderId: 'Hai <script>x()</script> "q"',
      bodyHtmlId: "<p>b</p>",
      preheaderEn: 'En <b>bold</b> & "q"',
    };
    for (const locale of ["id", "en"] as const) {
      const r = renderForRecipient({
        campaign: escapeCampaign,
        locale,
        email: "a@b.c",
        unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
        linkRewrite: (u) => u,
      });
      expect(r.html).not.toContain("<script>");
      expect(r.html).not.toContain("<b>bold");
      expect(r.html).toContain("&quot;q&quot;");
    }
    const id = renderForRecipient({
      campaign: escapeCampaign,
      locale: "id",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(id.html).toContain("&lt;script&gt;x()&lt;/script&gt;");
    const en = renderForRecipient({
      campaign: escapeCampaign,
      locale: "en",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => u,
    });
    expect(en.html).toContain("En &lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;");
  });
  it("passes the entity-decoded url to linkRewrite (attribute &amp; in stored html)", () => {
    const seen: string[] = [];
    const r = renderForRecipient({
      campaign: { subjectId: "s", preheaderId: "p", bodyHtmlId: '<p><a href="https://a.b/?x=1&amp;y=2">q</a></p>' },
      locale: "id",
      email: "a@b.c",
      unsubscribeUrl: "https://kado.test/api/unsubscribe/t",
      linkRewrite: (u) => {
        seen.push(u);
        return "https://kado.test/api/click/L9/t";
      },
    });
    expect(seen).toEqual(["https://a.b/?x=1&y=2"]);
    expect(r.html).toContain("https://kado.test/api/click/L9/t");
  });
});

describe("htmlToText", () => {
  it("strips tags, converts block ends and br to newlines, decodes entities, collapses whitespace", () => {
    const out = htmlToText(
      '<h2>Judul</h2><p>Hai <strong>budi</strong> &amp; <a href="https://a.b">klik</a><br>baris dua</p><p>Paragraf dua</p>',
    );
    expect(out).toBe("Judul\nHai budi & klik\nbaris dua\nParagraf dua");
    expect(out).not.toContain("<");
  });

  it("decodes quotes and nbsp", () => {
    expect(htmlToText("<p>&quot;a&quot;&#39;s&nbsp;x</p>")).toBe('"a"\'s x');
  });
});
