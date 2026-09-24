/**
 * Sumber tunggal HTML halaman 404 ramah (desain token: kanvas Ivory, kartu
 * putih, CTA Forest, karakter Kurir Nyasar). Dipakai oleh:
 *  - src/pages/404.astro (prerender → 404.html untuk host/adapter),
 *  - src/pages/r/[slug].astro + en/r/[slug].astro (render on-demand via
 *    `new Response(html, { status: 404 })` — Astro.rewrite("/404") tidak bisa
 *    menarget route prerender dari halaman server).
 * Menerima `locale` supaya rute /en/* mengembalikan copy bahasa Inggris.
 * CSS di-inline supaya dokumen berdiri sendiri (tanpa dependensi bundle).
 */
export function notFoundHtml(locale: "id" | "en" = "id"): string {
  const isEn = locale === "en";

  const copy = isEn
    ? {
        lang: "en",
        title: "Page not found — KelasWFA",
        heading: "Page not found",
        headline: "Oops! Our Courier Wandered to the Beach! 🏖️",
        lead: "The page or gift you are looking for seems to have taken a wrong turn or got misplaced in the courier bag. Don't worry, your actual gifts are safe on our main shelf!",
        cta: "Back to Homepage 🚀",
        hintsTitle: "What Could Have Happened:",
        hints: [
          "<strong>Broken Link:</strong> A character might have been clipped when copying the URL.",
          "<strong>Gift Relocated:</strong> This campaign might have moved to a fresh link.",
          "<strong>Expired Promo:</strong> The promotional period for this specific link has wrapped up.",
        ],
        supportNote:
          'Still searching for your gift? Contact our courier team at <a href="mailto:hi@kelaswfa.my.id">hi@kelaswfa.my.id</a>',
      }
    : {
        lang: "id",
        title: "Halaman tidak ditemukan — KelasWFA",
        heading: "Halaman tidak ditemukan",
        headline: "Waduh, Kurirnya Malah Nyasar ke Pantai! 🏖️",
        lead: "Paket kado atau halaman yang kamu cari sepertinya salah alamat atau terselip di bagasi kurir. Jangan sedih, kado aslimu masih aman di rak utama kami!",
        cta: "Kembali ke Beranda 🚀",
        hintsTitle: "Kemungkinan Penyebab:",
        hints: [
          "<strong>Tautan Terpotong:</strong> Mungkin ada huruf atau karakter yang hilang saat menyalin link.",
          "<strong>Hadiah Berpindah Tempat:</strong> Campaign kado mungkin sudah diperbarui ke tautan yang baru.",
          "<strong>Tautan Kedaluwarsa:</strong> Promo atau masa aktif kado ini sudah selesai.",
        ],
        supportNote:
          'Tetap butuh bantuan mencari kado? Hubungi tim kurir di <a href="mailto:hi@kelaswfa.my.id">hi@kelaswfa.my.id</a>',
      };

  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${copy.title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
      :root {
        --color-canvas: #FFFCF5;
        --color-surface-subtle: #F7F1E6;
        --color-surface-raised: #FFFFFF;
        --color-ink: #153B35;
        --color-text: #36514B;
        --color-text-muted: #566662;
        --color-border: #E7DED0;
        --color-primary: #176B5B;
        --color-primary-hover: #105447;
        --color-primary-subtle: #E5F2EE;
        --color-gold: #D99020;
        --color-warning: #9A6514;
        --color-warning-subtle: #FFF4DC;
        --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
        --radius-control: 12px;
        --radius-card: 22px;
        --radius-pill: 999px;
        --border-default: 1px solid var(--color-border);
        --shadow-card: 0 1px 2px rgba(21, 59, 53, 0.04), 0 12px 36px rgba(21, 59, 53, 0.07);
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        color: var(--color-text);
        background: var(--color-canvas);
        -webkit-font-smoothing: antialiased;
      }

      /* Header Bar */
      .desk-header {
        height: 68px;
        border-bottom: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 24px;
        background: rgba(255, 252, 245, 0.85);
        backdrop-filter: blur(8px);
      }

      .desk-logo {
        font-weight: 800;
        font-size: 18px;
        color: var(--color-ink);
        text-decoration: none;
        letter-spacing: -0.02em;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .desk-logo-badge {
        font-size: 11px;
        font-weight: 700;
        background: var(--color-surface-subtle);
        border: 1px solid var(--color-border);
        padding: 2px 8px;
        border-radius: var(--radius-pill);
        color: var(--color-text-muted);
      }

      .header-status-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 700;
        color: #A34824;
        background: #FFF0E8;
        padding: 6px 12px;
        border-radius: var(--radius-pill);
        border: 1px solid rgba(163, 72, 36, 0.2);
      }

      /* Main Container */
      .not-found-main {
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
        padding: 44px 20px 64px;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      /* Card Box */
      .not-found-card {
        background: var(--color-surface-raised);
        border: var(--border-default);
        border-radius: var(--radius-card);
        padding: 36px 32px 32px;
        box-shadow: var(--shadow-card);
        position: relative;
        overflow: hidden;
        text-align: center;
      }

      /* Top Accent Ribbon */
      .not-found-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #F06A3A 0%, var(--color-gold) 50%, var(--color-primary) 100%);
      }

      /* Illustration Stage */
      .illustration-stage {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
      }

      .character-img {
        width: 250px;
        max-width: 100%;
        height: auto;
        display: block;
        margin: 0 auto;
        filter: drop-shadow(0 12px 20px rgba(21, 59, 53, 0.12));
        animation: floatCourier 3.5s ease-in-out infinite alternate;
        transition: transform 0.25s ease;
      }

      .character-img:hover {
        transform: scale(1.04) rotate(-2deg);
      }

      @keyframes floatCourier {
        0% { transform: translateY(0px); }
        100% { transform: translateY(-8px); }
      }

      /* Floating Question Mark Balloon */
      .question-balloon {
        position: absolute;
        top: 4px;
        right: 12px;
        background: #FFFFFF;
        border: 1.5px solid var(--color-border);
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 4px 12px rgba(21, 59, 53, 0.1);
        animation: pulseBalloon 2s ease-in-out infinite;
      }

      @keyframes pulseBalloon {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.12); }
      }

      /* Status Sub-heading Badge */
      .not-found-sub {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #D14D1A;
        background: #FFF2E8;
        display: inline-block;
        padding: 5px 14px;
        border-radius: var(--radius-pill);
        margin: 0 auto 12px;
        border: 1px solid rgba(240, 106, 58, 0.25);
      }

      .not-found-title {
        font-size: clamp(23px, 4.2vw, 28px);
        font-weight: 800;
        color: var(--color-ink);
        line-height: 1.25;
        letter-spacing: -0.02em;
        margin-bottom: 12px;
      }

      .not-found-lead {
        font-size: 15px;
        line-height: 1.65;
        color: var(--color-text-muted);
        margin-bottom: 22px;
        max-width: 480px;
        margin-left: auto;
        margin-right: auto;
      }

      /* Action Buttons */
      .action-group {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 24px;
      }

      .btn-primary-home {
        background: var(--color-primary);
        color: #FFFFFF;
        text-decoration: none;
        padding: 14px 24px;
        border-radius: var(--radius-control);
        font-weight: 700;
        font-size: 15px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        min-height: 48px;
        box-shadow: 0 4px 14px rgba(23, 107, 91, 0.25);
      }

      .btn-primary-home:hover {
        background: var(--color-primary-hover);
        box-shadow: 0 6px 18px rgba(23, 107, 91, 0.32);
        transform: translateY(-1px);
      }

      .btn-primary-home:active {
        transform: translateY(1px);
      }

      /* Helpful Hints Card */
      .hints-card {
        background: var(--color-surface-subtle);
        border: 1px solid var(--color-border);
        border-radius: 16px;
        padding: 18px 20px;
        text-align: left;
      }

      .hints-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-ink);
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .hints-list {
        list-style: none;
        display: grid;
        gap: 10px;
        padding: 0;
        margin: 0;
      }

      .hint-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        color: var(--color-text);
        line-height: 1.5;
      }

      .hint-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #FFFFFF;
        border: 1px solid var(--color-border);
        font-size: 10px;
        font-weight: 800;
        color: var(--color-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }

      /* Support Footer */
      .not-found-footer {
        margin-top: 24px;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-muted);
        line-height: 1.6;
      }

      .not-found-footer a {
        color: var(--color-primary);
        font-weight: 600;
        text-decoration: underline;
      }

      /* Mobile Viewport (< 640px) */
      @media (max-width: 640px) {
        .desk-header {
          height: 56px;
          padding: 0 16px;
        }
        .desk-logo {
          font-size: 16px;
        }
        .header-status-badge {
          font-size: 11px;
          padding: 4px 8px;
        }
        .not-found-main {
          padding: 24px 16px 40px;
        }
        .not-found-card {
          padding: 24px 18px 24px;
          border-radius: 18px;
        }
        .character-img {
          width: 190px;
        }
        .question-balloon {
          width: 32px;
          height: 32px;
          font-size: 15px;
          right: 4px;
        }
        .not-found-title {
          font-size: 21px;
        }
        .not-found-lead {
          font-size: 14px;
          margin-bottom: 18px;
        }
        .hints-card {
          padding: 16px 14px;
        }
        .hint-item {
          font-size: 12px;
        }
        .not-found-footer {
          font-size: 12px;
        }
      }
    </style>
  </head>
  <body>
    <!-- App Header Bar -->
    <header class="desk-header">
      <a href="/" class="desk-logo">
        <span>KelasWFA</span>
        <span class="desk-logo-badge">Kado Desk</span>
      </a>
      <div class="header-status-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>${isEn ? "404 Courier Lost" : "404 Kurir Nyasar"}</span>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="not-found-main">
      <section class="not-found-card">
        <!-- Character Illustration Stage -->
        <div class="illustration-stage">
          <img 
            src="/images/404-kurir-nyasar.png" 
            alt="${isEn ? "Cute gift courier lost at the beach" : "Karakter Kado Kurir Nyasar ke Pantai"}" 
            class="character-img"
            width="250"
            height="250"
            loading="eager"
          />
          <div class="question-balloon" aria-hidden="true" title="${isEn ? "Where is the address?" : "Hah, mana alamatnya?"}">🗺️</div>
        </div>

        <!-- Status Sub-heading Badge -->
        <h2 class="not-found-sub">${copy.heading}</h2>

        <!-- Primary Headline -->
        <h1 class="not-found-title">${copy.headline}</h1>

        <!-- Explanation Lead -->
        <p class="not-found-lead">${copy.lead}</p>

        <!-- Primary CTA Action -->
        <div class="action-group">
          <a href="/" class="btn-primary-home">
            <span>${copy.cta}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>

        <!-- Helpful Hints Card -->
        <div class="hints-card">
          <div class="hints-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span>${copy.hintsTitle}</span>
          </div>
          <ul class="hints-list">
            ${copy.hints
              .map(
                (h, i) => `
              <li class="hint-item">
                <span class="hint-dot" aria-hidden="true">${i + 1}</span>
                <span>${h}</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      </section>

      <!-- Support Footer -->
      <footer class="not-found-footer">
        <p>${copy.supportNote}</p>
      </footer>
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
