/**
 * Preflight deploy: mencetak konfigurasi runtime yang benar-benar diterima
 * container ke log (Easypanel/VPS), lalu menguji koneksi database.
 *
 * Tujuan: diagnosa tanpa akses Console. Kalau panel menyuntikkan `PORT`
 * sendiri, baris `PORT=` di sini yang membuktikannya — bukan `ENV` di
 * Dockerfile. Skrip ini TIDAK pernah membuat container gagal start: semua
 * kegagalan dilaporkan sebagai log, lalu server tetap dijalankan (kesiapan
 * dilaporkan terpisah oleh /api/health).
 */
const show = (v) => (v === undefined || v === "" ? "(tidak di-set)" : v);

console.log(
  `[preflight] NODE_ENV=${show(process.env.NODE_ENV)} HOST=${show(process.env.HOST)} PORT=${show(
    process.env.PORT,
  )} (Dockerfile default: HOST=0.0.0.0 PORT=4321)`,
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[preflight] DATABASE_URL belum di-set → /api/health akan 503 sampai diisi");
} else {
  let target = "?";
  try {
    const parsed = new URL(url);
    target = `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    target = "(URL tidak valid)";
  }
  try {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: 1, connect_timeout: 5 });
    try {
      await sql`select 1`;
      console.log(`[preflight] DB OK → ${target}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (error) {
    // Contoh paling umum di Easypanel: host di DATABASE_URL tidak sama dengan
    // nama service Postgres (mis. `@db` padahal service-nya bernama `kadodb`).
    console.log(`[preflight] DB GAGAL → ${target} : ${error?.message ?? error}`);
  }
}
