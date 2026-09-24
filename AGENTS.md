## Status Proyek & Arsitektur Aktif (September 2026)

Seluruh perombakan antarmuka publik telah **100% selesai diimplementasikan** mengikuti filosofi Hallmark "Desk Pattern Family":
- **`/r/[slug]` & `/en/r/[slug]`**: "The Progressive Modal Desk" (Showcase 1-kolom terfokus + modal/bottom-sheet ritual claim dengan timer 30 detik on-demand).
- **`/cek-email` & `/en/cek-email`**: "The Express Inbox Desk" (Panduan 1-kolom terfokus, tombol webmail cepat Gmail/Outlook, dan info whitelist kontak resmi).
- **`/akses/[token]` & `/en/akses/[token]`**: "The Download Desk" (Pengambilan file reward resmi dengan token 7 hari dan signed URL 1 jam).
- **`/konfirmasi/[token]` & `/en/konfirmasi/[token]`**: "The Reassurance Desk" (Konfirmasi double opt-in dengan transisi langsung ke akses reward).
- **`/404`**: "The Lost Courier Desk" (Halaman error ramah pengguna berilustrasi kurir pos dengan navigasi kembali).

### Arsitektur Pengirim Email (Dual-Sender)
- **Transaksional** (OTP login admin, konfirmasi double opt-in, link akses kado): `KelasWFA <hi@kelaswfa.my.id>`
- **Broadcast Newsletter** (Kampanye berkala ke subscriber): `KelasWFA <kurir@kelaswfa.my.id>`

### Aturan & Quality Gate
1. **Design Tokens & Copywriting**: Tetap patuhi `.agents/DESIGN.md` dan `src/styles/tokens.css`. Copywriting tidak boleh diubah sembarangan tanpa persetujuan.
2. **Quality Gate CI**: Kode wajib lolos `npm run lint` (Biome), `npm run check` (Astro Check), `npm run test` (Vitest), dan `npm run build`. File preview statis di `preview/` diabaikan oleh Biome (`biome.json`).
3. **Logika Bisnis & Anti-Bot**: Validasi server-side 30s token, rate limiting IP/email, dan honeypot wajib selalu aktif.

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
