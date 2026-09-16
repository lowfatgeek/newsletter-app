import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureAdmin } from "../../src/lib/admin/bootstrap";
import { verifyPassword } from "../../src/lib/admin/password";
import { db } from "../../src/lib/db";
import { adminUsers } from "../../src/lib/schema";
import { resetDb, setEnv } from "../helpers";

const EMAIL = "boss@kelaswfa.test";
const STRONG = "AdminPassword123";

async function adminRows() {
  return db.select().from(adminUsers).where(eq(adminUsers.email, EMAIL));
}

describe("ensureAdmin", () => {
  beforeEach(async () => {
    await resetDb();
    setEnv({ ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: "" });
  });

  it("creates the admin once and is idempotent on repeat calls", async () => {
    // Catatan: password dari `resetPassword` ikut dilaporkan sebagai
    // generatedPassword bila ADMIN_PASSWORD tidak diset — perilaku lama yang
    // dipertahankan (pemanggil seperti scripts/seed.ts mengabaikan nilai ini).
    const first = await ensureAdmin({ resetPassword: STRONG });
    expect(first).toEqual({ created: true, email: EMAIL, generatedPassword: STRONG });

    const second = await ensureAdmin({ resetPassword: STRONG });
    expect(second).toEqual({ created: false, email: EMAIL });
    expect(await adminRows()).toHaveLength(1);
  });

  it("keeps a single row when two bootstraps race (atomic insert)", async () => {
    const results = await Promise.all([ensureAdmin({ resetPassword: STRONG }), ensureAdmin({ resetPassword: STRONG })]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await adminRows()).toHaveLength(1);
  });

  it("returns a generated password only when none is configured", async () => {
    const generated = await ensureAdmin();
    expect(generated.created).toBe(true);
    expect(generated.generatedPassword).toBeTruthy();
    expect(await verifyPassword((await adminRows())[0].passwordHash, generated.generatedPassword!)).toBe(true);

    await resetDb();
    setEnv({ ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: STRONG });
    const configured = await ensureAdmin();
    expect(configured.generatedPassword).toBeUndefined();
    expect(await verifyPassword((await adminRows())[0].passwordHash, STRONG)).toBe(true);
  });

  it("resetPassword overwrites the stored hash of an existing admin", async () => {
    await ensureAdmin({ resetPassword: STRONG });
    const rotated = "RotatedPassword456";
    expect(await ensureAdmin({ resetPassword: rotated })).toEqual({ created: false, email: EMAIL });

    const [row] = await adminRows();
    expect(await verifyPassword(row.passwordHash, rotated)).toBe(true);
    expect(await verifyPassword(row.passwordHash, STRONG)).toBe(false);
  });
});
