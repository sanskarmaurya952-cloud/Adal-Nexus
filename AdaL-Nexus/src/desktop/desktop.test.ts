import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { BrowserStorage } from "./storage.js";
import { isNavigationUrlSafe, resolveAddressBarInput } from "./urlPolicy.js";

describe("URL Policy & Address Bar Resolution", () => {
  it("resolves valid HTTPS URLs as direct navigation", () => {
    const res = resolveAddressBarInput("https://www.youtube.com");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, false);
    assert.equal(res.url, "https://www.youtube.com/");
  });

  it("resolves valid HTTP URLs as direct navigation", () => {
    const res = resolveAddressBarInput("http://localhost:3001");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, false);
    assert.equal(res.url, "http://localhost:3001/");
  });

  it("prefixes valid domains with https://", () => {
    const res1 = resolveAddressBarInput("youtube.com");
    assert.equal(res1.isValid, true);
    assert.equal(res1.isSearch, false);
    assert.equal(res1.url, "https://youtube.com/");

    const res2 = resolveAddressBarInput("github.com/trending");
    assert.equal(res2.isValid, true);
    assert.equal(res2.isSearch, false);
    assert.equal(res2.url, "https://github.com/trending");
  });

  it("prefixes localhost with http://", () => {
    const res = resolveAddressBarInput("localhost:5173");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, false);
    assert.equal(res.url, "http://localhost:5173");
  });

  it("converts multi-word plain text to Google Search", () => {
    const res = resolveAddressBarInput("ai browser automation");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, true);
    assert.equal(res.url, "https://www.google.com/search?q=ai%20browser%20automation");
  });

  it("converts single words without TLD to Google Search", () => {
    const res = resolveAddressBarInput("chatgpt");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, true);
    assert.equal(res.url, "https://www.google.com/search?q=chatgpt");
  });

  it("resolves duckduckgo and ddg keyword shortcuts to DuckDuckGo homepage", () => {
    const res1 = resolveAddressBarInput("duckduckgo");
    assert.equal(res1.isValid, true);
    assert.equal(res1.isSearch, false);
    assert.equal(res1.url, "https://duckduckgo.com/");

    const res2 = resolveAddressBarInput("ddg");
    assert.equal(res2.isValid, true);
    assert.equal(res2.isSearch, false);
    assert.equal(res2.url, "https://duckduckgo.com/");
  });

  it("resolves whatsapp keyword shortcuts to WhatsApp Web homepage", () => {
    const res1 = resolveAddressBarInput("whatsapp");
    assert.equal(res1.isValid, true);
    assert.equal(res1.isSearch, false);
    assert.equal(res1.url, "https://web.whatsapp.com/");

    const res2 = resolveAddressBarInput("wahtsaap");
    assert.equal(res2.isValid, true);
    assert.equal(res2.isSearch, false);
    assert.equal(res2.url, "https://web.whatsapp.com/");
  });

  it("resolves explicit ddg and duckduckgo search prefixes", () => {
    const res1 = resolveAddressBarInput("ddg python async tutorial");
    assert.equal(res1.isValid, true);
    assert.equal(res1.isSearch, true);
    assert.equal(res1.url, "https://duckduckgo.com/?q=python%20async%20tutorial");
    assert.equal(res1.engine, "duckduckgo");

    const res2 = resolveAddressBarInput("duckduckgo react components");
    assert.equal(res2.isValid, true);
    assert.equal(res2.isSearch, true);
    assert.equal(res2.url, "https://duckduckgo.com/?q=react%20components");
    assert.equal(res2.engine, "duckduckgo");
  });

  it("supports duckduckgo as the default search engine", () => {
    const res = resolveAddressBarInput("best dev tools 2026", "duckduckgo");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, true);
    assert.equal(res.url, "https://duckduckgo.com/?q=best%20dev%20tools%202026");
    assert.equal(res.engine, "duckduckgo");
  });

  it("blocks dangerous javascript: scheme", () => {
    const res = resolveAddressBarInput("javascript:alert(1)");
    assert.equal(res.isValid, false);
    assert.match(res.error || "", /blocked/i);
  });

  it("blocks dangerous file: scheme", () => {
    const res = resolveAddressBarInput("file:///C:/Windows/System32/calc.exe");
    assert.equal(res.isValid, false);
    assert.match(res.error || "", /blocked/i);
  });

  it("blocks dangerous data: scheme", () => {
    const res = resolveAddressBarInput("data:text/html,<h1>hacked</h1>");
    assert.equal(res.isValid, false);
    assert.match(res.error || "", /blocked/i);
  });

  it("handles adal://home custom scheme", () => {
    const res = resolveAddressBarInput("adal://home");
    assert.equal(res.isValid, true);
    assert.equal(res.isSearch, false);
    assert.equal(res.url, "adal://home");
  });

  it("validates safe navigation URLs", () => {
    assert.equal(isNavigationUrlSafe("https://github.com"), true);
    assert.equal(isNavigationUrlSafe("http://localhost:5173"), true);
    assert.equal(isNavigationUrlSafe("javascript:void(0)"), false);
    assert.equal(isNavigationUrlSafe("file:///etc/passwd"), false);
    assert.equal(isNavigationUrlSafe("not-a-url"), false);
  });
});

describe("Desktop Browser Storage (Bookmarks & History)", () => {
  let tempDir: string;
  let storage: BrowserStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adal-browser-test-"));
    storage = new BrowserStorage(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("adds and retrieves bookmarks without duplicates", () => {
    assert.equal(storage.getBookmarks().length, 0);

    const b1 = storage.addBookmark({ url: "https://www.youtube.com", title: "YouTube" });
    assert.ok(b1.id.startsWith("bm_"));
    assert.equal(b1.url, "https://www.youtube.com");
    assert.equal(b1.title, "YouTube");

    // Add another bookmark
    storage.addBookmark({ url: "https://github.com", title: "GitHub" });
    const list = storage.getBookmarks();
    assert.equal(list.length, 2);

    // Re-adding existing URL updates title instead of duplicating
    const updated = storage.addBookmark({ url: "https://www.youtube.com", title: "YouTube - Video" });
    assert.equal(updated.title, "YouTube - Video");
    assert.equal(storage.getBookmarks().length, 2);
  });

  it("removes bookmarks by id or url", () => {
    const b1 = storage.addBookmark({ url: "https://www.google.com", title: "Google" });
    storage.addBookmark({ url: "https://github.com", title: "GitHub" });

    assert.equal(storage.removeBookmark(b1.id), true);
    assert.equal(storage.getBookmarks().length, 1);
    assert.equal(storage.getBookmarks()[0].url, "https://github.com");

    // Removing by URL
    assert.equal(storage.removeBookmark("https://github.com"), true);
    assert.equal(storage.getBookmarks().length, 0);
  });

  it("records history entries and ignores internal URLs", () => {
    assert.equal(storage.getHistory().length, 0);

    // Internal URLs should not be recorded
    const ignored = storage.addHistoryEntry({ url: "adal://home", title: "Home" });
    assert.equal(ignored, null);
    assert.equal(storage.getHistory().length, 0);

    // Real URLs recorded
    const h1 = storage.addHistoryEntry({ url: "https://www.youtube.com", title: "YouTube" });
    assert.ok(h1);
    assert.equal(storage.getHistory().length, 1);
    assert.equal(storage.getHistory()[0].url, "https://www.youtube.com");

    storage.addHistoryEntry({ url: "https://github.com", title: "GitHub" });
    const history = storage.getHistory();
    assert.equal(history.length, 2);
    // Newest entry first
    assert.equal(history[0].url, "https://github.com");
  });

  it("clears history safely", () => {
    storage.addHistoryEntry({ url: "https://www.youtube.com", title: "YouTube" });
    assert.equal(storage.getHistory().length, 1);

    storage.clearHistory();
    assert.equal(storage.getHistory().length, 0);
  });

  it("recovers gracefully from corrupted JSON file", () => {
    const bookmarksFile = path.join(tempDir, "bookmarks.json");
    fs.writeFileSync(bookmarksFile, "{ corrupt json ... invalid syntax", "utf8");

    // Should not throw, should return empty array
    const list = storage.getBookmarks();
    assert.deepEqual(list, []);

    // Adding bookmark succeeds and overwrites cleanly
    const b = storage.addBookmark({ url: "https://chatgpt.com", title: "ChatGPT" });
    assert.equal(b.url, "https://chatgpt.com");
    assert.equal(storage.getBookmarks().length, 1);
  });
});
