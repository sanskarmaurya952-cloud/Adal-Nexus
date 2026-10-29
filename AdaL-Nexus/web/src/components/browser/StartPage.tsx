import React, { useEffect, useState } from "react";
import type { Bookmark, HistoryEntry } from "../../types/browser";
import {
  BoltIcon,
  ChatGptLogoIcon,
  DuckDuckGoIcon,
  GithubLogoIcon,
  GoogleGIcon,
  NotionLogoIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  SparklesIcon,
} from "../Icons";

interface StartPageProps {
  onNavigate: (urlOrQuery: string, searchEngine?: "duckduckgo" | "google") => void;
  onOpenAgent: () => void;
  onOpenSocial: () => void;
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  onClearHistory: () => void;
  onRemoveBookmark: (id: string) => void;
}

export function StartPage({
  onNavigate,
  onOpenAgent,
  onOpenSocial,
  bookmarks,
  history,
  onClearHistory,
  onRemoveBookmark,
}: StartPageProps) {
  const [searchInput, setSearchInput] = useState("");
  const [searchEngine, setSearchEngine] = useState<"duckduckgo" | "google">(() => {
    try {
      return (localStorage.getItem("adal-search-engine") as "duckduckgo" | "google") || "google";
    } catch {
      return "google";
    }
  });
  const [currentTime, setCurrentTime] = useState("");
  const [greeting, setGreeting] = useState("Good Morning! ☀️");

  const handleSelectEngine = (engine: "duckduckgo" | "google") => {
    setSearchEngine(engine);
    try {
      localStorage.setItem("adal-search-engine", engine);
    } catch {}
  };

  // Keep live time and greeting updated
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
      setCurrentTime(timeStr);

      const hours = now.getHours();
      if (hours < 12) {
        setGreeting("Good Morning! ☀️");
      } else if (hours < 18) {
        setGreeting("Good Afternoon! 🌤️");
      } else {
        setGreeting("Good Evening! 🌙");
      }
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onNavigate(searchInput.trim(), searchEngine);
    }
  };

  const defaultShortcuts = [
    {
      title: "DuckDuckGo",
      url: "https://duckduckgo.com",
      icon: <DuckDuckGoIcon size={24} />,
      bg: "#ffffff",
      border: "#e2e8f0",
    },
    {
      title: "Google",
      url: "https://www.google.com",
      icon: <GoogleGIcon size={24} />,
      bg: "#ffffff",
      border: "#e2e8f0",
    },
    {
      title: "GitHub",
      url: "https://github.com",
      icon: <GithubLogoIcon size={22} className="shortcut-github-icon" />,
      bg: "#181717",
      color: "#ffffff",
    },
    {
      title: "ChatGPT",
      url: "https://chatgpt.com",
      icon: <ChatGptLogoIcon size={22} className="shortcut-chatgpt-icon" />,
      bg: "#10a37f",
      color: "#ffffff",
    },
    {
      title: "Notion",
      url: "https://www.notion.so",
      icon: <NotionLogoIcon size={20} className="shortcut-notion-icon" />,
      bg: "#000000",
      color: "#ffffff",
    },
  ];

  return (
    <div className="start-page-canvas">
      {/* Top Canvas Row: Time, Greeting & Customize Button */}
      <div className="start-page-top-bar">
        <div className="time-greeting-box">
          <span className="digital-clock-text">{currentTime || "09:31 AM"}</span>
          <span className="greeting-subtext">{greeting}</span>
        </div>

        <button
          type="button"
          className="btn-canvas-customize"
          onClick={() => onOpenAgent()}
          title="Customize start page or launch AI assistant"
        >
          <PencilIcon size={14} />
          <span>Customize</span>
        </button>
      </div>

      {/* Center Main Stage */}
      <div className="start-page-center-stage">
        {/* Glowing Brand Mark */}
        <div className="center-brand-logo-badge">
          <span className="center-brand-logo-letter">A</span>
        </div>

        <h1 className="center-brand-title">AdaL Nexus</h1>
        <p className="center-brand-subtitle">Your Intelligent Browser for a Smarter Web</p>

        {/* Search Engine Mode Switcher */}
        <div className="start-engine-selector-row">
          <button
            type="button"
            className={`start-engine-pill ${searchEngine === "duckduckgo" ? "active" : ""}`}
            onClick={() => handleSelectEngine("duckduckgo")}
          >
            <DuckDuckGoIcon size={16} />
            <span>DuckDuckGo</span>
          </button>
          <button
            type="button"
            className={`start-engine-pill ${searchEngine === "google" ? "active" : ""}`}
            onClick={() => handleSelectEngine("google")}
          >
            <GoogleGIcon size={16} />
            <span>Google</span>
          </button>
        </div>

        {/* Big Rounded Center Search Bar */}
        <form onSubmit={handleSearchSubmit} className="center-search-form">
          <div className="center-search-pill">
            <div className="center-search-lead-icon">
              {searchEngine === "duckduckgo" ? (
                <DuckDuckGoIcon size={20} />
              ) : (
                <GoogleGIcon size={20} />
              )}
            </div>

            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={searchEngine === "duckduckgo" ? "Search DuckDuckGo privately or enter URL..." : "Search Google or enter URL..."}
              className="center-search-input"
              autoFocus
            />

            <button type="submit" className="center-search-action-btn" title="Search">
              <SearchIcon size={18} />
            </button>
          </div>
        </form>

        {/* Shortcuts Row */}
        <div className="center-shortcuts-row">
          {defaultShortcuts.map((sc) => (
            <button
              key={sc.url}
              type="button"
              className="shortcut-item-btn"
              onClick={() => onNavigate(sc.url)}
              title={`Open ${sc.title}`}
            >
              <div
                className="shortcut-circle"
                style={{ backgroundColor: sc.bg, color: sc.color, borderColor: sc.border }}
              >
                {sc.icon}
              </div>
              <span className="shortcut-title">{sc.title}</span>
            </button>
          ))}

          {/* Add Shortcut button */}
          <button
            type="button"
            className="shortcut-item-btn add-shortcut"
            onClick={() => {
              const url = window.prompt("Enter website URL (e.g. youtube.com):");
              if (url) onNavigate(url);
            }}
            title="Add custom shortcut"
          >
            <div className="shortcut-circle dashed">
              <PlusIcon size={20} />
            </div>
            <span className="shortcut-title">Add Shortcut</span>
          </button>
        </div>
      </div>

      {/* Bottom 4 Feature Cards (Directly Matching Screenshot) */}
      <div className="start-page-feature-cards-grid">
        <div className="start-feature-card" onClick={onOpenAgent} role="button" tabIndex={0}>
          <div className="feature-icon-box fast-purple">
            <BoltIcon size={20} />
          </div>
          <div className="feature-text-meta">
            <span className="feature-title">Fast</span>
            <span className="feature-desc">Built for speed and productivity</span>
          </div>
        </div>

        <div className="start-feature-card">
          <div className="feature-icon-box secure-green">
            <ShieldIcon size={20} />
          </div>
          <div className="feature-text-meta">
            <span className="feature-title">Secure</span>
            <span className="feature-desc">Your data stays in your control</span>
          </div>
        </div>

        <div className="start-feature-card" onClick={onOpenAgent} role="button" tabIndex={0}>
          <div className="feature-icon-box smart-pink">
            <SparklesIcon size={20} />
          </div>
          <div className="feature-text-meta">
            <span className="feature-title">Smart</span>
            <span className="feature-desc">AI-powered browsing experience</span>
          </div>
        </div>

        <div className="start-feature-card" onClick={onOpenSocial} role="button" tabIndex={0}>
          <div className="feature-icon-box custom-blue">
            <SlidersIcon size={20} />
          </div>
          <div className="feature-text-meta">
            <span className="feature-title">Customizable</span>
            <span className="feature-desc">Make it yours with themes and shortcuts</span>
          </div>
        </div>
      </div>
    </div>
  );
}
