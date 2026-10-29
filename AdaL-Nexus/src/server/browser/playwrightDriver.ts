import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import type { BrowserDriver, BrowserPage, NavigationResult, PageSnapshot, RawSearchResult } from "./types.js";
import type { UrlGuard } from "./urlSafety.js";

interface Blocked {
  url: string;
  reason: string;
}

// Evaluated inside the page as strings (the server has no DOM typings). Read-only: no clicks, no input, no storage access.
const SNAPSHOT_JS = `(() => {
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  return {
    url: location.href,
    title: document.title || "",
    text: (document.body ? document.body.innerText : "").slice(0, 200000),
    metaDescription: meta ? (meta.getAttribute("content") || "") : "",
    headings: [...document.querySelectorAll("h1, h2")].slice(0, 12).map(txt).filter(Boolean),
    links: [...document.querySelectorAll("a[href]")].slice(0, 400).map((a) => ({ text: txt(a).slice(0, 120), href: a.href })),
  };
})()`;

const SEARCH_RESULTS_JS = `(() => {
  return [...document.querySelectorAll("div.result, div.web-result")]
    .filter((r) => !r.classList.contains("result--ad"))
    .map((r) => {
      const a = r.querySelector("a.result__a");
      const s = r.querySelector(".result__snippet");
      return { title: a ? (a.textContent || "").trim() : "", href: a ? a.href : "", snippet: s ? (s.textContent || "").trim() : "" };
    })
    .filter((x) => x.href);
})()`;

export interface PlaywrightDriverOptions {
  /** "chrome" / "msedge" to use an installed browser; empty for Playwright's bundled Chromium. */
  channel?: string;
  guard: UrlGuard;
}

export class PlaywrightDriver implements BrowserDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private wrapper: PlaywrightPage | null = null;
  private launching: Promise<void> | null = null;
  private blocked: Blocked[] = [];

  constructor(private o: PlaywrightDriverOptions) {}

  async getPage(): Promise<BrowserPage> {
    if (!this.launching) {
      this.launching = this.ensure().finally(() => {
        this.launching = null;
      });
    }
    await this.launching;
    return this.wrapper!;
  }

  existingPage(): BrowserPage | null {
    return this.page && !this.page.isClosed() && this.browser?.isConnected() ? this.wrapper : null;
  }

  status() {
    const open = !!this.page && !this.page.isClosed() && !!this.browser?.isConnected();
    return { launched: open, url: open ? this.page!.url() : null };
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.reset();
    await b?.close().catch(() => {});
  }

  private reset() {
    this.browser = this.context = this.page = this.wrapper = null;
  }

  private async ensure(): Promise<void> {
    if (this.browser?.isConnected() && this.context) {
      if (!this.page || this.page.isClosed()) this.attachPage(await this.context.newPage());
      return;
    }
    this.reset();
    let browser: Browser;
    try {
      // Visible window (headless: false) so the user can watch and take over. Fresh profile: no cookies or logins.
      browser = await chromium.launch({ headless: false, channel: this.o.channel || undefined });
    } catch (err) {
      throw new Error(launchHelp(err, this.o.channel));
    }
    browser.on("disconnected", () => {
      if (this.browser === browser) this.reset();
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    // Every request (navigations, redirects, sub-resources) passes the URL policy.
    await context.route("**/*", async (route: Route) => {
      const req = route.request();
      const verdict = await this.o.guard.check(req.url(), { navigation: req.isNavigationRequest() });
      if (verdict.ok) return route.continue().catch(() => {});
      this.blocked.push({ url: req.url().slice(0, 200), reason: verdict.reason });
      if (this.blocked.length > 50) this.blocked.shift();
      return route.abort("blockedbyclient").catch(() => {});
    });
    this.browser = browser;
    this.context = context;
    this.attachPage(await context.newPage());
  }

  private attachPage(page: Page) {
    this.page = page;
    this.wrapper = new PlaywrightPage(page, this.blocked);
  }
}

class PlaywrightPage implements BrowserPage {
  constructor(
    private page: Page,
    private blocked: Blocked[],
  ) {}

  currentUrl(): string {
    return this.page.url();
  }

  async goto(url: string, opts: { timeoutMs: number; signal: AbortSignal }): Promise<NavigationResult> {
    if (opts.signal.aborted) throw new Error("cancelled");
    this.blocked.length = 0;
    const stop = () => void this.page.evaluate("window.stop()").catch(() => {});
    opts.signal.addEventListener("abort", stop, { once: true });
    try {
      const resp = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
      // Best-effort settle for client-rendered pages (pricing tables are often rendered by JavaScript).
      await this.page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
      await this.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      return { status: resp?.status() ?? null, finalUrl: this.page.url() };
    } catch (err) {
      throw new Error(describeNavError(err, opts.timeoutMs, this.blocked));
    } finally {
      opts.signal.removeEventListener("abort", stop);
    }
  }

  async snapshot(): Promise<PageSnapshot> {
    return (await this.page.evaluate(SNAPSHOT_JS)) as PageSnapshot;
  }

  async searchResults(): Promise<RawSearchResult[]> {
    return (await this.page.evaluate(SEARCH_RESULTS_JS)) as RawSearchResult[];
  }
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
}

export function launchHelp(err: unknown, channel?: string): string {
  const full = err instanceof Error ? err.message : String(err);
  if (/executable doesn't exist|browsertype\.launch.*(install|download)/i.test(full)) {
    return 'Chromium is not installed for Playwright. Run "npx playwright-core install chromium", or set BROWSER_CHANNEL=chrome in .env to use your installed Chrome.';
  }
  if (channel && /distribution|not found|channel|ENOENT/i.test(full)) {
    return `Could not find the "${channel}" browser. Install it, or clear BROWSER_CHANNEL and run "npx playwright-core install chromium".`;
  }
  return `Could not launch the browser: ${firstLine(err)}`;
}

export function describeNavError(err: unknown, timeoutMs: number, blocked: Blocked[]): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ERR_BLOCKED_BY_CLIENT/.test(msg) && blocked.length) {
    return `Navigation blocked by URL safety policy: ${blocked[blocked.length - 1].reason}`;
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return "Could not resolve the host name (DNS lookup failed).";
  if (/ERR_CONNECTION_REFUSED/.test(msg)) return "The server refused the connection.";
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/.test(msg)) return "The connection timed out.";
  if (/ERR_CERT|SSL_ERROR|ERR_SSL/.test(msg)) return "The site's HTTPS certificate was rejected.";
  if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) return "The site redirected too many times.";
  if (/ERR_ABORTED|aborted/i.test(msg)) return "Navigation was aborted.";
  if (/Timeout .*exceeded|TimeoutError/i.test(msg)) return `The page did not load within ${Math.round(timeoutMs / 1000)} s.`;
  if (/closed|Target page, context or browser has been closed/i.test(msg)) {
    return "The browser window was closed. Run the step again to reopen it.";
  }
  return `Navigation failed: ${firstLine(err)}`;
}
