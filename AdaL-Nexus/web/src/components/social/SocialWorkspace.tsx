import React, { useEffect, useState } from "react";
import type {
  ApprovedDraftRecord,
  CaptionAlternative,
  GenerateCaptionResponse,
  MultiPlatformIntegrationStatus,
  PublishingAttemptRecord,
} from "../../../../src/server/social/types";
import {
  AlertTriangleIcon,
  DriveIcon,
  InstagramIcon,
  LinkedInIcon,
  RefreshIcon,
  ShieldIcon,
  SparklesIcon,
  XTwitterIcon,
} from "../Icons";
import { ApprovalGate } from "./ApprovalGate";
import { CaptionEditor } from "./CaptionEditor";
import { DriveSetupModal } from "./DriveSetupModal";
import { googleDriveService } from "./googleDriveService";
import { ImagePicker, type SelectedMedia } from "./ImagePicker";
import { MockPublishModal } from "./MockPublishModal";
import { MultiPlatformPreview } from "./MultiPlatformPreview";
import { SocialDemoMode } from "./SocialDemoMode";
import { getApiUrl } from "../../api";

export function SocialWorkspace() {
  const [workspaceMode, setWorkspaceMode] = useState<"demo" | "live">("demo");
  const [status, setStatus] = useState<MultiPlatformIntegrationStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showDriveSetup, setShowDriveSetup] = useState(false);
  const [showMockPublish, setShowMockPublish] = useState(false);
  const [latestAttempt, setLatestAttempt] = useState<PublishingAttemptRecord | null>(null);
  const [isConnectingLinkedIn, setIsConnectingLinkedIn] = useState(false);

  // Draft state
  const [selectedImage, setSelectedImage] = useState<SelectedMedia | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [callToAction, setCallToAction] = useState<string>("");
  const [alternatives, setAlternatives] = useState<CaptionAlternative[]>([]);
  const [approvedRecord, setApprovedRecord] = useState<ApprovedDraftRecord | null>(null);

  const fetchStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      // First try platform-status
      const res = await fetch(getApiUrl("/api/social/platform-status"));
      if (res.ok) {
        const data = await res.json();
        setStatus(data as MultiPlatformIntegrationStatus);
      } else {
        // Fallback to legacy status endpoint
        const fallbackRes = await fetch(getApiUrl("/api/social/status"));
        if (!fallbackRes.ok) throw new Error(`HTTP ${fallbackRes.status}`);
        const fallbackData = await fallbackRes.json();
        setStatus({
          drive: fallbackData.drive,
          instagram: fallbackData.instagram,
          linkedin: {
            connected: false,
            publishingEligible: false,
            hasToken: false,
            publishingMode: "disabled",
            message: "LinkedIn API is not connected. Connect via OAuth or configure LINKEDIN_ACCESS_TOKEN.",
            requirements: ["LinkedIn Developer Portal Application", "OAuth 2.0 with w_member_social scope"],
          },
          twitter: {
            connected: false,
            publishingEligible: false,
            publishingMode: "disabled",
            message: "X API v2 credentials unconfigured. Posts simulated locally in mock sandbox.",
            requirements: ["X Developer Portal Project & App", "TWITTER_API_KEY and TWITTER_ACCESS_TOKEN in .env"],
          },
        });
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to load integration status");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnectLinkedIn = async () => {
    setIsConnectingLinkedIn(true);
    try {
      const res = await fetch(getApiUrl("/api/social/linkedin/auth-url"));
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.url) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        window.open(
          data.url,
          "LinkedInOAuth",
          `width=${width},height=${height},left=${left},top=${top},status=yes,scrollbars=yes`,
        );

        const handleMessage = (e: MessageEvent) => {
          if (e.data?.type === "LINKEDIN_AUTH_SUCCESS") {
            window.removeEventListener("message", handleMessage);
            fetchStatus();
          }
        };
        window.addEventListener("message", handleMessage);
      }
    } catch (err: any) {
      alert(
        `LinkedIn Developer Connection:\n\n${err.message || "Failed to initiate OAuth"}\n\nTo connect LinkedIn:\n1. Create a LinkedIn App at developer.linkedin.com\n2. Add products: "Share on LinkedIn" & "Sign In with LinkedIn"\n3. Set LINKEDIN_CLIENT_ID & LINKEDIN_CLIENT_SECRET in .env\n(Or set LINKEDIN_ACCESS_TOKEN directly in .env)`,
      );
    } finally {
      setIsConnectingLinkedIn(false);
    }
  };

  const handleDisconnectLinkedIn = async () => {
    if (!confirm("Are you sure you want to disconnect your LinkedIn account?")) return;
    try {
      await fetch(getApiUrl("/api/social/linkedin/disconnect"), { method: "DELETE" });
      fetchStatus();
    } catch (err: any) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  };

  const isDriveConfigured = googleDriveService.isConfigured() || Boolean(status?.drive.configured);
  const isMockProvider = status?.instagram.publishingMode === "mock";

  const handleCaptionGenerated = (_resp: GenerateCaptionResponse) => {
    setApprovedRecord(null);
    setLatestAttempt(null);
  };

  const handleImageSelect = (img: SelectedMedia | null) => {
    setSelectedImage(img);
    setApprovedRecord(null);
    setLatestAttempt(null);
  };

  const handleCaptionChange = (newCaption: string) => {
    setCaption(newCaption);
    setApprovedRecord(null);
    setLatestAttempt(null);
  };

  const handleHashtagsChange = (newTags: string[]) => {
    setHashtags(newTags);
    setApprovedRecord(null);
    setLatestAttempt(null);
  };

  const handleDraftApproved = (record: ApprovedDraftRecord) => {
    setApprovedRecord(record);
    setLatestAttempt(null);
  };

  const handleMockPublished = (attempt: PublishingAttemptRecord) => {
    setLatestAttempt(attempt);
    setApprovedRecord((prev) =>
      prev
        ? {
            ...prev,
            publishingStatus: "succeeded_mock",
            latestAttemptId: attempt.attemptId,
          }
        : null
    );
  };

  return (
    <div className="social-workspace-container">
      {/* Top Header & Integration Status Bar */}
      <div className="social-workspace-header">
        <div className="social-header-title-box">
          <div className="social-header-badges-row">
            <div className="social-header-badge">
              <SparklesIcon size={16} />
              <span>Phase 3: Autonomous Multi-Platform Social Studio</span>
            </div>
            <div className="social-mock-pill">
              <ShieldIcon size={14} />
              <span>SAFE GUARDED &bull; APPROVAL GATED</span>
            </div>
          </div>
          <h1 className="social-main-title">Social Media Autopilot</h1>
          <p className="social-main-subtitle">
            Upload local images or select visual assets, generate multi-platform captions with Gemini, preview cards for LinkedIn, X, and Instagram, and execute approved posts safely with desktop browser automation.
          </p>
        </div>

        {/* Integration Status Badges */}
        <div className="social-integrations-bar">
          {/* LinkedIn Account Status */}
          <div className="integration-status-card li-status-card">
            <div className="int-card-icon">
              <LinkedInIcon size={22} />
            </div>
            <div className="int-card-body">
              <div className="int-title-row">
                <span className="int-title">LinkedIn</span>
                <span className={`int-pill ${status?.linkedin.connected ? "success-pill" : "muted-pill"}`}>
                  {status?.linkedin.connected ? "Official API Connected" : "API Unconfigured"}
                </span>
              </div>
              <span className="int-desc">
                {status?.linkedin.connected
                  ? `Authenticated as ${status.linkedin.accountName || "Member"} (${status.linkedin.memberUrn || "Posts API active"}). Official Posts API publishing enabled.`
                  : "Official Posts API requires OAuth authorization (w_member_social scope) or LINKEDIN_ACCESS_TOKEN in .env."}
              </span>
            </div>
            {status?.linkedin.connected ? (
              <button
                type="button"
                className="int-action-btn disconnect-btn"
                onClick={handleDisconnectLinkedIn}
                title="Disconnect LinkedIn account"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="int-action-btn"
                onClick={handleConnectLinkedIn}
                disabled={isConnectingLinkedIn}
                title="Connect with LinkedIn via Official OAuth 2.0"
              >
                {isConnectingLinkedIn ? "Connecting..." : "Connect API"}
              </button>
            )}
          </div>

          {/* X (Twitter) Account Status */}
          <div className="integration-status-card tw-status-card">
            <div className="int-card-icon">
              <XTwitterIcon size={20} />
            </div>
            <div className="int-card-body">
              <div className="int-title-row">
                <span className="int-title">X (Twitter)</span>
                <span className="int-pill warning-pill">API Unconfigured (Mock Only)</span>
              </div>
              <span className="int-desc">
                Character Limit: 280 strictly enforced &bull; API v2 credentials not configured. Posts simulated locally in safe mock sandbox.
              </span>
            </div>
          </div>

          {/* Instagram Account Status */}
          <div className="integration-status-card ig-status-card">
            <div className="int-card-icon">
              <InstagramIcon size={22} />
            </div>
            <div className="int-card-body">
              <div className="int-title-row">
                <span className="int-title">Instagram</span>
                <span className="int-pill warning-pill">Personal Account</span>
                {isMockProvider && (
                  <span className="int-pill mock-active-pill">Mock Sandbox Active</span>
                )}
              </div>
              <span className="int-desc">
                {status?.instagram.accountHandle
                  ? (status.instagram.accountHandle.startsWith("@") ? status.instagram.accountHandle : `@${status.instagram.accountHandle}`)
                  : "@adal.nexus"}
                {" • "}
                <span className="int-highlight">Direct API Ineligible</span> (Requires Meta Professional Account). Safe mock simulation active.
              </span>
            </div>
          </div>

          {/* Google Drive Status */}
          <div className="integration-status-card drive-status-card">
            <div className="int-card-icon">
              <DriveIcon size={22} />
            </div>
            <div className="int-card-body">
              <div className="int-title-row">
                <span className="int-title">Google Drive</span>
                <span className={`int-pill ${isDriveConfigured ? "success-pill" : "muted-pill"}`}>
                  {isDriveConfigured ? "Ready / Configured" : "Not Configured"}
                </span>
              </div>
              <span className="int-desc">
                {isDriveConfigured
                  ? "Google Identity Services & Web Picker active"
                  : "Client ID required for cloud media picking"}
              </span>
            </div>
            <button
              type="button"
              className="int-action-btn"
              onClick={() => setShowDriveSetup(true)}
              title="View Google Drive setup guide"
            >
              Setup Guide
            </button>
          </div>
        </div>
      </div>

      {/* Presentation Mode Switcher */}
      <div className="social-workspace-mode-selector">
        <button
          type="button"
          className={`workspace-mode-tab ${workspaceMode === "demo" ? "active" : ""}`}
          onClick={() => setWorkspaceMode("demo")}
        >
          ✨ DEMO MODE (Presentation Sandbox)
        </button>
        <button
          type="button"
          className={`workspace-mode-tab ${workspaceMode === "live" ? "active" : ""}`}
          onClick={() => setWorkspaceMode("live")}
        >
          ⚙️ Live API Integrations
        </button>
      </div>

      {workspaceMode === "demo" ? (
        <SocialDemoMode />
      ) : (
        <>
          {statusError && (
            <div className="social-error-banner" role="alert">
              <AlertTriangleIcon size={16} />
              <span>Integration status check error: {statusError}</span>
              <button type="button" className="retry-mini-btn" onClick={fetchStatus}>
                <RefreshIcon size={12} />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Main Two-Column Workspace Layout */}
          <div className="social-workspace-grid">
            {/* Left Column: Input, Generation, Approval */}
            <div className="social-editor-column">
              <ImagePicker
                selectedImage={selectedImage}
                onImageSelect={handleImageSelect}
                driveStatus={status?.drive ?? null}
                onOpenDriveSetup={() => setShowDriveSetup(true)}
              />

              <CaptionEditor
                caption={caption}
                onCaptionChange={handleCaptionChange}
                hashtags={hashtags}
                onHashtagsChange={handleHashtagsChange}
                callToAction={callToAction}
                onCallToActionChange={setCallToAction}
                alternatives={alternatives}
                onAlternativesChange={setAlternatives}
                onCaptionGenerated={handleCaptionGenerated}
              />

              <ApprovalGate
                selectedImage={selectedImage}
                caption={caption}
                hashtags={hashtags}
                callToAction={callToAction}
                approvedRecord={approvedRecord}
                onDraftApproved={handleDraftApproved}
                onOpenMockPublish={() => setShowMockPublish(true)}
                mockPublishingEnabled={isMockProvider}
              />
            </div>

            {/* Right Column: Multi-Platform Previews */}
            <div className="social-preview-column">
              <div className="preview-sticky-wrap">
                <MultiPlatformPreview
                  selectedImage={selectedImage}
                  caption={caption}
                  hashtags={hashtags}
                  callToAction={callToAction}
                  accountHandle={status?.instagram.accountHandle || "adal.nexus"}
                  publishingStatus={approvedRecord?.publishingStatus}
                  mockPermalink={latestAttempt?.result?.mockPermalink}
                />
              </div>
            </div>
          </div>

          {/* Google Drive Setup Instructions Modal */}
          {showDriveSetup && (
            <DriveSetupModal
              status={status?.drive ?? null}
              onClose={() => setShowDriveSetup(false)}
            />
          )}

          {/* Safe Mock Publishing Simulation Modal */}
          {showMockPublish && approvedRecord && (
            <MockPublishModal
              draft={approvedRecord}
              previewUrl={selectedImage?.previewUrl}
              onClose={() => setShowMockPublish(false)}
              onPublished={handleMockPublished}
            />
          )}
        </>
      )}
    </div>
  );
}
