import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mintTrustedDevice,
  resolveTrustedDevice,
  revokeAllDevices,
  revokeTrustedDevice,
} from "../../src/lib/admin/devices";
import { db } from "../../src/lib/db";
import { adminUsers, trustedDevices } from "../../src/lib/schema";
import { resetDb } from "../helpers";

async function seedAdmin() {
  const [u] = await db.insert(adminUsers).values({ email: "a@gmail.com", passwordHash: "h" }).returning();
  return u;
}

describe("trusted devices", () => {
  beforeEach(resetDb);

  it("mint → resolve round-trip, 30 days expiry", async () => {
    const u = await seedAdmin();
    const d = await mintTrustedDevice(u.id, "Mozilla/5.0");
    const row = await db.select().from(trustedDevices).where(eq(trustedDevices.id, d.id));
    const days = (row[0].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(await resolveTrustedDevice(d.raw)).toMatchObject({ adminUserId: u.id });
  });

  it("revoked single and revoke-all", async () => {
    const u = await seedAdmin();
    const d1 = await mintTrustedDevice(u.id);
    const d2 = await mintTrustedDevice(u.id);
    await revokeTrustedDevice(d1.id);
    expect(await resolveTrustedDevice(d1.raw)).toBeNull();
    await revokeAllDevices(u.id);
    expect(await resolveTrustedDevice(d2.raw)).toBeNull();
  });

  it("garbage/undefined resolves null", async () => {
    expect(await resolveTrustedDevice("x")).toBeNull();
    expect(await resolveTrustedDevice(undefined)).toBeNull();
  });
});
