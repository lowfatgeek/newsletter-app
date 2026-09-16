/**
 * Utilitas SQLSTATE Postgres (task 3.5 / 08-N4 — dipakai bersama oleh
 * broadcast/machine.ts dan admin/campaigns.ts).
 *
 * drizzle-orm 0.45 membungkus PostgresError di dalam DrizzleQueryError
 * (kode ada di `.cause`), sedangkan postgres-js telanjang menyimpannya
 * langsung di error — jadi rantai `cause` perlu ditelusuri.
 */
export function pgErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = err as { code?: string; cause?: unknown } | null | undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string") return current.code;
    current = current.cause as { code?: string; cause?: unknown } | undefined;
  }
  return undefined;
}

/** SQLSTATE 23505 — unique_violation. */
export const PG_UNIQUE_VIOLATION = "23505";
