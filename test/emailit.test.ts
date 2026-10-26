import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendViaEmailit } from "../src/lib/emailit";
import { EMAIL_REPLY_TO } from "../src/lib/templates";
import { setEnv } from "./helpers";

beforeEach(() => setEnv({ EMAILIT_API_KEY: "k" }));

describe("sendViaEmailit", () => {
  it("sends payload with reply_to from EMAIL_REPLY_TO", async () => {
    let captured: Record<string, unknown> | undefined;
    let authHeader: string | undefined;
    let calledUrl: unknown;
    const fetchMock = (async (url: unknown, init?: RequestInit) => {
      calledUrl = url;
      authHeader = (init?.headers as Record<string, string>)?.Authorization;
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "emailit-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const id = await sendViaEmailit(
      {
        from: "KelasWFA <hi@kelaswfa.my.id>",
        to: "budi@gmail.com",
        subject: "Hadiah KelasWFA-mu",
        html: "<p>Hadiah sudah siap diunduh.</p>",
        text: "Hadiah sudah siap diunduh.",
        idempotencyKey: "confirm-abc",
      },
      fetchMock,
    );

    expect(id).toBe("emailit-1");
    expect(calledUrl).toBe("https://api.emailit.com/v2/emails");
    expect(authHeader).toBe("Bearer k");
    expect(captured).toMatchObject({
      from: "KelasWFA <hi@kelaswfa.my.id>",
      to: ["budi@gmail.com"],
      reply_to: EMAIL_REPLY_TO,
      subject: "Hadiah KelasWFA-mu",
    });
  });

  it("respects custom replyTo when specified", async () => {
    let captured: Record<string, unknown> | undefined;
    const fetchMock = (async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "emailit-2" }), { status: 200 });
    }) as unknown as typeof fetch;

    await sendViaEmailit(
      {
        from: "KelasWFA <kurir@kelaswfa.my.id>",
        replyTo: "kurir@kelaswfa.my.id",
        to: "budi@gmail.com",
        subject: "Newsletter",
        html: "<p>Halo</p>",
        text: "Halo",
      },
      fetchMock,
    );

    expect(captured).toMatchObject({
      from: "KelasWFA <kurir@kelaswfa.my.id>",
      to: ["budi@gmail.com"],
      reply_to: "kurir@kelaswfa.my.id",
    });
  });

  it("throws with provider status on non-ok response", async () => {
    const fetchMock = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      sendViaEmailit({ from: "a@b.c", to: "budi@gmail.com", subject: "s", html: "<p>x</p>", text: "x" }, fetchMock),
    ).rejects.toThrow(/Emailit 500/);
  });

  it("paces default transport to EMAILIT_MAX_PER_SECOND", async () => {
    setEnv({ EMAILIT_MAX_PER_SECOND: "2" });
    const startedAt: number[] = [];
    const fetchStub = vi.fn(async () => {
      startedAt.push(Date.now());
      return new Response(JSON.stringify({ id: `paced-${startedAt.length}` }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const payload = { from: "a@b.c", to: "budi@gmail.com", subject: "s", html: "<p>x</p>", text: "x" };
      await sendViaEmailit(payload);
      await sendViaEmailit(payload);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(startedAt).toHaveLength(2);
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(400);
  });
});
