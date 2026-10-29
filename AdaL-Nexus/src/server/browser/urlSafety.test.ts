import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UrlGuard, checkUrlSync, isPrivateIPv4, isPrivateIPv6 } from "./urlSafety.js";

// Pure URL-policy tests. No network and no DNS (resolver is stubbed where DNS is involved).

const blocked = (u: string, re?: RegExp, nav = true) => {
  const v = checkUrlSync(u, { navigation: nav });
  assert.equal(v.ok, false, `expected ${u} to be blocked`);
  if (re && !v.ok) assert.match(v.reason, re);
};
const allowed = (u: string, nav = true) => {
  const v = checkUrlSync(u, { navigation: nav });
  assert.equal(v.ok, true, `expected ${u} to be allowed${v.ok ? "" : `: ${v.reason}`}`);
};

describe("URL safety: protocols and shape", () => {
  it("allows ordinary public http(s) URLs", () => {
    allowed("https://example.com/");
    allowed("http://example.org/pricing?plan=pro#top");
    allowed("https://sub.domain.example.co.uk/a/b");
    allowed("https://example.com:8443/x");
  });

  it("blocks unsafe protocols", () => {
    for (const u of [
      "file:///C:/Windows/win.ini",
      "javascript:alert(1)",
      "ftp://example.com/x",
      "data:text/html,<h1>x</h1>",
      "chrome://settings",
      "about:blank",
      "blob:https://example.com/abc",
      "view-source:https://example.com",
      "ws://example.com/",
    ]) {
      blocked(u, /protocol|valid absolute/);
    }
  });

  it("blocks credentials, empty, malformed and oversized URLs", () => {
    blocked("https://user:pass@example.com/", /credentials/);
    blocked("https://user@example.com/", /credentials/);
    blocked("", /empty/);
    blocked("   ", /empty/);
    blocked("not a url", /valid absolute/);
    blocked("//example.com/path", /valid absolute/);
    blocked(`https://example.com/${"a".repeat(2100)}`, /too long/);
  });

  it("allows data:/blob:/about: only for sub-resources, never for navigation", () => {
    allowed("data:image/png;base64,AAAA", false);
    allowed("blob:https://example.com/abc", false);
    blocked("data:text/html,x", /protocol/, true);
    blocked("file:///etc/passwd", /protocol/, false);
  });
});

describe("URL safety: local and private destinations", () => {
  it("blocks localhost in every spelling", () => {
    for (const u of [
      "http://localhost/",
      "http://localhost:3001/api/run",
      "http://LOCALHOST/",
      "http://localhost./",
      "http://app.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://nas.lan/",
      "http://router.home.arpa/",
    ]) {
      blocked(u, /local|internal/);
    }
  });

  it("blocks single-label (intranet) host names", () => {
    blocked("http://intranet/", /single-label/);
    blocked("http://fileserver/share", /single-label/);
  });

  it("blocks private, loopback, link-local and reserved IPv4 literals", () => {
    for (const ip of [
      "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
      "192.168.0.1", "192.168.255.255", "169.254.169.254", "0.0.0.0", "100.64.0.1", "100.127.255.255",
      "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.1", "203.0.113.9",
    ]) {
      blocked(`http://${ip}/`, /IPv4/);
    }
  });

  it("allows public IPv4 literals next to private ranges", () => {
    for (const ip of ["8.8.8.8", "172.15.255.255", "172.32.0.1", "192.167.1.1", "192.169.1.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "1.1.1.1"]) {
      allowed(`http://${ip}/`);
    }
    assert.equal(isPrivateIPv4("93.184.216.34"), false);
  });

  it("blocks obfuscated IPv4 forms (decimal, hex, octal, short)", () => {
    blocked("http://2130706433/", /IPv4/); // 127.0.0.1
    blocked("http://0x7f000001/", /IPv4/);
    blocked("http://0x7f.1/", /IPv4/);
    blocked("http://0177.0.0.1/", /IPv4/);
    blocked("http://127.1/", /IPv4/);
    blocked("http://3232235777/", /IPv4/); // 192.168.1.1
    blocked("http://169.254.169.254.:80/", /IPv4/);
  });

  it("blocks private/loopback/mapped IPv6 literals", () => {
    for (const u of [
      "http://[::1]/",
      "http://[::]/",
      "http://[fc00::1]/",
      "http://[fd12:3456:789a::1]/",
      "http://[fe80::1]/",
      "http://[ff02::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:c0a8:0101]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://[2001:db8::1]/",
    ]) {
      blocked(u, /IPv6/);
    }
  });

  it("allows public IPv6 literals", () => {
    allowed("http://[2606:4700:4700::1111]/");
    assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
    assert.equal(isPrivateIPv6("::ffff:8.8.8.8"), false);
  });

  it("restricts top-level navigation ports but not sub-resources", () => {
    for (const p of [22, 25, 3000, 3001, 5173, 6379, 9222, 9229]) blocked(`https://example.com:${p}/`, /port/);
    allowed("https://example.com:8080/");
    allowed("http://example.com:80/");
    allowed("https://example.com:3000/asset.js", false);
  });
});

describe("URL guard: DNS resolution", () => {
  const withResolver = (map: Record<string, string[] | Error>, counter?: { n: number }) =>
    new UrlGuard(async (host) => {
      if (counter) counter.n++;
      const r = map[host];
      if (r instanceof Error) throw r;
      if (!r) throw new Error("ENOTFOUND");
      return r;
    });

  it("blocks a public-looking name that resolves to a private address", async () => {
    const g = withResolver({ "evil.example.com": ["10.1.2.3"], "multi.example.com": ["93.184.216.34", "127.0.0.1"], "v6.example.com": ["::1"] });
    for (const h of ["evil.example.com", "multi.example.com", "v6.example.com"]) {
      const v = await g.check(`https://${h}/`);
      assert.equal(v.ok, false, h);
      if (!v.ok) assert.match(v.reason, /resolves to a private/);
    }
  });

  it("allows names that resolve to public addresses", async () => {
    const g = withResolver({ "good.example.com": ["93.184.216.34", "2606:4700:4700::1111"] });
    assert.equal((await g.check("https://good.example.com/x")).ok, true);
  });

  it("lets resolution failures through so the browser reports the real navigation error", async () => {
    const g = withResolver({ "gone.example.com": new Error("ENOTFOUND") });
    assert.equal((await g.check("https://gone.example.com/")).ok, true);
  });

  it("does not use DNS for IP literals and short-circuits synchronous rejections", async () => {
    const counter = { n: 0 };
    const g = withResolver({}, counter);
    assert.equal((await g.check("http://127.0.0.1/")).ok, false);
    assert.equal((await g.check("http://localhost/")).ok, false);
    assert.equal((await g.check("http://8.8.8.8/")).ok, true);
    assert.equal(counter.n, 0);
  });

  it("caches resolutions", async () => {
    const counter = { n: 0 };
    const g = withResolver({ "cached.example.com": ["93.184.216.34"] }, counter);
    await g.check("https://cached.example.com/a");
    await g.check("https://cached.example.com/b");
    assert.equal(counter.n, 1);
  });
});
