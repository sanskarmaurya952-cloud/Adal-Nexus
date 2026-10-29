/** Typed research records with RUNTIME validators (TypeScript types alone are not trusted for data passed between steps). */

export type Origin = "search" | "fallback" | "input";
export const ORIGINS: readonly Origin[] = ["search", "fallback", "input"];

export interface EvidenceRef {
  /** page_text: exact substring of the page's visible text. meta: the page's meta description. title: the <title>. */
  kind: "page_text" | "meta" | "title";
  quote: string;
  sourceUrl: string;
}

export interface Fact {
  /** "Unavailable" (or an "Unavailable (...)" variant) whenever it could not be verified from the page. */
  value: string;
  evidence: EvidenceRef[];
}

export type PricingStatus = "found" | "ambiguous" | "usage_based" | "contact_sales" | "free_only" | "unavailable";

/** A price tied to a named plan by the surrounding page text. */
export interface PlanPrice {
  plan: string;
  price: string;
  /** "month" | "year", or "" when the page shows no period (only allowed for a zero price). */
  period: string;
  /** "user" | "seat" | "member" | "editor" when the price is per seat. */
  per?: string;
  billing?: string;
  quote: string;
}
export interface PricingFact extends Fact {
  status: PricingStatus;
  prices: string[];
  plans?: PlanPrice[];
  ambiguousPlans?: { plan: string; reason: string; quote: string }[];
  reason?: string;
}

export interface SourceCandidate {
  url: string;
  title?: string;
  origin: Origin;
  note?: string;
}

export interface SourcesOutput {
  query: string;
  sources: SourceCandidate[];
  searchStatus: "ok" | "failed" | "insufficient";
  searchError?: string;
  queriesTried?: string[];
  fallbackUsed: boolean;
  fallbackReason?: string;
  fallbackLabel?: string;
  skippedAsNotOfficial: number;
}

export interface VisitedPage {
  url: string;
  role: "home" | "pricing" | "about";
  title: string;
  status: number | null;
}

export interface ResearchRecord {
  candidateUrl: string;
  origin: Origin;
  status: "ok" | "partial" | "failed";
  error?: string;
  researchedAt: string;
  name: Fact;
  product: Fact;
  targetMarket: Fact;
  pricing: PricingFact;
  pages: VisitedPage[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isUnavailable = (s: string) => s.startsWith("Unavailable");
const PRICING_STATUSES: PricingStatus[] = ["found", "ambiguous", "usage_based", "contact_sales", "free_only", "unavailable"];

/** Validates `sources` input from a previous step (or from a user). Throws with a precise message. */
export function parseSources(input: unknown, checkUrl: (u: string) => boolean): SourceCandidate[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("sources must be a non-empty array");
  if (input.length > 50) throw new Error("sources has more than 50 entries");
  return input.map((raw, i) => {
    if (!isObj(raw)) throw new Error(`sources[${i}] must be an object`);
    if (typeof raw.url !== "string" || !raw.url) throw new Error(`sources[${i}].url must be a string`);
    if (!checkUrl(raw.url)) throw new Error(`sources[${i}].url is not an allowed public http(s) URL`);
    const origin = raw.origin === undefined ? "input" : raw.origin;
    if (!ORIGINS.includes(origin as Origin)) throw new Error(`sources[${i}].origin must be one of ${ORIGINS.join(", ")}`);
    return {
      url: raw.url,
      origin: origin as Origin,
      ...(typeof raw.title === "string" ? { title: raw.title.slice(0, 200) } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note.slice(0, 300) } : {}),
    };
  });
}

function checkFact(f: unknown, name: string, checkUrl: (u: string) => boolean, problems: string[]): void {
  if (!isObj(f) || typeof f.value !== "string" || !Array.isArray(f.evidence)) return void problems.push(`${name}: must have string value and evidence array`);
  for (const [i, e] of (f.evidence as unknown[]).entries()) {
    if (!isObj(e) || !["page_text", "meta", "title"].includes(String(e.kind))) problems.push(`${name}.evidence[${i}]: invalid kind`);
    else if (typeof e.quote !== "string" || !e.quote.trim() || e.quote.length > 400) problems.push(`${name}.evidence[${i}]: quote must be 1-400 characters`);
    else if (typeof e.sourceUrl !== "string" || !checkUrl(e.sourceUrl)) problems.push(`${name}.evidence[${i}]: missing or disallowed sourceUrl`);
  }
  if (!isUnavailable(f.value) && f.evidence.length === 0) problems.push(`${name}: value "${f.value.slice(0, 40)}" has no evidence (must be "Unavailable")`);
}

/** Returns a list of problems; empty means the record is structurally valid and every claim has evidence + a source. */
export function validateRecord(r: unknown, checkUrl: (u: string) => boolean): string[] {
  const problems: string[] = [];
  if (!isObj(r)) return ["record must be an object"];
  if (typeof r.candidateUrl !== "string" || !checkUrl(r.candidateUrl)) problems.push("candidateUrl missing or disallowed");
  if (!ORIGINS.includes(r.origin as Origin)) problems.push("origin invalid");
  if (!["ok", "partial", "failed"].includes(String(r.status))) problems.push("status invalid");
  if (r.status === "failed") return problems.length ? problems : [];
  for (const k of ["name", "product", "targetMarket"] as const) checkFact(r[k], k, checkUrl, problems);
  checkFact(r.pricing, "pricing", checkUrl, problems);
  const p = r.pricing;
  if (isObj(p)) {
    if (!PRICING_STATUSES.includes(p.status as PricingStatus)) problems.push("pricing.status invalid");
    if (!Array.isArray(p.prices) || p.prices.some((x) => typeof x !== "string")) problems.push("pricing.prices must be strings");
    if (p.status === "found" && (!Array.isArray(p.prices) || p.prices.length === 0)) problems.push('pricing.status "found" requires prices');
    if (p.status !== "found" && typeof p.value === "string" && !isUnavailable(p.value)) problems.push(`pricing.status "${String(p.status)}" must have an "Unavailable" value`);
  }
  if (!Array.isArray(r.pages) || r.pages.length === 0) problems.push("pages must list at least one visited page");
  return problems;
}
