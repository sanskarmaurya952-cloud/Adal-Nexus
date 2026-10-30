import React, { useEffect, useRef, useState } from "react";
import type { Bookmark, BrowserTab, HistoryEntry } from "../../types/browser";
import { DuckDuckGoIcon, GlobeIcon, HomeIcon, RefreshIcon } from "../Icons";
import { SearchResultsView } from "./SearchResultsView";
import { StartPage } from "./StartPage";
import { getApiUrl } from "../../api";

interface BrowserViewportProps {
  activeTab: BrowserTab | null;
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  onNavigate: (urlOrQuery: string) => void;
  onOpenAgent: () => void;
  onOpenSocial: () => void;
  onClearHistory: () => void;
  onRemoveBookmark: (id: string) => void;
  onReload: () => void;
  isAIAgentOpen?: boolean;
}

export function BrowserViewport({
  activeTab,
  bookmarks,
  history,
  onNavigate,
  onOpenAgent,
  onOpenSocial,
  onClearHistory,
  onRemoveBookmark,
  onReload,
  isAIAgentOpen = false,
}: BrowserViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure viewport bounding box and communicate with Electron main process
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !window.adalBrowser) return;

    const sendBounds = () => {
      requestAnimationFrame(() => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const bounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.max(0, Math.round(rect.width)),
          height: Math.max(0, Math.round(rect.height)),
        };
        window.adalBrowser?.updateViewportBounds(bounds).catch(() => {});
      });
    };

    sendBounds();
    const animTimer = setTimeout(sendBounds, 250);

    const ro = new ResizeObserver(() => {
      sendBounds();
    });
    ro.observe(el);

    window.addEventListener("resize", sendBounds);

    return () => {
      clearTimeout(animTimer);
      ro.disconnect();
      window.removeEventListener("resize", sendBounds);
    };
  }, [activeTab?.id, activeTab?.isHome, activeTab?.url, activeTab?.loading, isAIAgentOpen]);

  // Listen for navigation messages from proxied web content
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "adal-browser-navigate" && typeof e.data.url === "string") {
        onNavigate(e.data.url);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onNavigate]);

  const isHome = !activeTab || activeTab.isHome || activeTab.url === "adal://home";

  // Web mode search query extraction
  const isSearch = Boolean(
    activeTab?.url?.includes("duckduckgo.com/?q=") ||
    activeTab?.url?.includes("duckduckgo.com/html/?q=") ||
    activeTab?.url?.includes("google.com/search?q=")
  );

  let searchQuery = "";
  if (isSearch && activeTab?.url) {
    try {
      searchQuery = new URL(activeTab.url).searchParams.get("q") || "";
    } catch {
      searchQuery = "";
    }
  }

  const [launchingDesktop, setLaunchingDesktop] = useState(false);
  const handleLaunchDesktop = async () => {
    setLaunchingDesktop(true);
    try {
      await fetch(getApiUrl("/api/desktop/launch"), { method: "POST" });
    } catch {}
    setTimeout(() => setLaunchingDesktop(false), 3000);
  };

  return (
    <div ref={containerRef} className="browser-viewport-container">
      {/* Top Loading Indicator Bar */}
      {activeTab?.loading && <div className="browser-loading-bar" />}

      {/* 1. Start Page Mode */}
      {isHome && (
        <StartPage
          onNavigate={onNavigate}
          onOpenAgent={onOpenAgent}
          onOpenSocial={onOpenSocial}
          bookmarks={bookmarks}
          history={history}
          onClearHistory={onClearHistory}
          onRemoveBookmark={onRemoveBookmark}
        />
      )}

      {/* 2. Error State */}
      {!isHome && activeTab?.error && (
        <div className="browser-error-card">
          <div className="error-icon-box">
            <GlobeIcon size={40} className="error-globe-icon" />
          </div>
          <h2 className="error-title">Unable to reach website</h2>
          <p className="error-desc">{activeTab.error}</p>
          <span className="error-url-badge">{activeTab.url}</span>
          <div className="error-actions-row">
            <button type="button" className="btn-error-action primary" onClick={onReload}>
              <RefreshIcon size={16} /> Try Again
            </button>
            <button type="button" className="btn-error-action secondary" onClick={() => onNavigate("adal://home")}>
              <HomeIcon size={16} /> Return to Home
            </button>
          </div>
        </div>
      )}

      {/* 3. Real Website Mode: WebContentsView is mounted directly over this area by Electron */}
      {!isHome && !activeTab?.error && (
        <div className="browser-view-mount-placeholder">
          {!window.adalBrowser ? (
            isSearch ? (
              <SearchResultsView query={searchQuery} onNavigate={onNavigate} />
            ) : (
              <div className="web-mode-browser-view">
                <div className="web-mode-banner">
                  <div className="web-mode-banner-info">
                    {activeTab?.url?.includes("duckduckgo.com") ? (
                      <span className="web-mode-tag ddg">
                        <DuckDuckGoIcon size={14} /> DuckDuckGo
                      </span>
                    ) : (
                      <span className="web-mode-tag">Web View</span>
                    )}
                    <span className="web-mode-url" title={activeTab?.url}>
                      {activeTab?.url}
                    </span>
                  </div>
                  <div className="web-mode-banner-actions">
                    <button
                      type="button"
                      onClick={onReload}
                      className="web-mode-btn secondary"
                      title="Reload page"
                    >
                      <RefreshIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunchDesktop}
                      disabled={launchingDesktop}
                      className="web-mode-btn desktop"
                    >
                      {launchingDesktop ? "Launching..." : "🚀 Launch Desktop Browser"}
                    </button>
                  </div>
                </div>

                <div className="web-mode-architecture-notice" style={{ padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "13px", color: "#64748b", display: "flex", alignItems: "center", gap: "10px" }}>
                  <GlobeIcon size={16} />
                  <span>
                    <strong>Desktop Runtime Required:</strong> Standard web browsers restrict arbitrary external websites (YouTube, Flipkart, GitHub) due to CSP and iframe security policies. Run <code>npm run desktop:start</code> to browse inside native Electron WebContentsView.
                  </span>
                </div>

                <div className="web-mode-desktop-callout" style={{ padding: "40px 24px", textAlign: "center", color: "#475569" }}>
                  <GlobeIcon size={48} style={{ color: "#3b82f6", margin: "0 auto 16px auto" }} />
                  <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "#1e293b" }}>Native Chromium Browser Required</h3>
                  <p style={{ maxWidth: "480px", margin: "0 auto 16px auto", lineHeight: "1.5", fontSize: "14px" }}>
                    External websites like YouTube and Flipkart require genuine Chromium processes. Click <strong>Launch Desktop Browser</strong> above or run <code>npm run desktop:start</code> to browse inside native Electron WebContentsView.
                  </p>
                  <button
                    type="button"
                    onClick={handleLaunchDesktop}
                    disabled={launchingDesktop}
                    className="web-mode-btn desktop"
                    style={{ margin: "0 auto", padding: "10px 20px", fontSize: "14px" }}
                  >
                    {launchingDesktop ? "Launching Desktop Browser..." : "🚀 Launch Desktop Browser"}
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="mount-backdrop" />
          )}
        </div>
      )}
    </div>
  );
}
