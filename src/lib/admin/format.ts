/**
 * Format ukuran file untuk tampilan admin/publik: KB di bawah 1 MB,
 * MB (1 desimal) mulai 1 MB.
 */
export function humanSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
