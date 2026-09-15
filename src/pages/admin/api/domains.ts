import type { APIRoute } from "astro";
import { addDomain, listDomains, removeDomain, setDomainActive } from "../../../lib/admin/domains";
// Route on-demand — tidak pernah diprerender.
import { getAdmin, verifyAdminOrigin } from "../../../lib/admin/guard";
import { clientIp } from "../../../lib/ip";

export const prerender = false;

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: noStore });
}

type Body = { domain?: unknown; active?: unknown };

function domainOf(body: Body): string {
  return typeof body.domain === "string" ? body.domain : "";
}

async function readBody(request: Request): Promise<Body> {
  try {
    return (await request.json()) as Body;
  } catch {
    return {};
  }
}

function auditOpts(request: Request, adminId: string) {
  return {
    adminUserId: adminId,
    ip: clientIp(request),
  };
}

/**
 * GET /admin/api/domains — daftar allowlist domain terurut.
 * POST  { domain }              → tambah (audit domain_added)
 * PATCH { domain, active }      → toggle aktif/nonaktif (audit domain_toggled)
 * DELETE { domain }             → hapus (audit domain_removed)
 * Cookie tidak valid → 401. Domain invalid → 400 "invalid-domain";
 * duplikat → 409 "already-exists"; target tidak ada → 404.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);
  return json({ ok: true, domains: await listDomains() });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);
  const body = await readBody(request);
  const res = await addDomain(domainOf(body), auditOpts(request, admin.id));
  if (!res.ok) return json({ ok: false, reason: res.reason }, res.reason === "already-exists" ? 409 : 400);
  return json({ ok: true, domain: res.domain, domains: await listDomains() });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);
  const body = await readBody(request);
  const active = body.active === true;
  const res = await setDomainActive(domainOf(body), active, auditOpts(request, admin.id));
  if (!res.ok) return json({ ok: false, reason: res.reason }, res.reason === "invalid-domain" ? 404 : 400);
  return json({ ok: true, domains: await listDomains() });
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, reason: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const admin = await getAdmin(cookies);
  if (!admin) return json({ ok: false, reason: "unauthorized" }, 401);
  const body = await readBody(request);
  const res = await removeDomain(domainOf(body), auditOpts(request, admin.id));
  if (!res.ok) return json({ ok: false, reason: res.reason }, res.reason === "invalid-domain" ? 404 : 400);
  return json({ ok: true, domains: await listDomains() });
};
