/**
 * Minimal browser surface used by the research tools. Deliberately tiny and read-only:
 * navigate, read the page, read search results. No clicking, typing, scripts, downloads or forms.
 * Tests replace this with a mock; production uses PlaywrightDriver.
 */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text (document.body.innerText), untrusted. */
  text: string;
  metaDescription: string;
  headings: string[];
  links: { text: string; href: string }[];
}

export interface RawSearchResult {
  title: string;
  href: string;
  snippet: string;
}

export interface NavigationResult {
  status: number | null;
  finalUrl: string;
}

export interface BrowserPage {
  currentUrl(): string;
  goto(url: string, opts: { timeoutMs: number; signal: AbortSignal }): Promise<NavigationResult>;
  snapshot(): Promise<PageSnapshot>;
  /** Parses the currently loaded search-engine results page. */
  searchResults(): Promise<RawSearchResult[]>;
}

export interface BrowserDriver {
  /** Returns the working page, launching the visible browser if necessary. */
  getPage(): Promise<BrowserPage>;
  /** Returns the working page only if a browser is already open. Never launches. */
  existingPage(): BrowserPage | null;
  status(): { launched: boolean; url: string | null };
  close(): Promise<void>;
}
