## Active Next Task: Reward Page Redesign ("The Progressive Modal Desk")

Task prioritas implementasi UI/UX adalah **Redesign Halaman Reward Publik (`/r/[slug]` dan `/en/r/[slug]`)**.
- **Konsep Terpilih**: **"The Progressive Modal Desk"** (Showcase 1-Kolom Terfokus + Modal/Bottom-Sheet Ritual).
- **Aturan Terkunci**:
  1. Copywriting 100% TETAP (tidak boleh diubah).
  2. Design tokens & filosofi `.agents/DESIGN.md` TETAP dipertahankan.
  3. Timer 30 detik baru mulai berjalan saat modal dibuka (bukan saat halaman dibuka).
  4. Logika bisnis anti-bot dan form klaim tetap 100%.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
