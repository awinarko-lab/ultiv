import { describe, expect, it } from "vite-plus/test";
import { makeRedactor, materialForms, secretForms } from "./redact.ts";

const SECRET = 'sk_live_Ab+/=9 xyz"q';

describe("redaction", () => {
  const scrub = makeRedactor(materialForms({ secret: SECRET, username: "harry" }), "Stripe");
  const clean = (text: string) => expect(scrub(text)).not.toMatch(/sk_live|harry:/);

  it("scrubs the raw secret and its URL, form, JSON and hex encodings", () => {
    for (const form of [
      SECRET,
      encodeURIComponent(SECRET),
      encodeURIComponent(SECRET).replace(/%20/g, "+"),
      JSON.stringify(SECRET).slice(1, -1),
      Buffer.from(SECRET).toString("hex"),
      Buffer.from(SECRET).toString("hex").toUpperCase(),
    ]) {
      const out = scrub(`before ${form} after`);
      expect(out).toBe("before [redacted:Stripe] after");
    }
  });

  it("scrubs base64/base64url at any byte offset and the Basic pair", () => {
    for (const prefix of ["", "a", "ab", "abc"]) {
      const encoded = Buffer.from(`${prefix}${SECRET}tail`).toString("base64");
      expect(scrub(encoded)).toContain("[redacted:Stripe]");
      const url = Buffer.from(`${prefix}${SECRET}`).toString("base64url");
      expect(scrub(url)).toContain("[redacted:Stripe]");
    }
    const basic = `Basic ${Buffer.from(`harry:${SECRET}`).toString("base64")}`;
    expect(scrub(basic)).toBe("Basic [redacted:Stripe]");
    clean(JSON.stringify({ echoed: { authorization: basic, q: encodeURIComponent(SECRET) } }));
  });

  it("leaves unrelated text alone and skips forms too short to be safe", () => {
    expect(scrub("nothing to see here")).toBe("nothing to see here");
    expect(secretForms("ab")).toEqual([]);
  });
});
