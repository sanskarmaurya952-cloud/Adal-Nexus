import dns from "node:dns/promises";
import net from "node:net";

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

export type Resolver = (hostname: string) => Promise<string[]>;

const MAX_URL_LENGTH = 2048;
/** Top-level navigations are limited to these ports (default ports plus the two common alternates). */
const ALLOWED_NAV_PORTS = new Set([80, 443, 8080, 8443]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home.arpa", ".intranet", ".corp"];

export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable => unsafe
  const [a, b, c] = p;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

export function expandIPv6(input: string): number[] | null {
  let ip = input.split("%")[0];
  if (ip.includes(".")) {
    const i = ip.lastIndexOf(":");
    const v4 = ip.slice(i + 1).split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !(n >= 0 && n <= 255))) return null;
    ip = `${ip.slice(0, i + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":").map((h) => parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

export function isPrivateIPv6(ip: string): boolean {
  const h = expandIPv6(ip);
  if (!h) return true;
  const v4 = (x: number, y: number) => `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`;
  if (h.every((n) => n === 0)) return true; // ::
  if (h.slice(0, 7).every((n) => n === 0) && h[7] === 1) return true; // ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h.slice(0, 5).every((n) => n === 0) && (h[5] === 0xffff || h[5] === 0)) return isPrivateIPv4(v4(h[6], h[7])); // v4-mapped / compatible
  if (h[0] === 0x64 && h[1] === 0xff9b) return isPrivateIPv4(v4(h[6], h[7])); // NAT64
  if (h[0] === 0x2002) return isPrivateIPv4(v4(h[1], h[2])); // 6to4
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation range
  return false;
}

export interface CheckOptions {
  /**
   * true  (default): a top-level page navigation: http(s) only, restricted ports.
   * false: a sub-resource request: also allows data:, blob: and about:, any port.
   */
  navigation?: boolean;
}

/** Synchronous checks: scheme, credentials, host name rules and IP literals. No DNS. */
export function checkUrlSync(raw: string, opts: CheckOptions = {}): UrlVerdict {
  const navigation = opts.navigation ?? true;
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "URL is empty" };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "URL is too long" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not a valid absolute URL" };
  }
  if (!navigation && ["data:", "blob:", "about:"].includes(url.protocol)) return { ok: true, url };
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsafe protocol "${url.protocol}" (only http and https are allowed)` };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed" };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "URL has no host" };

  if (net.isIPv4(host)) {
    if (isPrivateIPv4(host)) return { ok: false, reason: `private or reserved IPv4 address (${host})` };
  } else if (net.isIPv6(host)) {
    if (isPrivateIPv6(host)) return { ok: false, reason: `private or reserved IPv6 address (${host})` };
  } else {
    if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      return { ok: false, reason: `local or internal host name (${host})` };
    }
    if (!host.includes(".")) return { ok: false, reason: `single-label host name (${host}) is treated as internal` };
  }

  if (navigation && url.port && !ALLOWED_NAV_PORTS.has(Number(url.port))) {
    return { ok: false, reason: `port ${url.port} is not allowed (allowed: 80, 443, 8080, 8443)` };
  }
  return { ok: true, url };
}

const defaultResolver: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((a) => a.address);

/**
 * Full URL policy. Adds a DNS check so a public-looking name that resolves to a private address
 * is refused. Known limit: the browser resolves again itself (DNS rebinding between check and use
 * is not fully prevented); redirects and sub-resources are re-checked by the browser request hook.
 */
export class UrlGuard {
  private cache = new Map<string, { at: number; blocked: string | null }>();

  constructor(
    private resolver: Resolver = defaultResolver,
    private ttlMs = 60_000,
  ) {}

  checkSync(raw: string, opts: CheckOptions = {}): UrlVerdict {
    return checkUrlSync(raw, opts);
  }

  async check(raw: string, opts: CheckOptions = {}): Promise<UrlVerdict> {
    const v = checkUrlSync(raw, opts);
    if (!v.ok) return v;
    if (v.url.protocol !== "http:" && v.url.protocol !== "https:") return v;
    const host = v.url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (net.isIP(host)) return v;

    const hit = this.cache.get(host);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      return hit.blocked ? { ok: false, reason: hit.blocked } : v;
    }
    let blocked: string | null = null;
    try {
      const addrs = await this.resolver(host);
      const bad = addrs.find((a) => (net.isIPv6(a) ? isPrivateIPv6(a) : isPrivateIPv4(a)));
      if (bad) blocked = `host ${host} resolves to a private or reserved address (${bad})`;
    } catch {
      // Resolution failure is not a safety problem: the browser will fail to load it and report that honestly.
    }
    this.cache.set(host, { at: Date.now(), blocked });
    return blocked ? { ok: false, reason: blocked } : v;
  }
}
