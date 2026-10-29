import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import {
  cleanText,
  decodeSearchHref,
  detectBlockPage,
  extractKeywords,
  extractPricing,
  normalizeText,
} from "./extract.js";
import type { BrowserDriver } from "./types.js";
import type { UrlGuard } from "./urlSafety.js";

const NAV_TIMEOUT_MS = 30_000;
const SEARCH_URL = "https://html.duckduckgo.com/html/?q=";

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

function ensureActive(ctx: ToolContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

const short = (u: string) => (u.length > 120 ? `${u.slice(0, 117)}...` : u);

/**
 * The only browser tools: search, open and extract. All are read-only. They never click, type,
 * submit forms, download, run scripts of their own, or execute commands. Page content is untrusted
 * data: it is quoted back as evidence and never used to choose tools, URLs to visit, or approvals.
 */
export function createBrowserTools(driver: BrowserDriver, guard: UrlGuard): Tool[] {
  const search: Tool = {
    name: "browser.search",
    description:
      'Searches the web with DuckDuckGo in the visible browser and returns result titles, URLs and snippets. Input: {"query": string, "maxResults"?: number 1-20}. Read-only. Fails honestly if the engine shows a CAPTCHA (never bypassed).',
    async run(input, ctx): Promise<ToolResult> {
      const query = cleanText(field(input, "query"), 300);
      if (!query) throw new Error('browser.search needs input.query (non-empty string)');
      const maxRaw = field(input, "maxResults");
      const max = maxRaw === undefined ? 8 : maxRaw;
      if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 20) {
        throw new Error("browser.search: maxResults must be an integer between 1 and 20");
      }

      ctx.progress(`Searching DuckDuckGo for "${short(query)}"`);
      const page = await driver.getPage();
      ensureActive(ctx);
      const nav = await page.goto(SEARCH_URL + encodeURIComponent(query), { timeoutMs: NAV_TIMEOUT_MS, signal: ctx.signal });
      ensureActive(ctx);
      if (nav.status !== null && nav.status >= 400) throw new Error(`The search engine returned HTTP ${nav.status}.`);

      const snap = await page.snapshot();
      const wall = detectBlockPage(snap);
      if (wall) {
        throw new Error(
          `The search engine blocked automated access (${wall}). This was not bypassed. Solve it manually in the browser window and retry, or give explicit URLs to browser.open.`,
        );
      }

      const raw = await page.searchResults();
      ensureActive(ctx);
      const seen = new Set<string>();
      const results: { rank: number; title: string; url: string; snippet: string }[] = [];
      let dropped = 0;
      for (const r of raw) {
        const target = decodeSearchHref(r.href);
        const verdict = target ? guard.checkSync(target) : null;
        if (!target || !verdict || !verdict.ok) {
          dropped++;
          continue;
        }
        const key = verdict.url.href;
        if (seen.has(key)) continue;
        seen.add(key);
        if (results.length < max) {
          results.push({ rank: results.length + 1, title: cleanText(r.title, 200), url: key, snippet: cleanText(r.snippet, 300) });
        }
      }

      const output = {
        engine: "duckduckgo-html",
        query,
        searchPageUrl: nav.finalUrl,
        fetchedAt: new Date().toISOString(),
        results,
        droppedUnsafeOrInternal: dropped,
      };
      if (!results.length) {
        return {
          output,
          verification: "unverified",
          note: "No usable results were parsed. Either the search returned nothing or the results page layout is not recognized.",
        };
      }
      return { output };
    },
  };

  const open: Tool = {
    name: "browser.open",
    description:
      'Opens one public http(s) URL in the visible browser and reports the final URL, HTTP status and page title. Input: {"url": string}. Only use a URL that appears in the user task. Localhost, private networks and non-http protocols are blocked. Read-only.',
    async run(input, ctx): Promise<ToolResult> {
      const raw = field(input, "url");
      if (typeof raw !== "string" || !raw.trim()) throw new Error('browser.open needs input.url (string)');
      const verdict = await guard.check(raw);
      if (!verdict.ok) throw new Error(`URL blocked: ${verdict.reason}`);

      ctx.progress(`Opening ${short(verdict.url.href)}`);
      const page = await driver.getPage();
      ensureActive(ctx);
      const nav = await page.goto(verdict.url.href, { timeoutMs: NAV_TIMEOUT_MS, signal: ctx.signal });
      ensureActive(ctx);

      const finalVerdict = guard.checkSync(nav.finalUrl);
      if (!finalVerdict.ok) throw new Error(`Navigation ended on a blocked URL: ${finalVerdict.reason}`);
      if (nav.status !== null && nav.status >= 400) {
        throw new Error(`The site returned HTTP ${nav.status} for ${short(nav.finalUrl)} (page not available to this browser).`);
      }
      const snap = await page.snapshot();
      const wall = detectBlockPage(snap);
      if (wall) {
        throw new Error(
          `The page appears to be a ${wall} wall, not the real content. This was not bypassed. Complete it manually in the browser window if appropriate, or skip this site.`,
        );
      }
      return {
        output: {
          requestedUrl: verdict.url.href,
          finalUrl: nav.finalUrl,
          redirected: nav.finalUrl !== verdict.url.href,
          status: nav.status,
          title: cleanText(snap.title, 200),
          visibleTextChars: normalizeText(snap.text).length,
          openedAt: new Date().toISOString(),
        },
      };
    },
  };

  const extract: Tool = {
    name: "browser.extract",
    description:
      'Reads the currently open page (run browser.open first) and returns the source URL plus evidence-backed facts. Input: {"fields"?: ["pricing","description","links"] (default pricing and description), "keywords"?: string[] up to 10}. Pricing is "Unavailable" unless a price appears on the page, and every price comes with a quoted snippet. Read-only.',
    async run(input, ctx): Promise<ToolResult> {
      const page = driver.existingPage();
      if (!page || page.currentUrl() === "about:blank") {
        throw new Error("No page is open. Run browser.open (or browser.search) first.");
      }
      const fieldsRaw = field(input, "fields");
      const allowed = ["pricing", "description", "links"] as const;
      let fields: (typeof allowed)[number][] = ["pricing", "description"];
      if (fieldsRaw !== undefined) {
        if (!Array.isArray(fieldsRaw) || !fieldsRaw.length || fieldsRaw.some((f) => !allowed.includes(f as never))) {
          throw new Error(`browser.extract: fields must be a non-empty subset of ${allowed.join(", ")}`);
        }
        fields = [...new Set(fieldsRaw as (typeof allowed)[number][])];
      }
      const kwRaw = field(input, "keywords");
      let keywords: string[] = [];
      if (kwRaw !== undefined) {
        if (!Array.isArray(kwRaw) || kwRaw.length > 10 || kwRaw.some((k) => typeof k !== "string" || !k.trim() || k.length > 60)) {
          throw new Error("browser.extract: keywords must be up to 10 non-empty strings (max 60 characters each)");
        }
        keywords = (kwRaw as string[]).map((k) => cleanText(k, 60));
      }

      ctx.progress("Reading the open page");
      const snap = await page.snapshot();
      ensureActive(ctx);
      // The user may have navigated manually (takeover); never read pages the URL policy forbids.
      const here = guard.checkSync(snap.url);
      if (!here.ok) throw new Error(`The open page is not allowed to be read: ${here.reason}`);
      const wall = detectBlockPage(snap);
      if (wall) throw new Error(`The open page appears to be a ${wall} wall; nothing was extracted.`);

      const output: Record<string, unknown> = {
        sourceUrl: snap.url,
        title: cleanText(snap.title, 200),
        fetchedAt: new Date().toISOString(),
      };
      const quotes: string[] = [];

      if (fields.includes("pricing")) {
        const pricing = extractPricing(snap.text);
        const relatedLinks: { text: string; url: string }[] = [];
        for (const l of snap.links) {
          if (relatedLinks.length >= 5) break;
          const v = guard.checkSync(l.href);
          if (!v.ok) continue;
          // Judge by link text and path only (not query strings), and skip links back to this same page.
          if (!/pric|plans?\b|billing/i.test(`${l.text} ${v.url.pathname}`)) continue;
          const bare = (u: string) => u.split("#")[0];
          if (bare(v.url.href) === bare(snap.url)) continue;
          if (!relatedLinks.some((r) => r.url === v.url.href)) {
            relatedLinks.push({ text: cleanText(l.text, 80), url: v.url.href });
          }
        }
        output.pricing = { ...pricing, sourceUrl: snap.url, relatedLinks };
        quotes.push(...pricing.evidence.map((e) => e.quote));
      }
      if (fields.includes("description")) {
        output.description = {
          metaDescription: cleanText(snap.metaDescription, 400) || "Unavailable",
          headings: snap.headings.slice(0, 8).map((h) => cleanText(h, 160)),
          sourceUrl: snap.url,
        };
      }
      if (fields.includes("links")) {
        const links: { text: string; url: string }[] = [];
        for (const l of snap.links) {
          if (links.length >= 25) break;
          const v = guard.checkSync(l.href);
          if (v.ok && !links.some((x) => x.url === v.url.href)) links.push({ text: cleanText(l.text, 80), url: v.url.href });
        }
        output.links = links;
      }
      if (keywords.length) {
        const kw = extractKeywords(snap.text, keywords);
        output.keywords = kw.map((k) => ({ ...k, sourceUrl: snap.url }));
        for (const k of kw) quotes.push(...k.quotes);
      }

      // Independent read-back: every quoted snippet must still be on the page on a second read.
      ensureActive(ctx);
      const again = await page.snapshot();
      const againText = normalizeText(again.text);
      const missing = quotes.filter((q) => !againText.includes(q)).length;
      if (again.url !== snap.url || missing > 0) {
        return {
          output,
          verification: "unverified",
          note: again.url !== snap.url
            ? "The page changed during extraction; evidence could not be re-confirmed."
            : `${missing} evidence quote(s) could not be re-confirmed on a second read of the page.`,
        };
      }
      return { output, verification: "verified" };
    },
  };

  return [search, open, extract];
}
