import { AgentIcon, DownloadIcon, GlobeIcon, HistoryIcon, HomeIcon, InstagramIcon, SettingsIcon } from "./Icons";

export type NavTab = "home" | "browser" | "agent" | "social" | "history" | "downloads" | "settings";

interface NavigationRailProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  isRunning?: boolean;
  needsApproval?: boolean;
}

export function NavigationRail({
  activeTab,
  onTabChange,
  isRunning = false,
  needsApproval = false,
}: NavigationRailProps) {
  return (
    <aside className="nav-rail" aria-label="Main Navigation">
      <div className="nav-rail-top">
        <button
          type="button"
          className={`nav-item ${activeTab === "home" ? "active" : ""}`}
          onClick={() => onTabChange("home")}
          title="Home Dashboard"
          aria-label="Home Dashboard"
          aria-current={activeTab === "home" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <HomeIcon size={20} />
          </div>
          <span className="nav-label">Home</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === "browser" ? "active" : ""}`}
          onClick={() => onTabChange("browser")}
          title="Native Web Browser"
          aria-label="Web Browser"
          aria-current={activeTab === "browser" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <GlobeIcon size={20} />
          </div>
          <span className="nav-label">Browser</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === "social" ? "active" : ""}`}
          onClick={() => onTabChange("social")}
          title="Social Media Autopilot (Draft & Preview)"
          aria-label="Social Autopilot"
          aria-current={activeTab === "social" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <InstagramIcon size={20} />
          </div>
          <span className="nav-label">Social</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === "history" ? "active" : ""}`}
          onClick={() => onTabChange("history")}
          title="Run History & Event Log"
          aria-label="Run History"
          aria-current={activeTab === "history" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <HistoryIcon size={20} />
          </div>
          <span className="nav-label">History</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === "downloads" ? "active" : ""}`}
          onClick={() => onTabChange("downloads")}
          title="Downloads & Reports"
          aria-label="Downloads"
          aria-current={activeTab === "downloads" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <DownloadIcon size={20} />
          </div>
          <span className="nav-label">Downloads</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => onTabChange("settings")}
          title="System Settings & Status"
          aria-label="Settings"
          aria-current={activeTab === "settings" ? "page" : undefined}
        >
          <div className="nav-icon-box">
            <SettingsIcon size={20} />
          </div>
          <span className="nav-label">Settings</span>
        </button>
      </div>

      <div className="nav-rail-bottom">
        <button
          type="button"
          className={`nav-agent-card ${activeTab === "agent" ? "active" : ""} ${isRunning ? "running" : ""} ${needsApproval ? "approval-needed" : ""}`}
          onClick={() => onTabChange("agent")}
          title="AI Agent Workspace"
          aria-label="AI Agent Workspace"
          aria-current={activeTab === "agent" ? "page" : undefined}
        >
          <div className="nav-agent-glow" />
          <div className="nav-agent-icon-wrap">
            <AgentIcon size={24} />
            {isRunning && <span className="agent-pulse-dot" />}
            {needsApproval && <span className="agent-alert-badge" title="Approval required">!</span>}
          </div>
          <span className="nav-agent-label">AI Agent</span>
        </button>
      </div>
    </aside>
  );
}
