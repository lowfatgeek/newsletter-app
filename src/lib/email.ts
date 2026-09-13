const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length === 0 || v.length > 254) return null;
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

export function emailDomain(normalized: string): string {
  return normalized.split("@")[1];
}
