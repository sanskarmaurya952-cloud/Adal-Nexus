import React, { useRef } from "react";
import { BoltIcon, SearchIcon, SparklesIcon } from "./Icons";

interface HeroSearchProps {
  task: string;
  onTaskChange: (val: string) => void;
  onGeneratePlan: () => void;
  onRunResearch: () => void;
  onRunDemo: () => void;
  isPlanning: boolean;
  isRunning: boolean;
  llmConfigured: boolean;
  planError: string | null;
  actionError: string | null;
}

export function HeroSearch({
  task,
  onTaskChange,
  onGeneratePlan,
  onRunResearch,
  onRunDemo,
  isPlanning,
  isRunning,
  llmConfigured,
  planError,
  actionError,
}: HeroSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!task.trim()) return;
      if (llmConfigured && !isPlanning && !isRunning) {
        onGeneratePlan();
      } else if (!isRunning) {
        onRunResearch();
      }
    }
  };

  const handleShortcut = (preset: string) => {
    onTaskChange(preset);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <section className="hero-search-section" aria-label="Research Search Hub">
      <div className="hero-branding">
        <h1 className="hero-title">
          AdaL <span className="title-gradient">Nexus</span>
        </h1>
        <p className="hero-subtitle">Your Intelligent Browser for a Smarter Web</p>
      </div>

      <div className="search-container">
        <div className={`search-pill ${isRunning ? "running-glow" : ""}`}>
          <div className="search-left-badge" title="AdaL Agent Search">
            <span className="search-brand-icon">
              <SparklesIcon size={16} />
            </span>
          </div>

          <input
            ref={inputRef}
            type="text"
            className="search-input"
            value={task}
            onChange={(e) => onTaskChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Research AI startups, compare pricing, and build an evidence-backed spreadsheet…"
            aria-label="Natural language research query"
            disabled={isPlanning}
          />

          {task.trim() && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onTaskChange("")}
              title="Clear query"
              aria-label="Clear query"
            >
              ×
            </button>
          )}

          <button
            type="button"
            className="search-submit-btn"
            disabled={!task.trim() || isPlanning || isRunning}
            onClick={llmConfigured ? onGeneratePlan : onRunResearch}
            title={
              llmConfigured
                ? "Generate AI research plan with Gemini"
                : "Run research workflow"
            }
            aria-label="Submit research task"
          >
            {isPlanning ? (
              <span className="spinner-icon" />
            ) : (
              <SearchIcon size={18} />
            )}
          </button>
        </div>

        <div className="search-actions-row">
          <button
            type="button"
            className="action-chip primary-chip"
            disabled={!llmConfigured || !task.trim() || isPlanning || isRunning}
            onClick={onGeneratePlan}
            title={
              llmConfigured
                ? "Draft structured multi-step plan using Gemini (review before execution)"
                : "LLM not configured in .env"
            }
          >
            <SparklesIcon size={15} />
            <span>{isPlanning ? "Drafting Plan…" : "Generate Plan (LLM)"}</span>
          </button>

          <button
            type="button"
            className="action-chip secondary-chip"
            disabled={isRunning}
            onClick={onRunResearch}
            title="Execute 5-step browser research & verified Excel workflow"
          >
            <BoltIcon size={15} />
            <span>Fast Research Run</span>
          </button>

          <button
            type="button"
            className="action-chip ghost-chip"
            disabled={isRunning}
            onClick={onRunDemo}
            title="Safe controller test using system tools only (no web requests)"
          >
            <span>Controller Demo</span>
          </button>
        </div>

        {planError && (
          <div className="search-alert error-alert" role="alert">
            <strong>Plan Error:</strong> {planError}
          </div>
        )}

        {actionError && (
          <div className="search-alert error-alert" role="alert">
            <strong>Execution Error:</strong> {actionError}
          </div>
        )}

        {!llmConfigured && (
          <div className="search-alert info-alert">
            <SparklesIcon size={14} />
            <span>
              Gemini LLM is unconfigured. Fast Research Run and Controller Demo operate deterministically; add <code>GEMINI_API_KEY</code> to <code>.env</code> to enable AI plan drafting.
            </span>
          </div>
        )}
      </div>

      <div className="shortcuts-row" aria-label="Quick preset shortcuts">
        <button
          type="button"
          className="shortcut-item"
          onClick={() =>
            handleShortcut(
              "Research 5 AI startups, extract product details and pricing plans, and export verified Excel"
            )
          }
        >
          <div className="shortcut-icon-circle gradient-purple">
            <span>AI</span>
          </div>
          <span className="shortcut-label">AI Startups</span>
        </button>

        <button
          type="button"
          className="shortcut-item"
          onClick={() =>
            handleShortcut(
              "Compare AI voice and speech synthesis startups, analyze self-serve pricing tiers, and build workbook"
            )
          }
        >
          <div className="shortcut-icon-circle gradient-cyan">
            <span>🎙️</span>
          </div>
          <span className="shortcut-label">Voice AI</span>
        </button>

        <button
          type="button"
          className="shortcut-item"
          onClick={() =>
            handleShortcut(
              "Research developer AI model API providers, verify token pricing, and generate spreadsheet"
            )
          }
        >
          <div className="shortcut-icon-circle gradient-emerald">
            <span>⚡</span>
          </div>
          <span className="shortcut-label">Dev APIs</span>
        </button>

        <button
          type="button"
          className="shortcut-item"
          onClick={() =>
            handleShortcut(
              "Research enterprise AI agent platforms for customer workflow automation and extract pricing"
            )
          }
        >
          <div className="shortcut-icon-circle gradient-amber">
            <span>🏢</span>
          </div>
          <span className="shortcut-label">Enterprise</span>
        </button>

        <button
          type="button"
          className="shortcut-item"
          onClick={onRunDemo}
          disabled={isRunning}
        >
          <div className="shortcut-icon-circle gradient-violet">
            <span>⚙️</span>
          </div>
          <span className="shortcut-label">System Demo</span>
        </button>
      </div>
    </section>
  );
}
