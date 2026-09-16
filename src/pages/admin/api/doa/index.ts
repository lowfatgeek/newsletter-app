import type { APIRoute } from "astro";
import {
  type DoaVariant,
  deleteDoaTemplateGroup,
  listGroupedDoaTemplates,
  upsertDoaTemplate,
} from "../../../../lib/admin/doa";
import { getAdmin, verifyAdminOrigin } from "../../../../lib/admin/guard";
import { clientIp } from "../../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

function auditOpts(request: Request, adminId: string) {
  return {
    adminUserId: adminId,
    ip: clientIp(request),
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);
  return json({ ok: true, templates: await listGroupedDoaTemplates() });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return json({ ok: false, reason: "forbidden" }, 403);
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  let body: {
    variant?: unknown;
    name?: unknown;
    contentId?: unknown;
    contentEn?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const variant = typeof body.variant === "string" ? (body.variant as DoaVariant) : undefined;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const contentId = typeof body.contentId === "string" ? body.contentId.trim() : "";
  const contentEn = typeof body.contentEn === "string" ? body.contentEn.trim() : undefined;

  if (!variant || !name || !contentId) {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const res = await upsertDoaTemplate(
    { variant, name, contentId, contentEn },
    auditOpts(request, admin.id),
  );

  if (!res.ok) return json({ ok: false, reason: res.reason }, 400);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return json({ ok: false, reason: "forbidden" }, 403);
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);

  let body: { variant?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const variant = typeof body.variant === "string" ? (body.variant as DoaVariant) : undefined;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!variant || !name) return json({ ok: false, reason: "invalid" }, 400);

  const res = await deleteDoaTemplateGroup(variant, name, auditOpts(request, admin.id));
  if (!res.ok) {
    const status = res.reason === "in-use" ? 409 : 404;
    return json({ ok: false, reason: res.reason }, status);
  }
  return json({ ok: true });
};
