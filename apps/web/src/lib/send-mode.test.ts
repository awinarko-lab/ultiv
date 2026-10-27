import { describe, expect, it } from "vite-plus/test";
import { canRedirect, keySendMode, SEND_CHOICES } from "./send-mode.ts";

const key = (over: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>>) => ({
  altKey: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe("send modes", () => {
  it("keeps steer the default and redirect explicit and last", () => {
    expect(SEND_CHOICES.map((c) => c.mode)).toEqual(["steer", "followUp", "redirect"]);
  });
  it("offers Redirect now only mid-turn with a draft", () => {
    expect(canRedirect(true, true, false, "go")).toBe(true);
    expect(canRedirect(false, true, false, "go")).toBe(false);
    expect(canRedirect(true, false, false, "go")).toBe(false);
    expect(canRedirect(true, true, true, "go")).toBe(false);
    expect(canRedirect(true, true, false, "  ")).toBe(false);
  });
  it("maps keys: Enter steers, Alt waits, Ctrl/Cmd+Shift redirects only while busy", () => {
    expect(keySendMode(key({}), true)).toBeUndefined();
    expect(keySendMode(key({ altKey: true }), true)).toBe("followUp");
    expect(keySendMode(key({ shiftKey: true, ctrlKey: true }), true)).toBe("redirect");
    expect(keySendMode(key({ shiftKey: true, metaKey: true }), true)).toBe("redirect");
    expect(keySendMode(key({ shiftKey: true, metaKey: true }), false)).toBeUndefined();
  });
});
