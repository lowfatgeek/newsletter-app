import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { contacts } from "../src/lib/schema";
import { resetDb } from "./helpers";

describe("schema", () => {
  beforeEach(resetDb);
  it("inserts and reads a contact", async () => {
    await db.insert(contacts).values({ emailNormalized: "a@b.com" });
    const [row] = await db.select().from(contacts).where(eq(contacts.emailNormalized, "a@b.com"));
    expect(row.confirmationStatus).toBe("pending");
  });
  it("rejects duplicate email", async () => {
    await db.insert(contacts).values({ emailNormalized: "dup@b.com" });
    await expect(db.insert(contacts).values({ emailNormalized: "dup@b.com" })).rejects.toThrow();
  });
});
