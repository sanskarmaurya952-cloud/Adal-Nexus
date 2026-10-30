/**
 * URL parsing, validation, and search query conversion policy for AdaL-Nexus Desktop Browser.
 */

const BLOCKED_SCHEMES = new Set([
  "javascript:",
  "file:",
  "data:",
  "vbscript:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
]);

// Common valid TLDs or patterns (e.g., .com, .org, .net, .io, .dev, .ai, .app, .edu, .gov, or 2-letter ccTLDs)
const DOMAIN_REGEX = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;
const LOCALHOST_REGEX = /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;

export type SearchEngine = "duckduckgo" | "google";

export interface UrlResolutionResult {
  url: string;
  isSearch: boolean;
  isValid: boolean;
  engine?: SearchEngine;
  error?: string;
}

/**
 * Resolves user input from the address bar into a valid, safe HTTPS/HTTP URL or search query.
 * Supports DuckDuckGo and Google search engines, with DuckDuckGo keywords 'ddg' and 'duckduckgo'.
 */
export function resolveAddressBarInput(
  rawInput: string,
  defaultEngine: SearchEngine = "google",
): UrlResolutionResult {
  const input = rawInput.trim();
  if (!input) {
    return { url: "adal://home", isSearch: false, isValid: true };
  }

  // Internal custom home scheme
  if (input === "adal://home" || input === "adal://newtab") {
    return { url: "adal://home", isSearch: false, isValid: true };
  }

  // Check for blocked dangerous schemes
  const lower = input.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return {
        url: "",
        isSearch: false,
        isValid: false,
        error: `Navigation to protocol '${scheme}' is blocked for security reasons.`,
      };
    }
  }

  // Direct platform keyword shortcuts
  if (lower === "youtube") {
    return {
      url: "https://www.youtube.com/",
      isSearch: false,
      isValid: true,
    };
  }

  if (
    lower === "whatsapp" ||
    lower === "wahtsaap" ||
    lower === "whatsap" ||
    lower === "watsapp" ||
    lower === "wahtsapp"
  ) {
    return {
      url: "https://web.whatsapp.com/",
      isSearch: false,
      isValid: true,
    };
  }

  if (lower === "duckduckgo" || lower === "ddg") {
    return {
      url: "https://duckduckgo.com/",
      isSearch: false,
      isValid: true,
    };
  }

  // Explicit DuckDuckGo search prefix
  if (lower.startsWith("ddg ") || lower.startsWith("duckduckgo ")) {
    const query = input.replace(/^(ddg|duckduckgo)\s+/i, "").trim();
    return {
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      isSearch: true,
      isValid: true,
      engine: "duckduckgo",
    };
  }

  // Explicit Google search prefix
  if (lower.startsWith("g ") || lower.startsWith("google ")) {
    const query = input.replace(/^(g|google)\s+/i, "").trim();
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      isSearch: true,
      isValid: true,
      engine: "google",
    };
  }

  // If already prefixed with http:// or https://
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { url: parsed.href, isSearch: false, isValid: true };
      }
    } catch {
      // Malformed URL, fall through to search
    }
  }

  const buildSearchUrl = (query: string) => {
    if (defaultEngine === "duckduckgo") {
      return {
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        isSearch: true,
        isValid: true,
        engine: "duckduckgo" as const,
      };
    }
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      isSearch: true,
      isValid: true,
      engine: "google" as const,
    };
  };

  // If input contains spaces, it's definitely a search query
  if (/\s/.test(input)) {
    return buildSearchUrl(input);
  }

  // Check if it's localhost or an IP
  if (LOCALHOST_REGEX.test(input)) {
    return {
      url: `http://${input}`,
      isSearch: false,
      isValid: true,
    };
  }

  // Check if it looks like a domain name
  if (DOMAIN_REGEX.test(input)) {
    try {
      const parsed = new URL(`https://${input}`);
      return {
        url: parsed.href,
        isSearch: false,
        isValid: true,
      };
    } catch {
      // Fall through to search if URL constructor rejects
    }
  }

  // Default: treat plain text without valid domain syntax as search
  return buildSearchUrl(input);
}

/**
 * Validates whether a navigation URL is safe to open in a WebContentsView.
 */
export function isNavigationUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
