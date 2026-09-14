import type { APIRoute } from "astro";

// Route on-demand — tidak pernah diprerender.
import { getAdmin } from "../../../../../lib/admin/guard";
import { sendTestEmail } from "../../../../../lib/broadcast/stats";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: noStore });

/**
 * POST /admin/api/email-campaigns/[id]/test-send — kirim email uji.
 * Body JSON { address } — alamat harus ada di allowlist TEST_SEND_ADDRESSES.
 * 200 { ok:true } · 400 not-allowed (alamat luar allowlist) /
 * no-content (konten ID belum lengkap) · 401.
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  const id = params.id ?? "";
  if (!id) return json({ ok: false, reason: "invalid" }, 400);

  let body: { address?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const result = await sendTestEmail(
    id, address,
    { adminUserId: admin.id, ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
  );
  if (result.ok) return json({ ok: true });
  return json({ ok: false, reason: result.reason }, 400);
};
