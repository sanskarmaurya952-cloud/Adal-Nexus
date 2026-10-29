import type { PageSnapshot } from "./types.js";

/**
 * Deterministic, evidence-first extraction from UNTRUSTED page text.
 * No LLM is involved: page text is only matched with fixed patterns and returned as quoted data.
 * Nothing here interprets page text as instructions.
 */

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Collapses whitespace and strips control/bidi characters. Used for matching AND for quotes, so quotes are exact substrings. */
export function normalizeText(s: string): string {
  return String(s ?? "").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
}

/** For any page-derived string placed in tool output: normalized and length-capped. */
export function cleanText(s: unknown, max = 300): string {
  const t = normalizeText(String(s ?? ""));
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export interface EvidenceItem {
  /** Exact substring of the page's normalized visible text. */
  quote: string;
  /** The specific value the quote supports (e.g. "$20/month"). */
  matched: string;
}

export type PricingStatus = "found" | "free_only" | "contact_sales" | "unavailable";

export interface PricingResult {
  status: PricingStatus;
  /** "Unavailable" whenever no price is verified on the page. */
  summary: string;
  prices: string[];
  freeTier: boolean;
  evidence: EvidenceItem[];
}

const CURRENCY = String.raw`(?:US\$|USD\s?|CA\$|A\$|[$€£₹¥])`;
const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
const PERIOD = String.raw`(?:\s?(?:\/|per\s|a\s)\s?(?:user\s?\/\s?)?(?:month|mo|year|yr|seat|user|member|editor|project|hour|hr|request|token|credit|1[mk]|million)\b[a-z]*)?`;
const PRICE_RE = new RegExp(`${CURRENCY}\\s?${AMOUNT}${PERIOD}`, "gi");
const NOT_A_PRICE_SUFFIX = /^\s?(?:[MB]\b|bn\b|million|billion|trillion)/i;
const PRICING_CONTEXT_RE =
  /\b(?:pric(?:e|es|ing)|plans?|per\s(?:month|year|user|seat)|billed|billing|subscription|tiers?|monthly|annual(?:ly)?|credits?|upgrade)\b|\/\s?(?:mo|month|yr|year|user|seat)\b/i;
const FREE_RE = /\b(?:free forever|forever free|free plan|free tier)\b/gi;
const CONTACT_RE =
  /\b(?:contact (?:us|sales)|talk to (?:sales|an? (?:expert|specialist))|custom pricing|request (?:a )?(?:quote|pricing)|get (?:a )?quote)\b/i;

const WINDOW = 70;
const MAX_PRICES = 12;

function quoteAround(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - WINDOW), Math.min(text.length, end + WINDOW)).trim();
}

export function extractPricing(rawText: string): PricingResult {
  const text = normalizeText(rawText);
  const evidence: EvidenceItem[] = [];
  const prices: string[] = [];

  for (const m of text.matchAll(PRICE_RE)) {
    const matched = m[0].trim();
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (NOT_A_PRICE_SUFFIX.test(text.slice(end, end + 12))) continue; // e.g. "$10M raised"
    const around = text.slice(Math.max(0, start - 150), end + 150);
    const hasPeriod = /(?:\/|per\s|a\s)\s?\S/i.test(matched);
    if (!hasPeriod && !PRICING_CONTEXT_RE.test(around)) continue; // a bare amount with no pricing context is not evidence
    if (prices.includes(matched)) continue;
    prices.push(matched);
    if (evidence.length < MAX_PRICES) evidence.push({ quote: quoteAround(text, start, end), matched });
    if (prices.length >= MAX_PRICES) break;
  }

  let freeTier = false;
  for (const m of text.matchAll(FREE_RE)) {
    freeTier = true;
    if (evidence.length < MAX_PRICES + 2) {
      const start = m.index ?? 0;
      evidence.push({ quote: quoteAround(text, start, start + m[0].length), matched: m[0] });
    }
    break;
  }

  if (prices.length) {
    return { status: "found", summary: prices.join(", "), prices, freeTier, evidence };
  }
  if (freeTier) {
    return { status: "free_only", summary: "Free tier mentioned; no paid price found on this page", prices, freeTier, evidence };
  }
  const c = CONTACT_RE.exec(text);
  if (c) {
    const around = text.slice(Math.max(0, c.index - 200), c.index + c[0].length + 200);
    if (/pric|plan|enterprise/i.test(around)) {
      evidence.push({ quote: quoteAround(text, c.index, c.index + c[0].length), matched: c[0] });
      return { status: "contact_sales", summary: "Unavailable (contact sales)", prices, freeTier, evidence };
    }
  }
  return { status: "unavailable", summary: "Unavailable", prices, freeTier, evidence };
}

export interface KeywordResult {
  keyword: string;
  status: "found" | "not_found";
  quotes: string[];
}

export function extractKeywords(rawText: string, keywords: string[]): KeywordResult[] {
  const text = normalizeText(rawText);
  const lower = text.toLowerCase();
  return keywords.map((keyword) => {
    const k = keyword.toLowerCase();
    const quotes: string[] = [];
    let from = 0;
    while (quotes.length < 2) {
      const i = lower.indexOf(k, from);
      if (i < 0) break;
      quotes.push(quoteAround(text, i, i + k.length));
      from = i + k.length + WINDOW;
    }
    return { keyword, status: quotes.length ? "found" : "not_found", quotes };
  });
}

const BLOCK_PATTERNS: [RegExp, string][] = [
  [/captcha/i, "CAPTCHA"],
  [/verify (?:that )?you(?:'re| are) (?:a )?human/i, "human verification"],
  [/are you (?:a )?(?:human|robot)/i, "human verification"],
  [/unusual traffic/i, "unusual-traffic block"],
  [/bots? use duckduckgo too/i, "bot challenge"],
  [/select all squares/i, "image challenge"],
  [/just a moment\.\.\.|checking (?:if the site connection is secure|your browser)/i, "bot check"],
  [/enable javascript and cookies to continue/i, "bot check"],
  [/attention required|security check|access denied|request blocked/i, "access block"],
];

/** Returns a short label if the page looks like a CAPTCHA / bot wall (only judged on short pages). */
export function detectBlockPage(snap: Pick<PageSnapshot, "title" | "text">): string | null {
  const text = normalizeText(snap.text);
  if (text.length > 4000) return null; // long real pages that merely mention captchas are not walls
  const hay = `${snap.title} ${text}`;
  for (const [re, label] of BLOCK_PATTERNS) if (re.test(hay)) return label;
  return null;
}

/** Decodes a DuckDuckGo result link to its target URL; returns null for ads and engine-internal links. */
export function decodeSearchHref(href: string): string | null {
  try {
    const u = new URL(href);
    if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) {
      if (u.pathname.startsWith("/l/")) return u.searchParams.get("uddg");
      return null;
    }
    return href;
  } catch {
    return null;
  }
}
