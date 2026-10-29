import React from "react";
import {
  AgentIcon,
  BookmarkIcon,
  DownloadIcon,
  HistoryIcon,
  HomeIcon,
  PuzzleIcon,
  SettingsIcon,
  SparklesIcon,
} from "../Icons";

export type SidebarTab = "home" | "bookmarks" | "history" | "downloads" | "extensions" | "settings";

interface BrowserSidebarProps {
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  isAIAgentOpen: boolean;
  onToggleAIAgent: () => void;
  isAgentRunning?: boolean;
  agentNeedsApproval?: boolean;
}

export function BrowserSidebar({
  activeTab,
  onSelectTab,
  isAIAgentOpen,
  onToggleAIAgent,
  isAgentRunning = false,
  agentNeedsApproval = false,
}: BrowserSidebarProps) {
  return (
    <aside className="browser-sidebar-rail" aria-label="Browser navigation rail">
      {/* Top Main Navigation Items */}
      <div className="sidebar-top-group">
        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "home" ? "active" : ""}`}
          onClick={() => onSelectTab("home")}
          title="New Tab / Home"
          aria-label="Home"
        >
          <div className="sidebar-icon-box">
            <HomeIcon size={20} />
          </div>
          <span className="sidebar-label">Home</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "bookmarks" ? "active" : ""}`}
          onClick={() => onSelectTab("bookmarks")}
          title="Saved Bookmarks"
          aria-label="Bookmarks"
        >
          <div className="sidebar-icon-box">
            <BookmarkIcon size={20} />
          </div>
          <span className="sidebar-label">Bookmarks</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => onSelectTab("history")}
          title="Browsing History"
          aria-label="History"
        >
          <div className="sidebar-icon-box">
            <HistoryIcon size={20} />
          </div>
          <span className="sidebar-label">History</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "downloads" ? "active" : ""}`}
          onClick={() => onSelectTab("downloads")}
          title="Downloads & Generated Workbooks"
          aria-label="Downloads"
        >
          <div className="sidebar-icon-box">
            <DownloadIcon size={20} />
          </div>
          <span className="sidebar-label">Downloads</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "extensions" ? "active" : ""}`}
          onClick={() => onSelectTab("extensions")}
          title="Browser Extensions & Shields"
          aria-label="Extensions"
        >
          <div className="sidebar-icon-box">
            <PuzzleIcon size={20} />
          </div>
          <span className="sidebar-label">Extensions</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => onSelectTab("settings")}
          title="Browser Settings & Model Status"
          aria-label="Settings"
        >
          <div className="sidebar-icon-box">
            <SettingsIcon size={20} />
          </div>
          <span className="sidebar-label">Settings</span>
        </button>
      </div>

      {/* Bottom Floating AI Agent Launcher */}
      <div className="sidebar-bottom-group">
        <button
          type="button"
          className={`sidebar-ai-agent-btn ${isAIAgentOpen ? "active" : ""} ${isAgentRunning ? "running" : ""} ${agentNeedsApproval ? "needs-approval" : ""}`}
          onClick={onToggleAIAgent}
          title="Open AI Agent & Research Side Panel"
          aria-label="AI Agent"
        >
          <div className="ai-agent-icon-wrap">
            {isAgentRunning ? (
              <span className="ai-pulse-dot" />
            ) : (
              <AgentIcon size={20} />
            )}
          </div>
          <span className="sidebar-label">AI Agent</span>
          {agentNeedsApproval && <span className="approval-badge-dot" />}
        </button>
      </div>
    </aside>
  );
}
