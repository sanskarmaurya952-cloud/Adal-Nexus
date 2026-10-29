import React, { useEffect, useRef, useState } from "react";
import type { Bookmark, BrowserTab } from "../../types/browser";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  DuckDuckGoIcon,
  GlobeIcon,
  GoogleGIcon,
  HomeIcon,
  MicrophoneIcon,
  MoonIcon,
  PlusIcon,
  RefreshIcon,
  SparklesIcon,
  StarIcon,
  StopIcon,
  SunIcon,
  UserIcon,
  XIcon,
} from "../Icons";

interface BrowserChromeProps {
  tabs: BrowserTab[];
  activeTab: BrowserTab | null;
  bookmarks: Bookmark[];
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSelectTab: (id: string) => void;
  onNavigate: (urlOrQuery: string, searchEngine?: "duckduckgo" | "google") => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onGoHome: () => void;
  onToggleBookmark: () => void;
  onOpenDownloads: () => void;
  onToggleAIAgent: () => void;
  isAIAgentOpen: boolean;
  isBookmarked: boolean;
  downloadStatus?: { filename: string; state: string; percent?: number } | null;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenProfileOrSettings: () => void;
}

export function BrowserChrome({
  tabs,
  activeTab,
  bookmarks,
  onNewTab,
  onCloseTab,
  onSelectTab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onStop,
  onGoHome,
  onToggleBookmark,
  onOpenDownloads,
  onToggleAIAgent,
  isAIAgentOpen,
  isBookmarked,
  downloadStatus,
  isDarkMode,
  onToggleDarkMode,
  onOpenProfileOrSettings,
}: BrowserChromeProps) {
  const [addressInput, setAddressInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [searchEngine, setSearchEngine] = useState<"duckduckgo" | "google">(() => {
    try {
      return (localStorage.getItem("adal-search-engine") as "duckduckgo" | "google") || "google";
    } catch {
      return "google";
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSearchEngine = () => {
    const next = searchEngine === "duckduckgo" ? "google" : "duckduckgo";
    setSearchEngine(next);
    try {
      localStorage.setItem("adal-search-engine", next);
    } catch {}
  };

  // Sync address bar input with active tab URL when not actively editing
  useEffect(() => {
    if (!isEditing) {
      if (activeTab?.isHome || activeTab?.url === "adal://home" || !activeTab?.url) {
        setAddressInput("");
      } else {
        setAddressInput(activeTab.url);
      }
    }
  }, [activeTab?.url, activeTab?.isHome, isEditing]);

  // Focus address bar handler (Ctrl+L) from renderer window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsEditing(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for focusAddressBar IPC event sent from native WebContentsView
  useEffect(() => {
    const unsub = window.adalBrowser?.onFocusAddressBar?.(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      setIsEditing(true);
    });
    return () => unsub?.();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (addressInput.trim()) {
      onNavigate(addressInput.trim(), searchEngine);
      inputRef.current?.blur();
      setIsEditing(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setAddressInput(activeTab?.isHome || !activeTab?.url ? "" : activeTab.url);
      inputRef.current?.blur();
      setIsEditing(false);
    }
  };

  return (
    <header className="browser-chrome-topbar">
      {/* ROW 1: Logo Brand + Real Tab Strip + New Tab Button */}
      <div className="browser-top-row">
        {/* Brand Logo & Name */}
        <div className="browser-brand-lockup" onClick={onGoHome} role="button" tabIndex={0} title="AdaL-Nexus Browser Home">
          <div className="brand-logo-badge">
            <span className="brand-logo-letter">A</span>
          </div>
          <span className="brand-title-text">AdaL Nexus</span>
        </div>

        {/* Tab Strip */}
        <div className="browser-tab-strip-wrapper">
          <div className="browser-tab-strip" role="tablist">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab?.id;
              const titleText = tab.isHome || tab.url === "adal://home" ? "New Tab" : tab.title || tab.url;

              return (
                <div
                  key={tab.id}
                  className={`browser-tab-pill ${isActive ? "active" : ""}`}
                  onClick={() => onSelectTab(tab.id)}
                  role="tab"
                  aria-selected={isActive}
                  title={tab.url}
                >
                  <div className="tab-icon-box">
                    {tab.loading ? (
                      <span className="tab-spinner" />
                    ) : tab.favicon ? (
                      <img
                        src={tab.favicon}
                        alt=""
                        className="tab-favicon"
                        onError={(e) => ((e.target as HTMLElement).style.display = "none")}
                      />
                    ) : (
                      <GlobeIcon size={14} className="tab-globe-icon" />
                    )}
                  </div>
                  <span className="tab-label">{titleText}</span>
                  <button
                    type="button"
                    className="tab-close-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    title="Close tab (Ctrl+W)"
                    aria-label="Close tab"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* New Tab Button */}
          <button
            type="button"
            className="btn-add-tab"
            onClick={onNewTab}
            title="New Tab (Ctrl+T)"
            aria-label="New Tab"
          >
            <PlusIcon size={16} />
          </button>
        </div>

        {/* Window Drag Space on Right before native window controls */}
        <div className="window-drag-region" />
      </div>

      {/* ROW 2: Navigation Controls + Omnibox + Action Buttons */}
      <div className="browser-toolbar-row">
        {/* Navigation buttons: Back, Forward, Reload/Stop, Home */}
        <div className="toolbar-nav-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={onGoBack}
            disabled={!activeTab?.canGoBack}
            title="Back (Alt+Left)"
            aria-label="Back"
          >
            <ArrowLeftIcon size={17} />
          </button>

          <button
            type="button"
            className="toolbar-btn"
            onClick={onGoForward}
            disabled={!activeTab?.canGoForward}
            title="Forward (Alt+Right)"
            aria-label="Forward"
          >
            <ArrowRightIcon size={17} />
          </button>

          {activeTab?.loading ? (
            <button
              type="button"
              className="toolbar-btn"
              onClick={onStop}
              title="Stop loading"
              aria-label="Stop loading"
            >
              <StopIcon size={15} />
            </button>
          ) : (
            <button
              type="button"
              className="toolbar-btn"
              onClick={onReload}
              title="Reload (Ctrl+R)"
              aria-label="Reload"
            >
              <RefreshIcon size={16} />
            </button>
          )}

          <button
            type="button"
            className="toolbar-btn"
            onClick={onGoHome}
            title="New Tab / Home"
            aria-label="Home"
          >
            <HomeIcon size={17} />
          </button>
        </div>

        {/* Omnibox / Combined Address & Search Bar */}
        <form className="browser-omnibox-form" onSubmit={handleSubmit}>
          <div className={`browser-omnibox-pill ${isEditing ? "is-focused" : ""}`}>
            <button
              type="button"
              className="omnibox-engine-toggle-btn"
              onClick={toggleSearchEngine}
              title={`Active Search Engine: ${searchEngine === "duckduckgo" ? "DuckDuckGo (Private Search)" : "Google"}. Click to switch.`}
              aria-label="Toggle search engine"
            >
              {searchEngine === "duckduckgo" ? (
                <DuckDuckGoIcon size={18} />
              ) : (
                <GoogleGIcon size={18} />
              )}
            </button>

            <input
              ref={inputRef}
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                setIsEditing(true);
                inputRef.current?.select();
              }}
              onBlur={() => setIsEditing(false)}
              placeholder={searchEngine === "duckduckgo" ? "Search DuckDuckGo or enter URL..." : "Search Google or enter URL..."}
              className="omnibox-input"
              spellCheck={false}
              autoComplete="off"
            />

            {/* Bookmark Star Toggle inside Omnibox */}
            <button
              type="button"
              className={`omnibox-action-btn ${isBookmarked ? "bookmarked" : ""}`}
              onClick={onToggleBookmark}
              title={isBookmarked ? "Remove Bookmark" : "Bookmark this tab"}
              aria-label="Bookmark"
            >
              <StarIcon size={17} filled={isBookmarked} />
            </button>
          </div>
        </form>

        {/* Right Toolbar Actions */}
        <div className="toolbar-actions-group">
          {/* Theme Toggle */}
          <button
            type="button"
            className="toolbar-action-icon-btn"
            onClick={onToggleDarkMode}
            title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>

          {/* Downloads Action */}
          <button
            type="button"
            className={`toolbar-action-icon-btn ${downloadStatus?.state === "progressing" ? "downloading" : ""}`}
            onClick={onOpenDownloads}
            title="Downloads & Workbooks"
            aria-label="Downloads"
          >
            <DownloadIcon size={18} />
            {downloadStatus?.state === "progressing" && <span className="download-active-badge" />}
          </button>

          {/* Voice Command Button in Toolbar */}
          <button
            type="button"
            className="toolbar-voice-btn"
            onClick={() => {
              if (!isAIAgentOpen) onToggleAIAgent();
            }}
            title="Voice Commands (Alt+M)"
            aria-label="Voice Commands"
          >
            <MicrophoneIcon size={16} />
          </button>

          {/* AI Assistant Button (Purple Pill Matching Screenshot) */}
          <button
            type="button"
            className={`toolbar-ai-assistant-btn ${isAIAgentOpen ? "active" : ""}`}
            onClick={onToggleAIAgent}
            title="Toggle AI Agent Panel"
            aria-label="AI Assistant"
          >
            <SparklesIcon size={16} />
          </button>

          {/* Profile / Settings Button */}
          <button
            type="button"
            className="toolbar-action-icon-btn profile-btn"
            onClick={onOpenProfileOrSettings}
            title="Settings & Profile"
            aria-label="Profile"
          >
            <UserIcon size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
