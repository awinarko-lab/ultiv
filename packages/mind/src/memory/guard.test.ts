import { describe, expect, it } from "vite-plus/test";
import {
  appearsInOwnerInput,
  checkContent,
  contextOf,
  looksLikeInstruction,
  originOfPrefix,
  policyFor,
  trustFor,
} from "./guard.ts";

describe("origin detection", () => {
  it("maps the protected bracket prefixes and plain owner input", () => {
    expect(originOfPrefix("[cron nightly] do the thing")).toBe("cron");
    expect(originOfPrefix("[webhook gh] payload")).toBe("webhook");
    expect(originOfPrefix("[sensor cal] event")).toBe("sensor");
    expect(originOfPrefix("[message from Iris • dm] please")).toBe("bot");
    expect(originOfPrefix("[task t1 finished] done")).toBe("task");
    expect(originOfPrefix("[owner] note")).toBe("owner");
    expect(originOfPrefix("plain owner words")).toBe("owner");
    expect(originOfPrefix("[unknown prefix] junk")).toBe("unknown");
  });
});

describe("policy by origin", () => {
  it("owner untainted: full trust, instructions allowed", () => {
    const policy = policyFor({ origin: "owner", tainted: false, ownerInput: null });
    expect(policy.allowInstructions).toBe(true);
    expect(policy.maxTrust).toBe("owner");
  });
  it("owner tainted: derived, no instructions, no owner scope", () => {
    const policy = policyFor({ origin: "owner", tainted: true, ownerInput: "x" });
    expect(policy.trust).toBe("derived");
    expect(policy.allowInstructions).toBe(false);
    expect(policy.allowOwnerScope).toBe(false);
  });
  it("cron/task: self, no instructions; outside: untrusted profile-only", () => {
    expect(policyFor({ origin: "cron", tainted: false, ownerInput: null }).maxTrust).toBe("self");
    expect(policyFor({ origin: "task", tainted: false, ownerInput: null }).allowInstructions).toBe(
      false,
    );
    const outside = policyFor({ origin: "webhook", tainted: false, ownerInput: null });
    expect(outside.maxTrust).toBe("untrusted");
    expect(outside.allowOwnerScope).toBe(false);
  });
  it("trust ceilings clamp the requested trust", () => {
    expect(trustFor("owner", policyFor({ origin: "cron", tainted: false, ownerInput: null }))).toBe(
      "self",
    );
    expect(trustFor("self", policyFor({ origin: "owner", tainted: false, ownerInput: null }))).toBe(
      "self",
    );
  });
});

describe("content checks", () => {
  it("refuses API keys, JWTs, private keys, cards, NIK and OTPs", () => {
    expect(checkContent("my key is sk-abcdefghijklmnopqrstuvwx").ok).toBe(false);
    expect(
      checkContent("token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c").ok,
    ).toBe(false);
    expect(checkContent("-----BEGIN RSA PRIVATE KEY-----").ok).toBe(false);
    expect(checkContent("card 4532015112830366 for billing").ok).toBe(false);
    expect(checkContent("NIK 3175012345670002").ok).toBe(false);
    expect(checkContent("otp 482913").ok).toBe(false);
    expect(checkContent("password=hunter2scrambled").ok).toBe(false);
  });
  it("lets plain facts through", () => {
    expect(checkContent("harry prefers tea over coffee")).ok;
    expect(checkContent("the cat's vet visit is on Friday")).ok;
  });
});

describe("instruction shapes", () => {
  it("flags imperative standing orders but not plain facts", () => {
    expect(looksLikeInstruction("Always address Harry as Boss")).toBe(true);
    expect(looksLikeInstruction("jangan lupa kirim laporan tiap Jumat")).toBe(true);
    expect(looksLikeInstruction("harry's cat is named oren")).toBe(false);
  });
  it("the tainted-owner exception needs the owner's own words", () => {
    expect(
      appearsInOwnerInput("always address Harry as Boss", "please always address Harry as Boss"),
    ).toBe(true);
    expect(appearsInOwnerInput("always address Harry as Boss", "unrelated words")).toBe(false);
    expect(appearsInOwnerInput("always address Harry as Boss", null)).toBe(false);
  });
});
