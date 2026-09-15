const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guard format UUID (task 1.9 / 08-N2): nilai path parameter yang bukan UUID
 * valid (mis. `abc`, `favicon.ico`) yang diteruskan ke query kolom uuid memicu
 * error syntax PostgreSQL 22P02 — HTTP 500 alih-alih 400/404. Cek regex dulu
 * sebelum menyentuh database.
 */
export function isValidUuid(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_REGEX.test(id);
}
