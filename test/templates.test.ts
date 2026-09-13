import { describe, it, expect } from "vitest";
import { maskedEmail, confirmationEmail, rewardAccessEmail, EMAIL_FROM } from "../src/lib/templates";

describe("maskedEmail", () => {
  it("masks local part", () => {
    expect(maskedEmail("budi@gmail.com")).toBe("bu**@gmail.com");
    expect(maskedEmail("a@gmail.com")).toBe("a**@gmail.com");
  });
});

describe("confirmationEmail", () => {
  it("id content mentions confirmation and link", () => {
    const m = confirmationEmail("id", "https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.subject).toContain("Konfirmasi");
    expect(m.html).toContain("https://kado.kelaswfa.my.id/konfirmasi/tok");
    expect(m.html).toContain("lang=\"id\"");
  });
  it("en content falls back structure", () => {
    const m = confirmationEmail("en", "https://x/konfirmasi/t");
    expect(m.html).toContain("lang=\"en\"");
    expect(m.subject).not.toContain("Konfirmasi");
  });
});

describe("rewardAccessEmail", () => {
  it("includes reward title and access link", () => {
    const m = rewardAccessEmail("id", "https://x/akses/t", "Starter Checklist");
    expect(m.html).toContain("Starter Checklist");
    expect(m.html).toContain("https://x/akses/t");
  });
  it("sets from header constant", () => {
    expect(EMAIL_FROM).toBe("KelasWFA <admin@kelaswfa.my.id>");
  });
});
