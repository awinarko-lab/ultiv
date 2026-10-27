/**
 * Secret redaction for everything model-facing and every log line: the raw
 * secret plus its common encodings (URL/form encoding, base64 and base64url
 * at every byte alignment, hex, JSON escaping, and Basic `user:secret`).
 */

/** Below this length a form is too generic to scrub safely; secrets that short are refused upstream. */
const MIN_FORM = 4;

const base64Forms = (bytes: Buffer): string[] => {
  const forms: string[] = [];
  // A secret inside a larger base64 stream encodes differently per byte
  // offset: keep only the characters whose 6 bits all come from the secret.
  for (let pad = 0; pad < 3; pad++) {
    const encoded = Buffer.concat([Buffer.alloc(pad), bytes]).toString("base64");
    const core = encoded.slice(
      Math.ceil((8 * pad) / 6),
      Math.floor((8 * (pad + bytes.length)) / 6),
    );
    forms.push(core, core.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  const whole = bytes.toString("base64");
  forms.push(whole, bytes.toString("base64url"));
  return forms;
};

/** Every encoding of one secret worth scrubbing. */
export const secretForms = (secret: string): string[] => {
  if (secret.length < MIN_FORM) return [];
  const bytes = Buffer.from(secret, "utf8");
  const forms = [
    secret,
    encodeURIComponent(secret),
    encodeURIComponent(secret).replace(/%20/g, "+"),
    JSON.stringify(secret).slice(1, -1),
    bytes.toString("hex"),
    bytes.toString("hex").toUpperCase(),
    ...base64Forms(bytes),
  ];
  return [...new Set(forms)].filter((form) => form.length >= MIN_FORM);
};

/** The material a credential redeems to, and the strings that betray it. */
export interface SecretMaterial {
  readonly secret: string;
  readonly username: string | null;
}

/** All forms of a credential, including the Basic `user:secret` pair. */
export const materialForms = (material: SecretMaterial): string[] => {
  const forms = secretForms(material.secret);
  if (material.username !== null) {
    forms.push(...secretForms(`${material.username}:${material.secret}`));
  }
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A scrubber for a set of forms: replaces each with `[redacted:<label>]`. */
export const makeRedactor = (
  forms: readonly string[],
  label: string,
): ((text: string) => string) => {
  if (forms.length === 0) return (text) => text;
  const pattern = new RegExp(forms.map(escapeRegExp).join("|"), "g");
  return (text) => text.replace(pattern, `[redacted:${label}]`);
};
