import React, { useState } from "react";
import type { ApprovedDraftRecord, PublishingAttemptRecord } from "../../../../src/server/social/types";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InstagramIcon,
  ShieldIcon,
  SparklesIcon,
} from "../Icons";

interface MockPublishModalProps {
  draft: ApprovedDraftRecord;
  previewUrl?: string;
  onClose: () => void;
  onPublished: (attempt: PublishingAttemptRecord) => void;
}

export function MockPublishModal({
  draft,
  previewUrl,
  onClose,
  onPublished,
}: MockPublishModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSimulatePublish = async () => {
    if (!confirmed || submitting) return;

    setSubmitting(true);
    setError(null);

    const idempotencyKey = `client_pub_${draft.id}_${Date.now()}`;

    try {
      const res = await fetch("/api/social/publish-mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          confirmedPublish: true,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onPublished(data.attempt as PublishingAttemptRecord);
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Failed to simulate publishing");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card drive-modal mock-publish-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-publish-title"
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="modal-icon-badge mock-badge-icon">
              <InstagramIcon size={22} />
            </div>
            <div>
              <h2 id="mock-publish-title" className="modal-title">
                Simulate Instagram Publishing
              </h2>
              <span className="modal-subtitle">Phase 3A • Safe Local Simulation</span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        {/* Modal Content */}
        <div className="modal-body">
          {/* Prominent Mock Safeguard Notice */}
          <div className="mock-warning-banner" role="alert">
            <div className="mock-banner-header">
              <ShieldIcon size={18} className="shield-icon" />
              <strong>MOCK MODE — NO LIVE POST</strong>
            </div>
            <p className="mock-banner-text">
              Your account is classified as a <strong>Personal Instagram Account</strong> and is ineligible for direct Meta Graph API publishing.
              This simulated workflow validates state transitions, single-process mutex locking, durable persistence across restarts, and audit logging.
              <strong> Zero external network requests</strong> will be sent to Meta or any third-party service.
            </p>
          </div>

          {/* Draft Summary Card */}
          <div className="mock-draft-summary">
            <span className="summary-heading">Target Content to Simulate</span>
            <div className="summary-media-row">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={draft.image.fileName}
                  className="summary-thumb"
                />
              ) : (
                <div className="summary-thumb-placeholder">
                  <SparklesIcon size={20} />
                </div>
              )}
              <div className="summary-meta">
                <span className="summary-filename">{draft.image.fileName}</span>
                <span className="summary-source">
                  Source: {draft.image.source === "drive" ? "Google Drive" : "Local Upload"}
                  {draft.image.driveFileId ? ` (${draft.image.driveFileId})` : ""}
                </span>
                <p className="summary-caption-preview">
                  "{draft.caption.slice(0, 120)}
                  {draft.caption.length > 120 ? "..." : ""}"
                </p>
                <div className="summary-tags">
                  {draft.hashtags.slice(0, 4).map((tag, idx) => (
                    <span key={idx} className="summary-tag-pill">
                      {tag.startsWith("#") ? tag : `#${tag}`}
                    </span>
                  ))}
                  {draft.hashtags.length > 4 && (
                    <span className="summary-tag-more">+{draft.hashtags.length - 4} more</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Technical Safeguards List */}
          <div className="mock-technical-details">
            <div className="tech-item">
              <CheckCircleIcon size={14} className="tech-icon" />
              <span>Simulates 1,000 ms processing latency locally</span>
            </div>
            <div className="tech-item">
              <CheckCircleIcon size={14} className="tech-icon" />
              <span>Generates safe internal <code>mock://instagram/p/mock-...</code> reference</span>
            </div>
            <div className="tech-item">
              <CheckCircleIcon size={14} className="tech-icon" />
              <span>Records immutable audit trail to <code>data/social/audit.log</code></span>
            </div>
            <div className="tech-item">
              <CheckCircleIcon size={14} className="tech-icon" />
              <span>Persists attempt state atomically to <code>data/social/publishing_attempts/</code></span>
            </div>
          </div>

          {/* Mandatory User Confirmation Checkbox */}
          <div className="mock-confirm-box">
            <label className="checkbox-label" htmlFor="mock-confirm-checkbox">
              <input
                id="mock-confirm-checkbox"
                type="checkbox"
                className="custom-checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={submitting}
              />
              <span className="checkbox-text">
                I understand that this is a <strong>safe local simulation</strong> in mock mode. No post will be made on Instagram and no outbound network calls will be executed.
              </span>
            </label>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="social-error-banner" role="alert">
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="action-btn secondary-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="action-btn primary-btn mock-submit-btn"
            onClick={handleSimulatePublish}
            disabled={!confirmed || submitting}
          >
            {submitting ? (
              <>
                <span className="spinner-border" />
                <span>Simulating Publish (Processing 1.0s)...</span>
              </>
            ) : (
              <>
                <SparklesIcon size={18} />
                <span>Simulate Publish (Mock Mode)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
