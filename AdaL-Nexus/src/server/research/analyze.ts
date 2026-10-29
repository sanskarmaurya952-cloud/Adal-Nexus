import { cleanText, extractPricing, normalizeText } from "../browser/extract.js";
import type { PageSnapshot } from "../browser/types.js";
import type { EvidenceRef, Fact, PlanPrice, PricingFact } from "./types.js";

/**
 * Deterministic fact derivation from UNTRUSTED page content. Every non-"Unavailable" value carries at least one
 * evidence quote and the source URL. No LLM is involved.
 */
export const UNAVAILABLE = "Unavailable";

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** Registrable-domain key, e.g. www.elevenlabs.io -> elevenlabs.io, foo.co.uk -> foo.co.uk. */
export function siteKey(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  return last.length === 2 && SECOND_LEVEL.has(second) ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const WINDOW = 70;
const quoteAround = (text: string, start: number, end: number) =>
  text.slice(Math.max(0, start - WINDOW), Math.min(text.length, end + WINDOW)).trim();

/** The name is the brand token from the domain, but only if it actually appears in the page title (so it is evidenced). */
export function deriveName(snap: PageSnapshot): Fact {
  const brand = norm(siteKey(new URL(snap.url).hostname).split(".")[0]);
  const title = cleanText(snap.title, 200);
  const tokens = title.split(/[\s|:–—\-·,]+/).filter(Boolean);
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const cand = tokens.slice(i, i + size).join(" ");
      if (brand && norm(cand) === brand) {
        return { value: cand, evidence: [{ kind: "title", quote: title, sourceUrl: snap.url }] };
      }
    }
  }
  return { value: UNAVAILABLE, evidence: [] };
}

export function deriveProduct(snap: PageSnapshot): Fact {
  const meta = cleanText(snap.metaDescription, 300);
  if (meta.length >= 20) return { value: meta, evidence: [{ kind: "meta", quote: meta, sourceUrl: snap.url }] };
  const text = normalizeText(snap.text);
  const h = snap.headings.map((x) => cleanText(x, 200)).find((x) => x.length >= 8 && text.includes(x));
  return h ? { value: h, evidence: [{ kind: "page_text", quote: h, sourceUrl: snap.url }] } : { value: UNAVAILABLE, evidence: [] };
}

// ------------------------------------------------------------------------------------ target market
const AUD =
  "developers|engineers|software teams|engineering teams|product teams|sales teams|support teams|marketing teams|data teams|teams|enterprises|enterprise|startups|creators|businesses|marketers|designers|agencies|students|researchers|professionals|individuals|data scientists|publishers|organizations|companies|everyone";
const MODS = "(?:modern |growing |small |large |every |all |busy |global |leading )?";
// Claim patterns. Menu labels like "For Developers" and FAQ questions do not count as claims.
const CLAIM_VERB = new RegExp(`\\b(?:built|designed|made|created|tailored|optimized|ideal|perfect|great) for ${MODS}(${AUD})\\b`, "gi");
const CLAIM_ENABLE = new RegExp(`\\b(?:helps?|helping|empowers?|empowering|enables?|enabling|serves?|serving) ${MODS}(${AUD})\\b`, "gi");
const CLAIM_BARE_ANY_CASE = new RegExp(`\\bfor ${MODS}(${AUD})\\b`, "gi"); // only in meta / title / headings
const CLAIM_BARE_LOWER = new RegExp(`(?<=[a-z,] )for ${MODS}(${AUD})\\b`, "g"); // body text: lowercase "for" after a word

/** Target market only from explicit claims in the meta description, title, headings or body text, each with a quote. */
export function deriveTargetMarket(snap: PageSnapshot): Fact {
  const text = normalizeText(snap.text);
  const sources: { text: string; kind: EvidenceRef["kind"]; any: boolean }[] = [
    { text: normalizeText(snap.metaDescription), kind: "meta", any: true },
    { text: normalizeText(snap.title), kind: "title", any: true },
    ...snap.headings.map((h) => ({ text: normalizeText(h), kind: "page_text" as const, any: true })).filter((s) => text.includes(s.text)),
    { text, kind: "page_text", any: false },
  ];
  const seen: string[] = [];
  const evidence: EvidenceRef[] = [];
  for (const s of sources) {
    if (!s.text) continue;
    const res = s.any ? [CLAIM_VERB, CLAIM_ENABLE, CLAIM_BARE_ANY_CASE] : [CLAIM_VERB, CLAIM_ENABLE, CLAIM_BARE_LOWER];
    for (const re of res) {
      for (const m of s.text.matchAll(re)) {
        const a = m[1].toLowerCase();
        const start = m.index ?? 0;
        const quote = quoteAround(s.text, start, start + m[0].length);
        if (seen.includes(a) || quote.includes("?")) continue; // FAQ questions are not claims
        // Customer testimonials (inside quotation marks) are not the company's own claim.
        const before = s.text.slice(Math.max(0, start - 250), start);
        if ((before.match(/"/g)?.length ?? 0) % 2 === 1 || before.lastIndexOf("“") > before.lastIndexOf("”")) continue;
        seen.push(a);
        evidence.push({ kind: s.kind, quote, sourceUrl: snap.url });
        if (seen.length >= 4) return { value: seen.join(", "), evidence };
      }
    }
  }
  return seen.length ? { value: seen.join(", "), evidence } : { value: UNAVAILABLE, evidence: [] };
}

// ------------------------------------------------------------------------------------ pricing
const PROMO_RE =
  /\b(?:first (?:month|year|\d+ months?)|\d+% off|save \S+|discount|promo(?:tion)?|limited[- ]time|until (?:\w+ )?\d|was \$|intro(?:ductory)?|launch (?:offer|price)|coupon|free months?|months? free)\b/i;
const CUR = String.raw`(?:US\$|CA\$|A\$|[$€£₹¥])`;
const PRICE_G = new RegExp(`${CUR}\\s?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,6})?`, "g");
const USAGE_AFTER_RE = /^\s*(?:\/|per\s+)\s*(?:sec|second|hour|hr|minute|min|request|token|credit|image|1[mk]|million|gpu|instance)/i;

/** True when every price on the page is followed by a usage unit (per second / hour / token / request ...). */
export function isUsageOnly(rawText: string): boolean {
  const text = normalizeText(rawText);
  const toks = [...text.matchAll(PRICE_G)];
  return toks.length > 0 && toks.every((m) => USAGE_AFTER_RE.test(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16)));
}
const PLAN_WORDS = ["Free", "Starter", "Basic", "Hobby", "Personal", "Individual", "Standard", "Plus", "Pro", "Professional", "Premium", "Creator", "Team", "Teams", "Business", "Growth", "Scale", "Developer", "Builder", "Max", "Ultra", "Lite", "Enterprise"];
const PLAN_RE = new RegExp(`\\b(?:${[...PLAN_WORDS, ...PLAN_WORDS.map((w) => w.toUpperCase())].join("|")})\\b`, "g");
const PERIOD_RE = /^\s*(\/|per\s+|a\s+)?\s*(?:(user|seat|member|editor)\s*(?:\/|per)\s*)?(month|mo|year|yr|hour|hr|request|token|credit|second|sec|minute|1M|1K|million)\b(?:\s*(?:\/|per)\s*(user|seat|member|editor)\b)?/i;
const SUBSCRIPTION_UNITS = new Set(["month", "mo", "year", "yr"]);
const BILLING_RE = /^[^.]{0,40}?billed\s+(monthly|yearly|annually|annual)/i;
const NOT_PRICE_SUFFIX = /^\s?(?:[MB]\b|bn\b|billion)/i;
const CREDIT_OR_MINIMUM_RE = /^\s*(?:\/\s*\w+)?\s*(?:min\.?\s+usage|minimum)|^[^.]{0,20}\bin (?:API )?credits\b/i;
const USAGE_UNIT_RE = /(?:\/|per)\s*(?:sec|second|hour|hr|minute|request|token|credit|1[mk]|million)|\bper\s+(?:instance|gpu)/i;

interface Cand extends PlanPrice {
  reasons: string[];
}

/** Associates prices with a plan name and billing period only when the surrounding text clearly supports it. */
export function extractPlanPrices(rawText: string): { clear: PlanPrice[]; ambiguous: { plan: string; reason: string; quote: string }[]; unassociated: number } {
  const text = normalizeText(rawText);
  const prices = [...text.matchAll(PRICE_G)].filter((m) => !NOT_PRICE_SUFFIX.test(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12)));
  const cands: Cand[] = [];
  let unassociated = 0;
  let prevEnd = 0;
  let prevPlan: string | null = null;
  prices.forEach((p, i) => {
    const start = p.index ?? 0;
    const end = start + p[0].length;
    const segStart = Math.max(i > 0 ? prevEnd : 0, start - 100);
    const seg = text.slice(segStart, start);
    let plan: string | null = null;
    let planPos = segStart;
    for (const m of seg.matchAll(PLAN_RE)) {
      plan = m[0];
      planPos = segStart + (m.index ?? 0);
    }
    if (!plan && prevPlan && i > 0 && start - prevEnd <= 40 && /\b(?:or|and)\b/i.test(seg)) plan = prevPlan;
    prevEnd = end;
    prevPlan = plan;
    if (!plan) {
      unassociated++;
      return;
    }
    const after = text.slice(end, end + 90);
    const pm = PERIOD_RE.exec(after);
    let unit: string | null = null;
    let per: string | undefined;
    let periodLen = 0;
    if (pm) {
      const unitName = pm[3].toLowerCase();
      if (pm[1] || unitName === "month" || unitName === "year") {
        unit = unitName;
        per = (pm[2] ?? pm[4])?.toLowerCase();
        periodLen = pm[0].length;
      }
    }
    const reasons: string[] = [];
    const nextTokStart = i + 1 < prices.length ? (prices[i + 1].index ?? text.length) : text.length;
    const localEnd = Math.min(nextTokStart, end + periodLen + 60);
    if (PROMO_RE.test(text.slice(Math.min(planPos, start), localEnd))) reasons.push("promotional or discounted price");
    if (/^\s*(?:US\$|CA\$|A\$|[$€£₹¥])\s?\d/.test(text.slice(end + periodLen, end + periodLen + 10))) reasons.push("two prices side by side (discounted or crossed-out price)");
    if (/[$€£₹¥]\s?\d[\d,.]*\s*$/.test(text.slice(Math.max(0, start - 12), start))) reasons.push("two prices side by side (discounted or crossed-out price)");
    if (CREDIT_OR_MINIMUM_RE.test(after.slice(periodLen))) reasons.push("credit grant or minimum-usage figure, not a plan price");
    if (unit && !SUBSCRIPTION_UNITS.has(unit)) reasons.push("usage-based rate, not a subscription price");
    const isFreeZero = /^\D*0(?:\.0+)?$/.test(p[0].replace(/\s/g, ""));
    if (!unit && !isFreeZero) reasons.push("no billing period next to the price");
    const billingM = BILLING_RE.exec(text.slice(end + periodLen, end + periodLen + 60));
    const billing = billingM ? (billingM[1].toLowerCase().startsWith("month") ? "monthly" : "yearly") : undefined;
    cands.push({
      plan: plan[0] + plan.slice(1).toLowerCase(),
      price: p[0].replace(/\s/g, ""),
      period: unit ? (unit === "mo" ? "month" : unit === "yr" ? "year" : unit) : "",
      ...(per ? { per } : {}),
      ...(billing ? { billing } : {}),
      quote: quoteAround(text, Math.min(planPos, start), end + periodLen),
      reasons,
    });
  });

  const byPlan = new Map<string, Cand[]>();
  for (const c of cands) byPlan.set(c.plan, [...(byPlan.get(c.plan) ?? []), c]);
  const clear: PlanPrice[] = [];
  const ambiguous: { plan: string; reason: string; quote: string }[] = [];
  for (const [plan, list] of byPlan) {
    const distinct = new Map<string, Cand>();
    for (const c of list) {
      const prev = distinct.get(c.price);
      if (!prev) distinct.set(c.price, { ...c, reasons: [...c.reasons] });
      else {
        prev.billing ??= c.billing;
        prev.reasons.push(...c.reasons);
      }
    }
    const items = [...distinct.values()];
    const labelled = items.every((c) => c.billing) && new Set(items.map((c) => c.billing)).size === items.length;
    if (items.length > 1 && !labelled) {
      ambiguous.push({ plan, reason: "the plan appears with more than one price and no billing labels to tell them apart", quote: items[0].quote });
      continue;
    }
    for (const c of items) {
      if (c.reasons.length) ambiguous.push({ plan, reason: [...new Set(c.reasons)].join("; "), quote: c.quote });
      else clear.push({ plan: c.plan, price: c.price, period: c.period, ...(c.per ? { per: c.per } : {}), ...(c.billing ? { billing: c.billing } : {}), quote: c.quote });
    }
  }
  return { clear, ambiguous, unassociated };
}

const fmtPlan = (p: PlanPrice) => `${p.plan}: ${p.price}${p.period ? `/${p.per ? `${p.per}/` : ""}${p.period}` : ""}${p.billing ? ` (billed ${p.billing})` : ""}`;

/**
 * A price is reported only when tied to a named plan (and billing period) by the surrounding text. Promotional,
 * crossed-out, credit/minimum and usage-based figures are not subscription prices: such cases are "Unavailable"
 * with the reason, and the raw prices and quotes are kept.
 */
export function assessPricing(text: string, sourceUrl: string): PricingFact {
  const p = extractPricing(text);
  const rawEvidence: EvidenceRef[] = p.evidence.map((e) => ({ kind: "page_text", quote: e.quote, sourceUrl }));
  switch (p.status) {
    case "found": {
      const currencies = new Set(p.prices.map((x) => (x.match(/US\$|CA\$|A\$|USD|[$€£₹¥]/i)?.[0] ?? "").toUpperCase()));
      if (currencies.size > 1) {
        return { value: UNAVAILABLE, status: "ambiguous", prices: p.prices, evidence: rawEvidence, reason: "prices appear in more than one currency" };
      }
      const { clear, ambiguous, unassociated } = extractPlanPrices(text);
      if (clear.length) {
        const evidence: EvidenceRef[] = [...clear, ...ambiguous].slice(0, 12).map((x) => ({ kind: "page_text", quote: x.quote, sourceUrl }));
        const excluded = ambiguous.length ? `${ambiguous.length} plan price(s) excluded as ambiguous (${[...new Set(ambiguous.map((a) => a.reason))].join("; ")})` : undefined;
        return { value: clear.map(fmtPlan).join("; "), status: "found", prices: p.prices, plans: clear, ...(ambiguous.length ? { ambiguousPlans: ambiguous } : {}), ...(excluded ? { reason: excluded } : {}), evidence };
      }
      if (isUsageOnly(text)) {
        return { value: "Unavailable (usage-based pricing)", status: "usage_based", prices: p.prices, evidence: rawEvidence, reason: "only usage-based rates (per second/hour/request/token) were found, not plan prices" };
      }
      const reason = ambiguous[0]?.reason
        ? `${ambiguous[0].reason}`
        : p.prices.length > 6
          ? `${p.prices.length} different price points appear on the page (likely several products or unrelated prices)`
          : "prices on the page are not clearly tied to a named plan and billing period";
      void unassociated;
      return { value: UNAVAILABLE, status: "ambiguous", prices: p.prices, ...(ambiguous.length ? { ambiguousPlans: ambiguous } : {}), evidence: rawEvidence, reason };
    }
    case "free_only":
      return { value: "Unavailable (free tier only mentioned)", status: "free_only", prices: [], evidence: rawEvidence };
    case "contact_sales":
      return { value: "Unavailable (contact sales)", status: "contact_sales", prices: [], evidence: rawEvidence };
    default:
      return { value: UNAVAILABLE, status: "unavailable", prices: [], evidence: [] };
  }
}

/**
 * Detects whether a page is an aggregator, directory, deal/funding tracker, or listicle
 * rather than a single company/product site.
 */
export function detectDirectoryOrTracker(snap: PageSnapshot): { isDirectoryOrTracker: boolean; reason?: string } {
  const title = (snap.title || "").toLowerCase();
  const meta = (snap.metaDescription || "").toLowerCase();
  const combined = `${title} ${meta}`;

  if (/\b(?:deal|funding|investment|rounds?)\s+tracker\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site is a funding / deal tracker" };
  }
  if (/\b(?:startup|company|venture|ai)\s+(?:database|directory)\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site is a startup directory / database" };
  }
  if (/\btracked rounds across \d+ companies\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site tracks funding rounds across multiple companies" };
  }
  if (/\bsee who raised (?:money|funding|capital)\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site is a funding announcement aggregator" };
  }
  if (/\bcurated (?:list|directory) of\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site is a curated list or directory" };
  }
  if (/\b(?:database|directory) of \d+[\w\s]+(?:startups|companies)\b/i.test(combined)) {
    return { isDirectoryOrTracker: true, reason: "site is a startup directory" };
  }
  if (/\btop \d+.*by funding\b/i.test(title)) {
    return { isDirectoryOrTracker: true, reason: "page is a listicle ranked by funding" };
  }

  return { isDirectoryOrTracker: false };
}

