import React, { useState } from "react";
import type { ApproveDraftRequest, ApprovedDraftRecord } from "../../../../src/server/social/types";
import { AlertTriangleIcon, CheckCircleIcon, ShieldIcon, SparklesIcon } from "../Icons";
import type { SelectedMedia } from "./ImagePicker";

interface ApprovalGateProps {
  selectedImage: SelectedMedia | null;
  caption: string;
  hashtags: string[];
  callToAction?: string;
  approvedRecord: ApprovedDraftRecord | null;
  onDraftApproved: (record: ApprovedDraftRecord) => void;
  onOpenMockPublish?: () => void;
  mockPublishingEnabled?: boolean;
}

export function ApprovalGate({
  selectedImage,
  caption,
  hashtags,
  callToAction,
  approvedRecord,
  onDraftApproved,
  onOpenMockPublish,
  mockPublishingEnabled = true,
}: ApprovalGateProps) {
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const hasImage = !!selectedImage;
  const hasCaption = !!caption.trim();
  const canApprove = hasImage && hasCaption && ownershipConfirmed && !approving;

  const handleApprove = async () => {
    if (!selectedImage || !caption.trim() || !ownershipConfirmed) {
      return;
    }

    setApproving(true);
    setApprovalError(null);

    const reqBody: ApproveDraftRequest = {
      image: {
        fileName: selectedImage.fileName,
        mimeType: selectedImage.mimeType,
        fileSize: selectedImage.fileSize,
        source: selectedImage.source,
        driveFileId: selectedImage.driveFileId,
      },
      caption: caption.trim(),
      hashtags,
      callToAction: callToAction?.trim() || undefined,
      ownershipConfirmed: true,
    };

    try {
      const res = await fetch("/api/social/approve-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onDraftApproved(data as ApprovedDraftRecord);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Failed to record draft approval");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="glass-card social-card approval-gate-card">
      <div className="social-card-header">
        <div className="social-card-title-wrap">
          <ShieldIcon size={20} className="social-accent-icon" />
          <h3 className="social-card-title">3. Human Review &amp; Safety Approval</h3>
        </div>
        <span className="social-card-badge">Policy Gate</span>
      </div>

      <p className="social-card-desc">
        AdaL-Nexus enforces human approval before any social media content is finalized. Verify your visual asset, copy, and copyright ownership.
      </p>

      {/* Pre-flight Checklist */}
      <div className="approval-checklist">
        <div className={`checklist-item ${hasImage ? "item-ok" : "item-pending"}`}>
          <div className="check-icon-circle">
            {hasImage ? <CheckCircleIcon size={16} /> : <span className="check-blank" />}
          </div>
          <div className="checklist-text">
            <span className="check-title">Visual Asset Attached</span>
            <span className="check-sub">
              {hasImage ? `${selectedImage?.fileName} (${selectedImage?.mimeType})` : "Please upload or select an image above"}
            </span>
          </div>
        </div>

        <div className={`checklist-item ${hasCaption ? "item-ok" : "item-pending"}`}>
          <div className="check-icon-circle">
            {hasCaption ? <CheckCircleIcon size={16} /> : <span className="check-blank" />}
          </div>
          <div className="checklist-text">
            <span className="check-title">Caption &amp; Copy Drafted</span>
            <span className="check-sub">
              {hasCaption ? `${caption.length} characters • ${hashtags.length} hashtags` : "Please generate or write a caption"}
            </span>
          </div>
        </div>
      </div>

      {/* Ownership Confirmation Checkbox */}
      <div className="ownership-confirm-box">
        <label className="checkbox-label" htmlFor="ownership-checkbox">
          <input
            id="ownership-checkbox"
            type="checkbox"
            className="custom-checkbox"
            checked={ownershipConfirmed}
            onChange={(e) => setOwnershipConfirmed(e.target.checked)}
          />
          <span className="checkbox-text">
            I confirm that I own or hold valid commercial rights to the visual asset and text content, and that this post adheres to Instagram community guidelines.
          </span>
        </label>
      </div>

      {approvalError && (
        <div className="social-error-banner" role="alert">
          <AlertTriangleIcon size={16} />
          <span>{approvalError}</span>
        </div>
      )}

      {/* Approve Button */}
      {!approvedRecord ? (
        <div className="approval-action-row">
          <button
            type="button"
            className="action-btn primary-btn approve-draft-btn"
            onClick={handleApprove}
            disabled={!canApprove}
          >
            {approving ? (
              <>
                <span className="spinner-border" />
                <span>Securing Approval...</span>
              </>
            ) : (
              <>
                <CheckCircleIcon size={18} />
                <span>Approve Safe Draft</span>
              </>
            )}
          </button>
          {!canApprove && !ownershipConfirmed && hasImage && hasCaption && (
            <span className="approval-hint-text">
              Check the ownership confirmation box to enable approval
            </span>
          )}
        </div>
      ) : (
        <div className="approved-record-card">
          <div className="approved-record-header">
            <div className="approved-badge">
              <CheckCircleIcon size={18} />
              <span>Draft Approved &amp; Logged</span>
            </div>
            <span className="approved-time">
              {new Date(approvedRecord.approvedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="approved-details">
            <div className="detail-row">
              <span className="detail-label">Draft ID:</span>
              <code className="detail-code">{approvedRecord.id}</code>
            </div>
            <div className="detail-row">
              <span className="detail-label">Asset Source:</span>
              <span className="detail-val">
                {approvedRecord.image.source === "drive" ? "Google Drive" : "Local Upload"}
                {approvedRecord.image.driveFileId ? ` (${approvedRecord.image.driveFileId})` : ""}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Publishing Status:</span>
              {approvedRecord.publishingStatus === "succeeded_mock" ? (
                <span className="detail-val-success">
                  MOCK PUBLISHED — LOCAL SIMULATION
                </span>
              ) : (
                <span className="detail-val-warning">
                  Unavailable for Personal Account (Safe Draft Complete)
                </span>
              )}
            </div>
            {approvedRecord.latestAttemptId && (
              <div className="detail-row">
                <span className="detail-label">Latest Attempt:</span>
                <code className="detail-code">{approvedRecord.latestAttemptId}</code>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Next Step:</span>
              <span className="detail-val">
                {approvedRecord.publishingStatus === "succeeded_mock"
                  ? "Publish simulation complete. State verified in audit log & store."
                  : "Copy caption & hashtags from preview, or test mock publishing below."}
              </span>
            </div>
          </div>

          {/* Phase 3A: Mock Publishing Action or Success Card */}
          {approvedRecord.publishingStatus === "succeeded_mock" ? (
            <div className="mock-published-banner">
              <div className="mock-published-header">
                <CheckCircleIcon size={16} className="text-emerald-400" />
                <span className="mock-published-title">Mock Publishing Succeeded</span>
              </div>
              <p className="mock-published-desc">
                Simulated local post registered. No live post was created on Instagram.
              </p>
              <div className="mock-permalink-row">
                <span className="mock-permalink-label">Internal Mock URI:</span>
                <code className="mock-permalink">
                  mock://instagram/p/mock-{approvedRecord.latestAttemptId?.replace(/^mock_att_/, "").slice(0, 8) || "simulated"}
                </code>
              </div>
            </div>
          ) : (
            mockPublishingEnabled && onOpenMockPublish && (
              <div className="mock-publish-action-box">
                <div className="mock-publish-intro">
                  <span className="mock-publish-title">Phase 3A: Safe Mock Publishing</span>
                  <span className="mock-publish-desc">
                    Test publishing state transitions, audit logging, and persistence locally with zero external network calls.
                  </span>
                </div>
                <button
                  type="button"
                  className="action-btn mock-publish-trigger-btn"
                  onClick={onOpenMockPublish}
                >
                  <SparklesIcon size={16} />
                  <span>Simulate Publishing (Mock Mode)</span>
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
