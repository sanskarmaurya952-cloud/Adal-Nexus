import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import { cleanText, detectBlockPage } from "../browser/extract.js";
import type { BrowserDriver, PageSnapshot } from "../browser/types.js";
import type { UrlGuard } from "../browser/urlSafety.js";
import { UNAVAILABLE, assessPricing, deriveName, deriveProduct, deriveTargetMarket, detectDirectoryOrTracker, siteKey } from "./analyze.js";
import { SEED_LIST_LABEL, SEED_SOURCES, type Seed } from "./seeds.js";
import { parseSources, validateRecord, type ResearchRecord, type SourceCandidate, type SourcesOutput } from "./types.js";

/**
 * Research orchestration tools. They only compose the existing read-only browser tools and pure analysis; every URL
 * goes through browser.open (and therefore the URL guard). Page text is untrusted data and is never used to pick
 * tools, URLs outside the same site, or approvals.
 */

// Domains that are not a startup's own site (news, reviews, social, directories). A heuristic, documented as such.
const NOT_OFFICIAL = new Set(
  ("wikipedia.org reddit.com youtube.com linkedin.com twitter.com x.com facebook.com instagram.com medium.com quora.com g2.com " +
    "capterra.com producthunt.com crunchbase.com techcrunch.com forbes.com businessinsider.com wired.com theverge.com zdnet.com " +
    "cnbc.com bloomberg.com reuters.com saasworthy.com comparedge.com trustpilot.com appsumo.com ycombinator.com builtin.com " +
    "tracxn.com cbinsights.com pitchbook.com statista.com mckinsey.com gartner.com substack.com wordpress.com blogspot.com " +
    "geeksforgeeks.org investopedia.com nerdwallet.com zapier.com github.com explodingtopics.com f6s.com startupsavant.com " +
    "aifundingtracker.com startuphub.ai aiweekly.co topstartups.io seedtable.com failory.com clutch.co goodfirms.co designrush.com").split(" "),
);
// Search results whose title/snippet says they are a list, ranking, directory or newsletter rather than one company's site.
const LISTICLE_RE =
  /\b(?:top|best|leading|hottest)\s+(?:[\w-]+\s+){0,3}(?:startups?|companies|tools|apps)\b|\b\d+\s+(?:best|top|leading|hottest|promising)\b|\blist of\b|\bdirectory\b|\brankings?\b|\bstartup (?:list|database|tracker)\b|\b(?:deal|funding)\s+tracker\b|\b(?:startups?|companies)\s+(?:in\s+\d{4}\s+)?by\s+(?:funding|valuation)\b|\bnewsletter\b|\bleaderboard\b/i;

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}
function ensureActive(ctx: ToolContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}
function intInRange(v: unknown, def: number, min: number, max: number, name: string): number {
  const n = v === undefined ? def : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}
const errMsg = (e: unknown) => cleanText(e instanceof Error ? e.message : String(e), 300);

export interface ResearchDeps {
  driver: BrowserDriver;
  guard: UrlGuard;
  searchTool: Tool;
  openTool: Tool;
  seeds?: readonly Seed[];
}

export function createResearchTools(d: ResearchDeps): Tool[] {
  const seeds = d.seeds ?? SEED_SOURCES;
  const urlOk = (u: string) => d.guard.checkSync(u).ok;

  // ---------------------------------------------------------------- find_sources
  const findSources: Tool = {
    name: "research.find_sources",
    description:
      'Finds candidate official site URLs for startups: runs a web search (browser.search) and keeps one root URL per non-news/non-directory domain. If the search fails, is blocked, or yields too few usable sources, tops up from a curated seed list, clearly labelled origin "fallback". Input: {"query": string, "maxSources"?: number 1-15 (default 10)}. Output has `sources` for research.collect. Read-only.',
    async run(input, ctx): Promise<ToolResult> {
      const query = cleanText(field(input, "query"), 200);
      if (!query) throw new Error("research.find_sources needs input.query (non-empty string)");
      const max = intInRange(field(input, "maxSources"), 10, 1, 15, "maxSources");

      let searchStatus: SourcesOutput["searchStatus"] = "ok";
      let searchError: string | undefined;
      const sources: SourceCandidate[] = [];
      const seen = new Set<string>();
      let skipped = 0;
      const queriesTried: string[] = [];
      // A second, differently worded search runs only if the first one worked but produced too few usable sites
      // (the 2026-10-28 audit showed generic queries return lists/directories). A failed/blocked search is never retried.
      for (const q of [query, `${query} company official website pricing`]) {
        if (queriesTried.length > 0 && (searchStatus === "failed" || sources.length >= Math.min(3, max))) break;
        queriesTried.push(q);
        ctx.progress(`Searching for sources: "${q.slice(0, 80)}"`);
        let results: { url: string; title: string; snippet?: string }[] = [];
        try {
          const r = await d.searchTool.run({ query: q, maxResults: 20 }, ctx);
          results = ((r.output as { results?: typeof results })?.results ?? []).filter((x) => typeof x?.url === "string");
          if (!results.length && queriesTried.length === 1) {
            searchStatus = "insufficient";
            searchError = "the search returned no parsable results";
          }
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          if (queriesTried.length === 1) {
            searchStatus = "failed";
            searchError = errMsg(e);
          }
        }
        ensureActive(ctx);
        for (const r of results) {
          if (sources.length >= max) break;
          let u: URL;
          try {
            u = new URL(r.url);
          } catch {
            continue;
          }
          const key = siteKey(u.hostname);
          if (NOT_OFFICIAL.has(key) || LISTICLE_RE.test(`${r.title} ${r.snippet ?? ""}`)) {
            skipped++;
            continue;
          }
          if (seen.has(key)) continue;
          const root = `${u.protocol}//${u.host}/`;
          if (!urlOk(root)) continue;
          seen.add(key);
          sources.push({ url: root, title: cleanText(r.title, 200), origin: "search", note: `site root of a search result for "${q.slice(0, 60)}": ${cleanText(r.url, 120)}` });
        }
      }

      const fromSearch = sources.length;
      let fallbackReason: string | undefined;
      if (sources.length < max) {
        for (const s of seeds) {
          if (sources.length >= max) break;
          let key: string;
          try {
            key = siteKey(new URL(s.url).hostname);
          } catch {
            continue;
          }
          if (seen.has(key) || !urlOk(s.url)) continue;
          seen.add(key);
          sources.push({ url: s.url, title: s.name, origin: "fallback", note: SEED_LIST_LABEL });
        }
        if (sources.length > fromSearch) {
          fallbackReason =
            searchStatus === "ok"
              ? `search produced only ${fromSearch} usable official-looking source(s) of ${max} requested`
              : `search ${searchStatus}: ${searchError}`;
        }
      }

      const output: SourcesOutput = {
        query,
        sources,
        searchStatus,
        queriesTried,
        ...(searchError ? { searchError } : {}),
        fallbackUsed: sources.length > fromSearch,
        ...(fallbackReason ? { fallbackReason, fallbackLabel: SEED_LIST_LABEL } : {}),
        skippedAsNotOfficial: skipped,
      };
      return {
        output,
        ...(output.fallbackUsed ? { note: `FALLBACK seed list used for ${sources.length - fromSearch} source(s): ${fallbackReason}` } : {}),
      };
    },
  };

  // ---------------------------------------------------------------- collect
  const pricingLink = (snap: PageSnapshot): string | null => {
    const home = siteKey(new URL(snap.url).hostname);
    const bare = (u: string) => u.split("#")[0];
    const cands: { href: string; rank: number }[] = [];
    for (const l of snap.links) {
      const v = d.guard.checkSync(l.href);
      if (!v.ok || siteKey(v.url.hostname) !== home || bare(v.url.href) === bare(snap.url)) continue;
      if (/pricing/i.test(v.url.pathname)) cands.push({ href: bare(v.url.href), rank: 0 });
      else if (/\bpric|\bplans?\b/i.test(`${l.text} ${v.url.pathname}`)) cands.push({ href: bare(v.url.href), rank: 1 });
    }
    cands.sort((a, b) => a.rank - b.rank);
    return cands[0]?.href ?? null;
  };

  /** A same-site About / Solutions / Use cases / Product page for target-market claims (best match first). */
  const aboutLink = (snap: PageSnapshot, skip: string[]): string | null => {
    const home = siteKey(new URL(snap.url).hostname);
    const bare = (u: string) => u.split("#")[0];
    const rules: [RegExp, number][] = [[/\/about/i, 0], [/\/(?:solutions?|use-?cases?)/i, 1], [/\/(?:customers|who-we)/i, 2], [/\/(?:product|platform)/i, 3]];
    const cands: { href: string; rank: number }[] = [];
    for (const l of snap.links) {
      const v = d.guard.checkSync(l.href);
      if (!v.ok || siteKey(v.url.hostname) !== home) continue;
      const href = bare(v.url.href);
      if (href === bare(snap.url) || skip.includes(href) || v.url.pathname === "/") continue;
      const rule = rules.find(([re]) => re.test(v.url.pathname));
      if (rule) cands.push({ href, rank: rule[1] });
    }
    cands.sort((a, b) => a.rank - b.rank);
    return cands[0]?.href ?? null;
  };

  async function visit(url: string, ctx: ToolContext): Promise<{ snap: PageSnapshot; status: number | null }> {
    const r = await d.openTool.run({ url }, ctx);
    const status = (r.output as { status?: number | null })?.status ?? null;
    const page = d.driver.existingPage();
    if (!page) throw new Error("the browser window is no longer available");
    const snap = await page.snapshot();
    const ok = d.guard.checkSync(snap.url);
    if (!ok.ok) throw new Error(`landed on a disallowed URL: ${ok.reason}`);
    const wall = detectBlockPage(snap);
    if (wall) throw new Error(`page looks like a ${wall} wall`);
    return { snap, status };
  }

  const failedRecord = (c: SourceCandidate, error: string): ResearchRecord => ({
    candidateUrl: c.url,
    origin: c.origin,
    status: "failed",
    error,
    researchedAt: new Date().toISOString(),
    name: { value: UNAVAILABLE, evidence: [] },
    product: { value: UNAVAILABLE, evidence: [] },
    targetMarket: { value: UNAVAILABLE, evidence: [] },
    pricing: { value: UNAVAILABLE, status: "unavailable", prices: [], evidence: [] },
    pages: [],
  });

  async function researchOne(c: SourceCandidate, ctx: ToolContext): Promise<ResearchRecord> {
    const home = await visit(c.url, ctx);
    const pages: ResearchRecord["pages"] = [{ url: home.snap.url, role: "home", title: cleanText(home.snap.title, 160), status: home.status }];
    const tracker = detectDirectoryOrTracker(home.snap);
    if (tracker.isDirectoryOrTracker) {
      return failedRecord(c, `excluded: ${tracker.reason}`);
    }
    let pricing = assessPricing(home.snap.text, home.snap.url);

    if (pricing.status !== "found") {
      const link = pricingLink(home.snap);
      if (link) {
        ensureActive(ctx);
        ctx.progress(`Opening pricing page ${link.slice(0, 90)}`);
        try {
          const p = await visit(link, ctx);
          pages.push({ url: p.snap.url, role: "pricing", title: cleanText(p.snap.title, 160), status: p.status });
          const fromPricingPage = assessPricing(p.snap.text, p.snap.url);
          if (fromPricingPage.status !== "unavailable") pricing = fromPricingPage;
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          // The home page result stands; the failed pricing page is simply not used.
        }
      }
    }

    const name = deriveName(home.snap);
    const product = deriveProduct(home.snap);
    let targetMarket = deriveTargetMarket(home.snap);
    if (targetMarket.value === UNAVAILABLE) {
      const link = aboutLink(home.snap, pages.map((p) => p.url.split("#")[0]));
      if (link) {
        ensureActive(ctx);
        ctx.progress(`Opening page for target-market claims ${link.slice(0, 90)}`);
        try {
          const a = await visit(link, ctx);
          pages.push({ url: a.snap.url, role: "about", title: cleanText(a.snap.title, 160), status: a.status });
          const t = deriveTargetMarket(a.snap);
          if (t.value !== UNAVAILABLE) targetMarket = t;
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          // The page could not be read; target market simply stays Unavailable.
        }
      }
    }
    const complete = [name.value, product.value, targetMarket.value, pricing.value].every((v) => !v.startsWith("Unavailable"));
    return {
      candidateUrl: c.url,
      origin: c.origin,
      status: complete ? "ok" : "partial",
      researchedAt: new Date().toISOString(),
      name,
      product,
      targetMarket,
      pricing,
      pages,
    };
  }

  const collect: Tool = {
    name: "research.collect",
    description:
      'Visits candidate sites one by one (browser.open safety applies), opens a same-site pricing page when needed, and extracts startup name, product, target market and pricing, each with evidence quotes and source URLs; anything unverified or ambiguous is "Unavailable". Failed sites are recorded and replaced by the next candidate until maxStartups are researched. Input: {"sources": [{"url","origin"?,...}] (normally {"$ref":"find.sources"}), "maxStartups"?: number 1-15 (default 10)}. Read-only.',
    async run(input, ctx): Promise<ToolResult> {
      const sources = parseSources(field(input, "sources"), urlOk);
      const target = intInRange(field(input, "maxStartups"), 10, 1, 15, "maxStartups");
      const records: ResearchRecord[] = [];
      let researched = 0;
      let attempted = 0;

      for (const c of sources) {
        if (researched >= target) break;
        ensureActive(ctx);
        attempted++;
        ctx.progress(`[${researched}/${target} done] Researching ${c.url} (${c.origin})`);
        let rec: ResearchRecord;
        try {
          rec = await researchOne(c, ctx);
          const problems = validateRecord(rec, urlOk);
          if (problems.length) rec = failedRecord(c, `record failed validation: ${problems.slice(0, 3).join("; ")}`);
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          rec = failedRecord(c, errMsg(e));
        }
        records.push(rec);
        if (rec.status !== "failed") researched++;
      }

      const failed = records.filter((r) => r.status === "failed").length;
      const output = { records, requested: target, researched, attempted, failed, sourcesNotTried: sources.length - attempted };
      if (researched === 0) {
        throw new Error(`No source could be researched (${failed} failed). First error: ${records[0]?.error ?? "none"}`);
      }
      if (researched < target) {
        return { output, verification: "unverified", note: `Only ${researched} of ${target} requested startups could be researched (${failed} source(s) failed, ${output.sourcesNotTried} not tried).` };
      }
      return { output };
    },
  };

  // ---------------------------------------------------------------- consolidate
  const consolidate: Tool = {
    name: "research.consolidate",
    description:
      'Validates and merges research records: runtime schema check, one record per site, counts of "Unavailable" fields and fallback usage. Fails if no valid record exists; unverified if fewer than expectedCount valid records. Input: {"records": [...] (normally {"$ref":"collect.records"}), "expectedCount"?: number 1-50 (default 10)}. Read-only.',
    async run(input): Promise<ToolResult> {
      const raw = field(input, "records");
      if (!Array.isArray(raw) || raw.length === 0) throw new Error("research.consolidate needs input.records (non-empty array)");
      if (raw.length > 50) throw new Error("records has more than 50 entries");
      const expected = intInRange(field(input, "expectedCount"), 10, 1, 50, "expectedCount");

      const valid: ResearchRecord[] = [];
      const rejected: { candidateUrl: string; reason: string }[] = [];
      const bySite = new Map<string, number>();
      for (const r of raw) {
        const problems = validateRecord(r, urlOk);
        const rec = r as ResearchRecord;
        if (problems.length) {
          rejected.push({ candidateUrl: String((r as { candidateUrl?: unknown })?.candidateUrl ?? "?").slice(0, 200), reason: `invalid record: ${problems.slice(0, 3).join("; ")}` });
          continue;
        }
        if (rec.status === "failed") {
          rejected.push({ candidateUrl: rec.candidateUrl, reason: rec.error ?? "research failed" });
          continue;
        }
        const key = siteKey(new URL(rec.candidateUrl).hostname);
        const at = bySite.get(key);
        if (at === undefined) {
          bySite.set(key, valid.length);
          valid.push(rec);
        } else if (valid[at].status === "partial" && rec.status === "ok") {
          valid[at] = rec; // keep the more complete duplicate
        }
      }

      const invalid = rejected.filter((x) => x.reason.startsWith("invalid record")).length;
      const unavailable = (sel: (r: ResearchRecord) => string) => valid.filter((r) => sel(r).startsWith("Unavailable")).length;
      const output = {
        records: valid,
        rejected,
        stats: {
          received: raw.length,
          consolidated: valid.length,
          expected,
          fromSearch: valid.filter((r) => r.origin === "search").length,
          fromFallbackSeedList: valid.filter((r) => r.origin === "fallback").length,
          unavailable: {
            name: unavailable((r) => r.name.value),
            product: unavailable((r) => r.product.value),
            targetMarket: unavailable((r) => r.targetMarket.value),
            pricing: unavailable((r) => r.pricing.value),
          },
          ambiguousPricing: valid.filter((r) => r.pricing.status === "ambiguous").length,
        },
      };
      if (!valid.length) throw new Error(`No valid research records to consolidate (${rejected.length} rejected). First: ${rejected[0]?.reason ?? "none"}`);
      if (invalid > 0) {
        return { output, verification: "failed", note: `${invalid} record(s) failed runtime schema validation and were excluded.` };
      }
      if (valid.length < expected) {
        return { output, verification: "unverified", note: `Only ${valid.length} of ${expected} expected records were obtained.` };
      }
      return { output, verification: "verified" };
    },
  };

  return [findSources, collect, consolidate];
}
