import { describe, expect, it } from "vitest";
import { GET } from "../src/pages/api/health";

describe("GET /api/health", () => {
  it("returns ok when db reachable", async () => {
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ status: "ok" }));
  });
});
