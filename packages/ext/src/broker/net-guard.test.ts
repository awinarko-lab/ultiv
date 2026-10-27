import { describe, expect, it } from "vite-plus/test";
import { addressesAllowed, guardedLookup, isBlockedAddress } from "./net-guard.ts";
import { targetProblem } from "./http-adapter.ts";

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local, metadata, CGNAT and reserved ranges", () => {
    for (const address of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.20.0.1",
      "192.168.1.10",
      "100.100.100.100",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00:ec2::254",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "64:ff9b::10.0.0.1",
      "not-an-ip",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("refuses a host if ANY resolved address is blocked; loopback only by opt-in", async () => {
    expect(addressesAllowed(["1.1.1.1", "10.0.0.1"], false)).toBe(false);
    expect(addressesAllowed(["127.0.0.1"], true)).toBe(true);
    expect(addressesAllowed(["127.0.0.1", "10.0.0.1"], true)).toBe(false);
    const lookup = guardedLookup(false, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const error = await new Promise((resolve) => lookup("rebind.example", {}, (e) => resolve(e)));
    expect(String(error)).toMatch(/refused: rebind.example/);
    const ok = guardedLookup(false, async () => [{ address: "1.1.1.1", family: 4 }]);
    const address = await new Promise((resolve) => ok("one.example", {}, (_e, a) => resolve(a)));
    expect(address).toBe("1.1.1.1");
  });

  it("allows https only, http to localhost only by opt-in, and no userinfo or private literals", () => {
    const problem = (url: string, optIn = false) => targetProblem(new URL(url), optIn);
    expect(problem("https://api.example.com/x")).toBeUndefined();
    expect(problem("http://api.example.com/x")).toMatch(/only https/);
    expect(problem("http://localhost:8080/x")).toMatch(/only https/);
    expect(problem("http://localhost:8080/x", true)).toBeUndefined();
    expect(problem("http://10.0.0.5/x", true)).toMatch(/only https/);
    expect(problem("https://169.254.169.254/latest/meta-data")).toMatch(/refused/);
    expect(problem("https://[::ffff:7f00:1]/")).toMatch(/refused/);
    expect(problem("https://user:pw@api.example.com/")).toMatch(/embedded credentials/);
  });
});
