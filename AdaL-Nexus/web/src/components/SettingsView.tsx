import { CheckCircleIcon, SettingsIcon, ShieldIcon, SparklesIcon, XCircleIcon } from "./Icons";

interface Health {
  ok: boolean;
  time: string;
  llm: { provider: string; model?: string | null; configured: boolean };
  browser?: { launched: boolean; url: string | null };
}

interface SettingsViewProps {
  health: Health | null;
  healthError: string | null;
  connected: boolean;
  backgroundDimmed: boolean;
  onToggleBackgroundDim: () => void;
}

export function SettingsView({
  health,
  healthError,
  connected,
  backgroundDimmed,
  onToggleBackgroundDim,
}: SettingsViewProps) {
  return (
    <div className="settings-view" aria-label="System Diagnostics and Settings">
      <div className="settings-intro-banner">
        <div className="settings-intro-icon-box">
          <SettingsIcon size={20} />
        </div>
        <div className="settings-intro-content">
          <h3 className="settings-intro-title">System Diagnostics &amp; Environment</h3>
          <p className="settings-intro-desc">
            Live infrastructure diagnostics for the AdaL-Nexus execution controller, Gemini planner, and browser engine.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        {/* Core Connectivity Card */}
        <section className="settings-card">
          <h3 className="card-subtitle">Server &amp; Event Stream</h3>
          <div className="diag-table">
            <div className="diag-row">
              <span className="diag-lbl">Express Server Status:</span>
              <span className="diag-val">
                {health?.ok ? (
                  <span className="badge badge-completed">
                    <CheckCircleIcon size={12} /> Online
                  </span>
                ) : (
                  <span className="badge badge-failed">
                    <XCircleIcon size={12} /> {healthError ?? "Offline"}
                  </span>
                )}
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">SSE Event Stream:</span>
              <span className="diag-val">
                {connected ? (
                  <span className="badge badge-completed">
                    <CheckCircleIcon size={12} /> Connected
                  </span>
                ) : (
                  <span className="badge badge-warn">Reconnecting</span>
                )}
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Server Timestamp:</span>
              <code className="diag-code">{health?.time ? new Date(health.time).toLocaleString() : "--"}</code>
            </div>
          </div>
        </section>

        {/* Gemini LLM Card */}
        <section className="settings-card">
          <h3 className="card-subtitle">LLM Provider Configuration</h3>
          <div className="diag-table">
            <div className="diag-row">
              <span className="diag-lbl">Provider:</span>
              <span className="diag-val font-semibold">{health?.llm.provider ?? "Gemini"}</span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Configured Model:</span>
              <code className="diag-code">{health?.llm.model ?? "gemini-3.1-flash-lite"}</code>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">API Key Status:</span>
              <span className="diag-val">
                {health?.llm.configured ? (
                  <span className="badge badge-completed">
                    <CheckCircleIcon size={12} /> Configured in .env
                  </span>
                ) : (
                  <span className="badge badge-warn">Missing in .env</span>
                )}
              </span>
            </div>
          </div>
        </section>

        {/* Browser Engine Card */}
        <section className="settings-card">
          <h3 className="card-subtitle">Browser Engine (Playwright)</h3>
          <div className="diag-table">
            <div className="diag-row">
              <span className="diag-lbl">Browser Status:</span>
              <span className="diag-val">
                {health?.browser?.launched ? (
                  <span className="badge badge-completed">
                    <span className="status-dot-pulse" /> Chrome Window Active
                  </span>
                ) : (
                  <span className="badge badge-neutral">Idle (Launches on Research)</span>
                )}
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Active Page URL:</span>
              <span className="diag-val url-val" title={health?.browser?.url ?? "None"}>
                {health?.browser?.url ?? "None"}
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Navigation Policy:</span>
              <span className="badge badge-indigo">Visible Window (Steerable)</span>
            </div>
          </div>
        </section>

        {/* Security & Sandboxing Card */}
        <section className="settings-card">
          <h3 className="card-subtitle">Security Controls &amp; Policies</h3>
          <div className="diag-table">
            <div className="diag-row">
              <span className="diag-lbl">URL Guard &amp; SSRF Shield:</span>
              <span className="badge badge-completed">
                <CheckCircleIcon size={12} /> Active (DNS Pre-flight)
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Filesystem Confinement:</span>
              <span className="badge badge-completed">
                <CheckCircleIcon size={12} /> Output Sandbox (output/)
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Prompt Injection Defense:</span>
              <span className="badge badge-completed">
                <CheckCircleIcon size={12} /> Pure Data Isolation
              </span>
            </div>

            <div className="diag-row">
              <span className="diag-lbl">Policy Engine Approvals:</span>
              <span className="badge badge-completed">
                <CheckCircleIcon size={12} /> Interactive Gate Enabled
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Visual Customization Card */}
      <section className="settings-card visual-settings-card">
        <div className="settings-toggle-row">
          <div>
            <h3 className="toggle-title">Theme &amp; Appearance</h3>
            <p className="toggle-desc">
              Toggle between clean Modern Light Theme and Cosmic Dark Mode across the browser shell.
            </p>
          </div>
          <button
            type="button"
            className="settings-toggle-btn"
            onClick={onToggleBackgroundDim}
          >
            <SparklesIcon size={15} />
            <span>Theme: {backgroundDimmed ? "Dark Mode" : "Light Mode"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
