import React, { useState } from "react";
import type { Bookmark } from "../../types/browser";
import { BookmarkIcon, GlobeIcon, SearchIcon, TrashIcon, XIcon } from "../Icons";

interface BookmarksModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onNavigate: (url: string) => void;
  onRemoveBookmark: (id: string) => void;
}

export function BookmarksModal({
  isOpen,
  onClose,
  bookmarks,
  onNavigate,
  onRemoveBookmark,
}: BookmarksModalProps) {
  const [filter, setFilter] = useState("");

  if (!isOpen) return null;

  const filtered = bookmarks.filter(
    (b) =>
      b.title.toLowerCase().includes(filter.toLowerCase()) ||
      b.url.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card bookmarks-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <BookmarkIcon size={20} className="text-glow-purple" />
            <h2 className="modal-title">Saved Bookmarks</h2>
            <span className="count-badge">{bookmarks.length} saved</span>
          </div>
          <button type="button" className="btn-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="modal-filter-row">
          <div className="modal-search-wrap">
            <SearchIcon size={16} className="modal-search-icon" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search bookmarks..."
              className="modal-search-input"
              autoFocus
            />
          </div>
        </div>

        <div className="modal-list-body">
          {filtered.length === 0 ? (
            <div className="modal-empty-state">
              <p>No bookmarks found.</p>
            </div>
          ) : (
            <div className="bookmarks-list">
              {filtered.map((bm) => (
                <div key={bm.id} className="bookmark-row-item">
                  <button
                    type="button"
                    className="bookmark-row-main"
                    onClick={() => {
                      onNavigate(bm.url);
                      onClose();
                    }}
                    title={bm.url}
                  >
                    <GlobeIcon size={16} className="bm-icon" />
                    <div className="bm-text-info">
                      <span className="bm-title">{bm.title}</span>
                      <span className="bm-url">{bm.url}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="btn-delete-item"
                    onClick={() => onRemoveBookmark(bm.id)}
                    title="Remove bookmark"
                    aria-label="Remove"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
