import { beforeEach, describe, expect, it } from "vitest";
import { sendViaEmailit } from "../src/lib/emailit";
import { EMAIL_REPLY_TO } from "../src/lib/templates";
import { setEnv } from "./helpers";

beforeEach(() => setEnv({ EMAILIT_API_KEY: "k" }));

describe("sendViaEmailit", () => {
  it("sends payload with reply_to from EMAIL_REPLY_TO", async () => {
    let captured: Record<string, unknown> | undefined;
    let authHeader: string | undefined;
    const fetchMock = (async (_url: unknown, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.Authorization;
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "emailit-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const id = await sendViaEmailit(
      {
        from: "KelasWFA <admin@kelaswfa.my.id>",
        to: "budi@gmail.com",
        subject: "Hadiah KelasWFA-mu",
        html: "<p>Hadiah sudah siap diunduh.</p>",
        text: "Hadiah sudah siap diunduh.",
        idempotencyKey: "confirm-abc",
      },
      fetchMock,
    );

    expect(id).toBe("emailit-1");
    expect(authHeader).toBe("Bearer k");
    expect(captured).toMatchObject({
      from: "KelasWFA <admin@kelaswfa.my.id>",
      to: ["budi@gmail.com"],
      reply_to: EMAIL_REPLY_TO,
      subject: "Hadiah KelasWFA-mu",
    });
  });

  it("throws with provider status on non-ok response", async () => {
    const fetchMock = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      sendViaEmailit({ from: "a@b.c", to: "budi@gmail.com", subject: "s", html: "<p>x</p>", text: "x" }, fetchMock),
    ).rejects.toThrow(/Emailit 500/);
  });
});
