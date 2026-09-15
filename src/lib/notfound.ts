/**
 * Sumber tunggal HTML halaman 404 ramah (desain token: kanvas Ivory, kartu
 * putih, CTA Forest). Dipakai oleh:
 *  - src/pages/404.astro (prerender → 404.html untuk host/adapter),
 *  - src/pages/r/[slug].astro + en/r/[slug].astro (render on-demand via
 *    `new Response(html, { status: 404 })` — Astro.rewrite("/404") tidak bisa
 *    menarget route prerender dari halaman server).
 * Task 2.14 / 11-C4: menerima `locale` supaya rute /en/* mengembalikan copy
 * bahasa Inggris. CSS di-inline supaya dokumen berdiri sendiri (tanpa
 * dependensi bundle).
 */
export function notFoundHtml(locale: "id" | "en" = "id"): string {
  const copy =
    locale === "en"
      ? {
          lang: "en",
          title: "Page not found",
          heading: "Page not found",
          body: "The page or gift you are looking for may have moved, or the link is no longer valid.",
          cta: "Back to the homepage",
        }
      : {
          lang: "id",
          title: "Halaman tidak ditemukan",
          heading: "Halaman tidak ditemukan",
          body: "Halaman atau hadiah yang kamu cari mungkin sudah dipindah atau tautannya tidak berlaku lagi.",
          cta: "Kembali ke beranda",
        };
  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${copy.title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 20px;
        box-sizing: border-box;
        font-family: "Plus Jakarta Sans", Arial, Helvetica, sans-serif;
        color: #36514B;
        background: #FFFCF5;
      }
      .card {
        background: #ffffff;
        border: 1px solid #E7DED0;
        border-radius: 20px;
        box-shadow: 0 1px 2px rgba(21, 59, 53, 0.04), 0 4px 16px rgba(21, 59, 53, 0.06);
        padding: 40px 32px;
        max-width: 480px;
        text-align: center;
      }
      .code { color: #176B5B; font-size: 2.5rem; font-weight: 700; margin: 0; line-height: 1.2; }
      h1 { color: #153B35; font-size: 1.5rem; margin: 12px 0 8px; line-height: 1.3; }
      p { color: #6C7E79; margin: 0 0 24px; line-height: 1.6; }
      a {
        background: #176B5B;
        color: #ffffff;
        text-decoration: none;
        padding: 12px 24px;
        border-radius: 12px;
        font-weight: 600;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
      a:hover { background: #124F44; }
    </style>
  </head>
  <body>
    <main style="width: 100%; display: flex; justify-content: center;">
      <section class="card">
        <p class="code">404</p>
        <h1>${copy.heading}</h1>
        <p>${copy.body}</p>
        <a href="/">${copy.cta}</a>
      </section>
    </main>
  </body>
</html>`;
}

/**
 * Response 404 on-demand (dipakai r/[slug].astro + en/r/[slug].astro).
 * Astro.rewrite("/404") tidak bisa menarget route prerender dari halaman
 * server, jadi respons dibuat manual di sini (sumber tunggal).
 */
export function notFoundResponse(locale: "id" | "en" = "id"): Response {
  return new Response(notFoundHtml(locale), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
