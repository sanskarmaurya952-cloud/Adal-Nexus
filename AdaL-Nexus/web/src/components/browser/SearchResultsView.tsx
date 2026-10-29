import React, { useEffect, useState } from "react";
import { DuckDuckGoIcon, GlobeIcon, RefreshIcon, SearchIcon } from "../Icons";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

interface SearchResultsViewProps {
  query: string;
  onNavigate: (urlOrQuery: string) => void;
}

export function SearchResultsView({ query, onNavigate }: SearchResultsViewProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [launchingDesktop, setLaunchingDesktop] = useState(false);

  useEffect(() => {
    setSearchInput(query);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetch(`/api/browser/search?q=${encodeURIComponent(query.trim())}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          if (data.results && Array.isArray(data.results)) {
            setResults(data.results);
          } else {
            setResults([]);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [query]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onNavigate(`https://duckduckgo.com/?q=${encodeURIComponent(searchInput.trim())}`);
    }
  };

  const handleLaunchDesktop = async () => {
    setLaunchingDesktop(true);
    try {
      await fetch("/api/desktop/launch", { method: "POST" });
    } catch {}
    setTimeout(() => setLaunchingDesktop(false), 3000);
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <div className="search-results-page">
      {/* Top Header Row with DuckDuckGo Branding & Search Box */}
      <div className="search-header-bar">
        <div className="search-header-left">
          <div className="search-ddg-brand" onClick={() => onNavigate("https://duckduckgo.com")} role="button" tabIndex={0}>
            <DuckDuckGoIcon size={24} />
            <span className="search-ddg-brand-name">DuckDuckGo</span>
          </div>

          <form onSubmit={handleSearchSubmit} className="search-header-form">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search DuckDuckGo..."
              className="search-header-input"
            />
            <button type="submit" className="search-header-submit-btn" title="Search">
              <SearchIcon size={16} />
            </button>
          </form>
        </div>

        <div className="search-header-actions">
          <button
            type="button"
            onClick={handleLaunchDesktop}
            disabled={launchingDesktop}
            className="search-action-btn desktop"
            title="Launch native Windows Desktop Browser"
          >
            {launchingDesktop ? "Launching..." : "🚀 Launch Desktop Browser"}
          </button>
        </div>
      </div>

      {/* Main Results Container */}
      <div className="search-results-content">
        <div className="search-stats-row">
          <span className="search-stats-text">
            {loading
              ? `Searching DuckDuckGo for "${query}"...`
              : `Found ${results.length} live results for "${query}"`}
          </span>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="search-loading-skeletons">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="search-skeleton-card">
                <div className="skeleton-line domain" />
                <div className="skeleton-line title" />
                <div className="skeleton-line desc" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="search-error-box">
            <h3>Unable to fetch search results</h3>
            <p>{error}</p>
            <div className="search-error-actions">
              <button
                type="button"
                className="btn-retry"
                onClick={() => onNavigate(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`)}
              >
                <RefreshIcon size={14} /> Try Again
              </button>
              <a
                href={`https://duckduckgo.com/?q=${encodeURIComponent(query)}`}
                target="_blank"
                rel="noreferrer"
                className="btn-open-ext"
              >
                Open in Official DuckDuckGo ↗
              </a>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && results.length === 0 && (
          <div className="search-empty-box">
            <p>No results found for &ldquo;{query}&rdquo;.</p>
            <p className="search-empty-sub">Try searching with broader terms or check your spelling.</p>
          </div>
        )}

        {/* Real Live Results List */}
        {!loading && !error && results.length > 0 && (
          <div className="search-results-list">
            {results.map((res, index) => (
              <article key={res.url + index} className="search-result-item">
                <div className="result-domain-row">
                  <div className="result-domain-icon">
                    <GlobeIcon size={14} />
                  </div>
                  <span className="result-domain-text">{res.domain || "web"}</span>
                  <span className="result-url-text">{res.url}</span>
                </div>

                <h2 className="result-title">
                  <a
                    href={res.url}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate(res.url);
                    }}
                    className="result-title-link"
                  >
                    {res.title}
                  </a>
                </h2>

                <p className="result-snippet">{res.snippet}</p>

                <div className="result-footer-actions">
                  <button
                    type="button"
                    className="result-open-btn"
                    onClick={() => onNavigate(res.url)}
                  >
                    Open in Browser
                  </button>
                  <a
                    href={res.url}
                    target="_blank"
                    rel="noreferrer"
                    className="result-ext-btn"
                  >
                    Open in New Window ↗
                  </a>
                  <button
                    type="button"
                    className="result-copy-btn"
                    onClick={() => handleCopyLink(res.url)}
                  >
                    {copiedUrl === res.url ? "✓ Copied" : "Copy Link"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
