import { useRef, useState } from "react";
import type { RunSnapshot } from "../../../src/server/agent/types";
import { ClockIcon, HistoryIcon } from "./Icons";

interface LogLine {
  key: string;
  type: string;
  message: string;
  time: string;
}

interface EventLogProps {
  log: LogLine[];
  run: RunSnapshot | null;
}

export function EventLog({ log, run }: EventLogProps) {
  const [filter, setFilter] = useState<string>("all");
  const logContainerRef = useRef<HTMLDivElement>(null);

  const filteredLog = log.filter((l) => {
    if (filter === "all") return true;
    if (filter === "step") return l.type.startsWith("step:");
    if (filter === "run") return l.type.startsWith("run:");
    return true;
  });

  return (
    <div className="event-history-view" aria-label="Run History and Live Event Stream">
      <div className="section-header-box">
        <div className="header-icon-box">
          <HistoryIcon size={24} />
        </div>
        <div className="header-title-wrap">
          <div className="title-row">
            <h2 className="view-title">Real-Time Event Stream</h2>
            <span className="badge badge-indigo">{log.length} Events Captured</span>
          </div>
          <p className="view-desc">
            Direct Server-Sent Events (SSE) stream from the execution controller. Events are ordered by monotonic sequence numbers.
          </p>
        </div>
      </div>

      {run && (
        <div className="glass-card run-meta-mini-card">
          <div className="meta-col">
            <span className="lbl">Active Run ID:</span>
            <code>{run.runId}</code>
          </div>
          <div className="meta-col">
            <span className="lbl">Current Status:</span>
            <span className="status-highlight">{run.status.replace(/_/g, " ")}</span>
          </div>
          <div className="meta-col">
            <span className="lbl">Completed Steps:</span>
            <span>
              {run.steps.filter((s) => s.status === "completed").length} / {run.steps.length}
            </span>
          </div>
        </div>
      )}

      <div className="glass-card terminal-card">
        <div className="terminal-header">
          <div className="terminal-controls">
            <span className="term-dot red" />
            <span className="term-dot yellow" />
            <span className="term-dot green" />
            <span className="terminal-title">live-controller.log</span>
          </div>

          <div className="terminal-filter-tabs">
            <button
              type="button"
              className={`filter-tab ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All Events
            </button>
            <button
              type="button"
              className={`filter-tab ${filter === "step" ? "active" : ""}`}
              onClick={() => setFilter("step")}
            >
              Step Events
            </button>
            <button
              type="button"
              className={`filter-tab ${filter === "run" ? "active" : ""}`}
              onClick={() => setFilter("run")}
            >
              Run Status
            </button>
          </div>
        </div>

        <div className="terminal-body" ref={logContainerRef}>
          {filteredLog.length === 0 ? (
            <div className="terminal-empty">
              <ClockIcon size={20} />
              <span>No events recorded yet. Start a research mission or demo run to stream live events.</span>
            </div>
          ) : (
            <ol className="log-entries-list">
              {filteredLog.map((e) => (
                <li key={e.key} className={`log-row type-${e.type.replace(/[:.]/g, "-")}`}>
                  <time className="log-timestamp">
                    {new Date(e.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <span className="log-type-tag">[{e.type}]</span>
                  <span className="log-message">{e.message}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
