import React, { useState } from "react";
import type { HistoryEntry } from "../../types/browser";
import { GlobeIcon, HistoryIcon, SearchIcon, TrashIcon, XIcon } from "../Icons";

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryEntry[];
  onNavigate: (url: string) => void;
  onClearHistory: () => void;
}

export function HistoryModal({
  isOpen,
  onClose,
  history,
  onNavigate,
  onClearHistory,
}: HistoryModalProps) {
  const [filter, setFilter] = useState("");

  if (!isOpen) return null;

  const filtered = history.filter(
    (h) =>
      h.title.toLowerCase().includes(filter.toLowerCase()) ||
      h.url.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card history-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <HistoryIcon size={20} className="text-glow-purple" />
            <h2 className="modal-title">Browsing History</h2>
            <span className="history-count-badge">{history.length} records</span>
          </div>
          <button type="button" className="btn-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="history-filter-row">
          <div className="history-search-wrap">
            <SearchIcon size={16} className="history-search-icon" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search history by title or URL..."
              className="history-filter-input"
              autoFocus
            />
          </div>
          {history.length > 0 && (
            <button
              type="button"
              className="btn-danger-outline"
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all browsing history?")) {
                  onClearHistory();
                }
              }}
            >
              <TrashIcon size={14} /> Clear History
            </button>
          )}
        </div>

        <div className="history-modal-body">
          {filtered.length === 0 ? (
            <div className="history-empty-state">
              <HistoryIcon size={36} className="empty-icon" />
              <p>{filter ? "No history entries match your search." : "No browsing history recorded yet."}</p>
            </div>
          ) : (
            <div className="history-items-scroll">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="history-entry-row"
                  onClick={() => {
                    onNavigate(item.url);
                    onClose();
                  }}
                >
                  <GlobeIcon size={18} className="entry-icon" />
                  <div className="entry-meta">
                    <span className="entry-title">{item.title}</span>
                    <span className="entry-url">{item.url}</span>
                  </div>
                  <span className="entry-date">
                    {new Date(item.visitedAt).toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
                    {new Date(item.visitedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
