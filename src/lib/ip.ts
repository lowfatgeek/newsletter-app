/**
 * IP klien dari header proxy.
 *
 * ASUMSI: tepat SATU trusted proxy di depan aplikasi (Vercel/edge) yang
 * menambahkan hop klien sebagai elemen TERAKHIR `X-Forwarded-For`. Aplikasi
 * tidak diekspos langsung ke internet. Klien bisa memalsukan hop awal header,
 * jadi kita TIDAK memakai elemen pertama — ambil elemen terakhir yang
 * ditambahkan proxy terpercaya.
 *
 * Fallback: header `x-real-ip`, lalu "0.0.0.0" (agar rate-limit tetap punya
 * bucket, bukan crash).
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}
