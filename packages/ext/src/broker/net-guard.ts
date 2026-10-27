/**
 * SSRF guard for broker egress. Every hostname is resolved and EVERY address
 * it maps to must be public: private, loopback, link-local (cloud metadata),
 * CGNAT (tailnets), multicast and reserved ranges are refused. The check runs
 * as the socket's own `lookup`, so the address that was checked is the one
 * connected to (no DNS-rebinding window), and again on every redirect hop.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** The IPv4 inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) address. */
const embeddedV4 = (address: string): string | undefined => {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted !== null) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex === null) return undefined;
  const high = Number.parseInt(hex[1] ?? "0", 16);
  const low = Number.parseInt(hex[2] ?? "0", 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
};

const familyOf = (address: string): "ipv4" | "ipv6" | undefined => {
  const version = isIP(address);
  return version === 4 ? "ipv4" : version === 6 ? "ipv6" : undefined;
};

/** True for loopback addresses (127/8, ::1, and their mapped forms). */
export const isLoopbackAddress = (address: string): boolean => {
  const inner = embeddedV4(address);
  if (inner !== undefined) return loopback.check(inner, "ipv4");
  const family = familyOf(address);
  return family !== undefined && loopback.check(address, family);
};

/** True when an address must never be reached by broker egress. */
export const isBlockedAddress = (address: string): boolean => {
  const inner = embeddedV4(address);
  if (inner !== undefined) return blocked.check(inner, "ipv4");
  const family = familyOf(address);
  // Not an IP at all: refuse rather than guess.
  return family === undefined || blocked.check(address, family);
};

/** `localhost` and the literal loopback names the localhost opt-in covers. */
export const isLocalhostName = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

/** Thrown (as the lookup error) when a target resolves into a refused range. */
export class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS";
  readonly hostname: string;
  constructor(hostname: string) {
    super(`refused: ${hostname} resolves to a private, loopback, link-local or reserved address`);
    this.hostname = hostname;
  }
}

/** Is this resolved set acceptable? Loopback passes only under the localhost opt-in. */
export const addressesAllowed = (addresses: readonly string[], allowLoopback: boolean): boolean =>
  addresses.length > 0 &&
  addresses.every((address) =>
    allowLoopback && isLoopbackAddress(address) ? true : !isBlockedAddress(address),
  );

type Resolve = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolve: Resolve = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) reject(error);
      else resolve(addresses);
    });
  });

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for http(s).request: resolves every address, refuses the whole
 * host if ANY address is blocked, and hands the socket only checked addresses.
 */
export const guardedLookup =
  (allowLoopback: boolean, resolve: Resolve = systemResolve) =>
  (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(hostname).then(
      (addresses) => {
        const list = addresses.map((entry) => entry.address);
        if (!addressesAllowed(list, allowLoopback)) {
          callback(new BlockedAddressError(hostname), options.all === true ? [] : "", 0);
          return;
        }
        if (options.all === true) callback(null, [...addresses]);
        else callback(null, addresses[0]?.address ?? "", addresses[0]?.family ?? 4);
      },
      (error: NodeJS.ErrnoException) => callback(error, options.all === true ? [] : "", 0),
    );
  };
