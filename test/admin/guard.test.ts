import { beforeEach, describe, expect, it } from "vitest";
import { mintTrustedDevice } from "../../src/lib/admin/devices";
import { getAdmin } from "../../src/lib/admin/guard";
import { createAdminSession } from "../../src/lib/admin/sessions";
import { db } from "../../src/lib/db";
import { adminUsers } from "../../src/lib/schema";
import { resetDb } from "../helpers";

function fakeCookies(map: Record<string, string>) {
  return { get: (name: string) => (name in map ? { value: map[name] } : undefined) };
}

describe("getAdmin", () => {
  beforeEach(resetDb);
  it("session cookie resolves", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
    const s = await createAdminSession(u.id);
    const admin = await getAdmin(fakeCookies({ kado_admin_session: s.raw }));
    expect(admin?.email).toBe("a@gmail.com");
  });
  it("device cookie resolves", async () => {
    const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
    const d = await mintTrustedDevice(u.id);
    const admin = await getAdmin(fakeCookies({ kado_admin_device: d.raw }));
    expect(admin?.id).toBe(u.id);
  });
  it("no cookies → null", async () => {
    expect(await getAdmin(fakeCookies({}))).toBeNull();
  });
});
