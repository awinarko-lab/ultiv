import { describe, expect, it } from "vite-plus/test";
import { keyBytes, pushSupport, type PushEnv } from "./push-support.ts";

const READY: PushEnv = {
  secure: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  permission: "default",
  ios: false,
  standalone: false,
};

describe("pushSupport", () => {
  it("needs a secure origin first", () => {
    expect(pushSupport({ ...READY, secure: false })).toBe("insecure");
  });
  it("asks iPhone users to install to the Home Screen", () => {
    expect(pushSupport({ ...READY, ios: true, pushManager: false })).toBe("install-first");
    expect(pushSupport({ ...READY, ios: true, standalone: true })).toBe("ok");
  });
  it("reports missing APIs and a blocked permission", () => {
    expect(pushSupport({ ...READY, pushManager: false })).toBe("unsupported");
    expect(pushSupport({ ...READY, permission: "denied" })).toBe("blocked");
    expect(pushSupport(READY)).toBe("ok");
  });
});

describe("keyBytes", () => {
  it("decodes base64url without padding", () => {
    expect([...keyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
