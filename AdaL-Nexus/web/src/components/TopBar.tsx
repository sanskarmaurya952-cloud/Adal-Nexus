import { useEffect, useState } from "react";
import { MoonIcon, PencilIcon, SparklesIcon, SunIcon } from "./Icons";

interface Health {
  ok: boolean;
  time: string;
  llm: { provider: string; model?: string | null; configured: boolean };
  browser?: { launched: boolean; url: string | null };
}

interface TopBarProps {
  health: Health | null;
  healthError: string | null;
  connected: boolean;
  onOpenSettings: () => void;
  backgroundDimmed: boolean;
  onToggleBackgroundDim: () => void;
}

export function TopBar({
  health,
  healthError,
  connected,
  onOpenSettings,
  backgroundDimmed,
  onToggleBackgroundDim,
}: TopBarProps) {
  const [timeStr, setTimeStr] = useState<string>("");
  const [greeting, setGreeting] = useState<{ text: string; isDay: boolean }>({
    text: "Welcome!",
    isDay: true,
  });

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
      const hour = now.getHours();
      if (hour >= 5 && hour < 12) {
        setGreeting({ text: "Good Morning!", isDay: true });
      } else if (hour >= 12 && hour < 18) {
        setGreeting({ text: "Good Afternoon!", isDay: true });
      } else {
        setGreeting({ text: "Good Evening!", isDay: false });
      }
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="topbar" aria-label="Dashboard Header">
      <div className="topbar-left">
        <div className="status-pills">
          <span
            className={`status-pill ${health?.ok ? "pill-ok" : "pill-bad"}`}
            title={health?.ok ? "Server is online" : healthError ?? "Checking server connection"}
          >
            <span className="status-dot" />
            <span className="status-text">Server: {health?.ok ? "Online" : "Offline"}</span>
          </span>

          <span
            className={`status-pill ${connected ? "pill-ok" : "pill-warn"}`}
            title={connected ? "Real-time SSE event stream connected" : "Connecting to event stream"}
          >
            <span className="status-dot" />
            <span className="status-text">Events: {connected ? "Connected" : "Reconnecting"}</span>
          </span>

          <span
            className={`status-pill ${health?.llm.configured ? "pill-violet" : "pill-warn"}`}
            title={
              health?.llm.configured
                ? `LLM: ${health.llm.provider} (${health.llm.model ?? "default"})`
                : "LLM key not configured in .env"
            }
          >
            <SparklesIcon size={13} />
            <span className="status-text">
              {health?.llm.configured
                ? health.llm.model ?? health.llm.provider
                : "LLM Not Configured"}
            </span>
          </span>

          {health?.browser?.launched && (
            <span
              className="status-pill pill-cyan"
              title={`Visible Chrome browser open: ${health.browser.url ?? "navigating"}`}
            >
              <span className="status-dot pulse" />
              <span className="status-text">Browser Active</span>
            </span>
          )}
        </div>
      </div>

      <div className="topbar-right">
        <div className="clock-widget">
          <span className="clock-time">{timeStr || "--:--"}</span>
          <span className="clock-greeting">
            {greeting.text}{" "}
            {greeting.isDay ? <SunIcon size={14} className="sun-icon" /> : <MoonIcon size={14} className="moon-icon" />}
          </span>
        </div>

        <button
          type="button"
          className="customize-btn"
          onClick={onToggleBackgroundDim}
          title={backgroundDimmed ? "Atmospheric Brightness: High" : "Atmospheric Brightness: Normal"}
          aria-label="Toggle atmospheric lighting"
        >
          <PencilIcon size={14} />
          <span>Atmosphere</span>
        </button>
      </div>
    </header>
  );
}
