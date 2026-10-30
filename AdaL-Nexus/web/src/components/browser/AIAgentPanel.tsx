import React, { useState, useRef } from "react";
import type { BrowserTab, RunSnapshot } from "../../types/browser";
import { getApiUrl } from "../../api";
import { VoiceControl } from "./VoiceControl";
import {
  AgentIcon,
  AlertTriangleIcon,
  CameraIcon,
  CheckCircleIcon,
  ClockIcon,
  FileSpreadsheetIcon,
  InstagramIcon,
  LinkedInIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  StopIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
  XTwitterIcon,
} from "../Icons";

interface Draft {
  planId: string;
  plan: { goal: string; steps: { id: string; title: string; tool: string; input?: unknown }[] };
  limitations: string[];
  approvalStepIds: string[];
  provider: string;
  model?: string;
}

interface LogLine {
  key: string;
  type: string;
  message: string;
  time: string;
}

export interface AttachedImage {
  fileName: string;
  previewUrl: string;
  base64Data?: string;
  fileSizeBytes: number;
  dimensions?: { width: number; height: number };
  filePath?: string;
}

export interface PlatformCaptions {
  linkedin: string;
  twitter: string;
  instagram: string;
  hashtags: string[];
}

interface AIAgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: BrowserTab | null;
  task: string;
  onTaskChange: (val: string) => void;
  onGeneratePlan: () => void;
  onRunResearch: () => void;
  onRunDemo: () => void;
  isPlanning: boolean;
  isRunning: boolean;
  planError: string | null;
  actionError: string | null;
  draft: Draft | null;
  starting: boolean;
  onStartDraft: () => void;
  onDiscardDraft: () => void;
  run: RunSnapshot | null;
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  log: LogLine[];
  onOpenSocial: () => void;
  llmConfigured: boolean;
  providerName?: string;
}

export function AIAgentPanel({
  isOpen,
  onClose,
  activeTab,
  task,
  onTaskChange,
  onGeneratePlan,
  onRunResearch,
  onRunDemo,
  isPlanning,
  isRunning,
  planError,
  actionError,
  draft,
  starting,
  onStartDraft,
  onDiscardDraft,
  run,
  onApprove,
  onReject,
  onPause,
  onResume,
  onCancel,
  log,
  onOpenSocial,
  llmConfigured,
  providerName = "Google Gemini",
}: AIAgentPanelProps) {
  if (!isOpen) return null;

  // Social Studio State
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<("linkedin" | "twitter" | "instagram")[]>([
    "linkedin",
    "twitter",
    "instagram",
  ]);
  const [activePreviewTab, setActivePreviewTab] = useState<"linkedin" | "twitter" | "instagram">("linkedin");
  const [captions, setCaptions] = useState<PlatformCaptions>({
    linkedin: "",
    twitter: "",
    instagram: "",
    hashtags: ["#AdaLNexus", "#AI", "#TechInnovation"],
  });
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [socialStudioExpanded, setSocialStudioExpanded] = useState(false);
  const [publishStatusMessage, setPublishStatusMessage] = useState<string | null>(null);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [editedDraftContent, setEditedDraftContent] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState<{ text: string; time: string }[]>([
    { text: "YouTube par Arijit Singh ka song play karo", time: "10:15 AM" },
    { text: "Naya tab kholo aur Google kholo", time: "10:10 AM" },
    { text: "Pichhle tab par jao", time: "10:05 AM" },
  ]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const needsApproval = run?.status === "waiting_for_approval";
  const isPaused = run?.status === "paused";
  const pendingStep = run?.steps?.find((s: { id: string; title: string }) => s.id === run?.currentStepId);

  const draftStep = run?.steps?.find((s: any) => s.tool === "draft.create");
  const draftData = draftStep?.output as any;

  const clarificationStep = run?.steps?.find(
    (s: any) =>
      s.tool === "system.note" &&
      (s.input?.isClarification || s.title?.toLowerCase().includes("clarification"))
  );

  const sheetStep = run?.steps?.find(
    (s: any) => s.tool === "sheet.write" && (s.status === "completed" || (s.output as any)?.fileName)
  );
  const outputFileName = (sheetStep?.output as any)?.fileName || "ai_startups.xlsx";
  const downloadUrl = getApiUrl(`/api/downloads/${encodeURIComponent(outputFileName)}`);

  const failedStep = run?.steps?.find((s: any) => s.status === "failed");

  // Platform character limits
  const LIMITS = {
    linkedin: 3000,
    twitter: 280,
    instagram: 2200,
  };

  // Image selection and client-side validation
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (10 MB max)
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setImageError(`Image exceeds maximum allowed size of 10MB (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
      return;
    }

    // Validate mime
    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      setImageError("Invalid file type. Please select a JPEG, PNG, or WebP image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setAttachedImage({
          fileName: file.name,
          previewUrl: base64Data,
          base64Data,
          fileSizeBytes: file.size,
          dimensions: { width: img.naturalWidth, height: img.naturalHeight },
        });
        setSocialStudioExpanded(true);

        // Auto-suggest social mission task if empty
        if (!task.trim()) {
          onTaskChange(`Post photo "${file.name}" to LinkedIn, Instagram, and X with engaging captions.`);
        }
      };
      img.src = base64Data;
    };
    reader.onerror = () => {
      setImageError("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setAttachedImage(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const togglePlatform = (p: "linkedin" | "twitter" | "instagram") => {
    if (selectedPlatforms.includes(p)) {
      if (selectedPlatforms.length === 1) return; // Keep at least one
      setSelectedPlatforms(selectedPlatforms.filter((x) => x !== p));
    } else {
      setSelectedPlatforms([...selectedPlatforms, p]);
    }
  };

  // Generate multi-platform captions with Gemini
  const handleGenerateCaptions = async () => {
    setIsGeneratingCaptions(true);
    setPublishStatusMessage(null);
    try {
      const res = await fetch(getApiUrl("/api/social/generate-multi-captions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: task.trim() || "Excited to share our latest project milestone with the community!",
          platforms: selectedPlatforms,
          style: "engaging",
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      setCaptions({
        linkedin: data.captions.linkedin?.caption || data.captions.linkedin?.text || "",
        twitter: data.captions.twitter?.caption || data.captions.twitter?.text || "",
        instagram: data.captions.instagram?.caption || data.captions.instagram?.text || "",
        hashtags: data.captions.instagram?.hashtags || data.hashtags || [],
      });
    } catch (err) {
      console.error("Caption generation error:", err);
      // Fallback captions
      setCaptions({
        linkedin: `🚀 Proud to introduce our latest development. Continuous progress through agentic design and modern AI integration.\n\n#AI #Technology #Engineering`,
        twitter: `🚀 New milestone unlocked! Building next-gen autonomous systems. Feedback welcome! #AI #Tech`,
        instagram: `Pushing boundaries one milestone at a time ✨\n\nWhat are you creating this week? Drop your thoughts below!\n\n#AdaLNexus #Innovation #Code`,
        hashtags: ["#AI", "#Innovation", "#Tech"],
      });
    } finally {
      setIsGeneratingCaptions(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <aside className="ai-agent-panel-drawer" aria-label="AdaL AI Agent Assistant">
      {/* Panel Header */}
      <div className="agent-panel-header">
        <div className="agent-header-brand">
          <div className="agent-header-icon-box">
            <AgentIcon size={18} />
          </div>
          <div className="agent-header-meta">
            <span className="agent-panel-title">AdaL AI Agent</span>
            <span className="agent-model-status">
              {llmConfigured ? `• ${providerName} Active` : "• Deterministic Mode"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn-panel-close"
          onClick={onClose}
          title="Close AI Agent panel"
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="agent-panel-content-scroll">
        {/* Active Tab Context Bar */}
        {activeTab && !activeTab.isHome && (
          <div className="agent-tab-context-card">
            <span className="context-label">Current Webpage Context</span>
            <div className="context-title-row">
              <span className="context-title">{activeTab.title || activeTab.url}</span>
            </div>
            <div className="context-actions-row">
              <button
                type="button"
                className="btn-context-action"
                onClick={() => onTaskChange(`Summarize and extract key findings from: ${activeTab.url}`)}
              >
                Summarize Page
              </button>
              <button
                type="button"
                className="btn-context-action"
                onClick={() => onTaskChange(`Research competitors and market space for ${activeTab.title || activeTab.url}`)}
              >
                Research Domain
              </button>
            </div>
          </div>
        )}

        {/* Task Input Section */}
        <div className="agent-input-section">
          {/* Prominent Microphone & Voice Control Bar */}
          <VoiceControl
            onTranscript={(recognizedText) => {
              onTaskChange(recognizedText);
            }}
            onChipSelect={(cmd) => {
              onTaskChange(cmd);
            }}
          />

          <label htmlFor="agent-task-input" className="agent-input-label">
            Editable Command or Mission (Hindi / Hinglish / English)
          </label>
          <div className="agent-input-wrap">
            <textarea
              id="agent-task-input"
              rows={3}
              value={task}
              onChange={(e) => onTaskChange(e.target.value)}
              placeholder="e.g. 'YouTube par Arijit Singh ka song play karo' or 'Naya tab kholo aur Google kholo'..."
              className="agent-task-textarea"
            />
          </div>

          {/* User Image Attachment Uploader */}
          <div className="agent-image-attachment-card">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              id="agent-image-file-input"
            />

            {!attachedImage ? (
              <button
                type="button"
                className="btn-attach-image"
                onClick={() => fileInputRef.current?.click()}
                title="Attach user image for social publishing (JPEG, PNG, WebP up to 10MB)"
              >
                <UploadIcon size={15} />
                <span>Attach Image for Social Post</span>
                <span className="attach-limit-pill">Max 10MB</span>
              </button>
            ) : (
              <div className="attached-image-preview-row">
                <img
                  src={attachedImage.previewUrl}
                  alt={attachedImage.fileName}
                  className="attached-thumbnail"
                />
                <div className="attached-meta">
                  <span className="attached-filename" title={attachedImage.fileName}>
                    {attachedImage.fileName}
                  </span>
                  <span className="attached-specs">
                    {formatBytes(attachedImage.fileSizeBytes)}
                    {attachedImage.dimensions && ` • ${attachedImage.dimensions.width}×${attachedImage.dimensions.height}px`}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-remove-attachment"
                  onClick={handleClearImage}
                  title="Remove image"
                >
                  <XIcon size={14} />
                </button>
              </div>
            )}

            {imageError && <div className="agent-error-alert">{imageError}</div>}
          </div>

          {/* Multi-Platform Social Studio (Toggleable / Expandable) */}
          <div className="social-studio-accordion">
            <div
              className="social-studio-toggle-bar"
              onClick={() => setSocialStudioExpanded(!socialStudioExpanded)}
            >
              <div className="studio-toggle-title">
                <CameraIcon size={15} />
                <span>Multi-Platform Social Composer</span>
              </div>
              <span className="studio-toggle-badge">
                {selectedPlatforms.length} Selected {socialStudioExpanded ? "▲" : "▼"}
              </span>
            </div>

            {socialStudioExpanded && (
              <div className="social-studio-content">
                {/* Platform Selector Chips */}
                <div className="platform-chips-row">
                  <button
                    type="button"
                    className={`platform-chip ${selectedPlatforms.includes("linkedin") ? "active" : ""}`}
                    onClick={() => togglePlatform("linkedin")}
                  >
                    <LinkedInIcon size={14} />
                    <span>LinkedIn</span>
                  </button>
                  <button
                    type="button"
                    className={`platform-chip ${selectedPlatforms.includes("twitter") ? "active" : ""}`}
                    onClick={() => togglePlatform("twitter")}
                  >
                    <XTwitterIcon size={13} />
                    <span>X (Twitter)</span>
                  </button>
                  <button
                    type="button"
                    className={`platform-chip ${selectedPlatforms.includes("instagram") ? "active" : ""}`}
                    onClick={() => togglePlatform("instagram")}
                  >
                    <InstagramIcon size={14} />
                    <span>Instagram</span>
                  </button>
                </div>

                {/* Generate Captions Action */}
                <button
                  type="button"
                  className="btn-generate-captions"
                  onClick={handleGenerateCaptions}
                  disabled={isGeneratingCaptions}
                >
                  <SparklesIcon size={14} />
                  <span>{isGeneratingCaptions ? "Generating Captions..." : "Generate AI Captions for All"}</span>
                </button>

                {/* Platform Preview Tabs */}
                <div className="platform-preview-tabs">
                  {selectedPlatforms.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`tab-btn ${activePreviewTab === p ? "active" : ""}`}
                      onClick={() => setActivePreviewTab(p)}
                    >
                      {p === "linkedin" && "LinkedIn"}
                      {p === "twitter" && "X"}
                      {p === "instagram" && "Instagram"}
                    </button>
                  ))}
                </div>

                {/* Active Platform Card Preview & Editor */}
                <div className="platform-card-preview">
                  <div className="card-platform-header">
                    <span className="platform-tag">
                      {activePreviewTab === "linkedin" && "LinkedIn Post (3000 max)"}
                      {activePreviewTab === "twitter" && "X Post (280 max strictly enforced)"}
                      {activePreviewTab === "instagram" && "Instagram Caption (2200 max)"}
                    </span>
                    <span
                      className={`char-counter ${
                        captions[activePreviewTab].length > LIMITS[activePreviewTab] ? "over-limit" : ""
                      }`}
                    >
                      {captions[activePreviewTab].length} / {LIMITS[activePreviewTab]}
                    </span>
                  </div>

                  <textarea
                    rows={4}
                    value={captions[activePreviewTab]}
                    onChange={(e) =>
                      setCaptions({ ...captions, [activePreviewTab]: e.target.value })
                    }
                    placeholder={`Write or edit ${activePreviewTab} caption...`}
                    className="platform-caption-textarea"
                  />

                  {attachedImage && (
                    <div className="preview-media-holder">
                      <img
                        src={attachedImage.previewUrl}
                        alt="Preview"
                        className="preview-media-img"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {planError && <div className="agent-error-alert">{planError}</div>}
          {actionError && <div className="agent-error-alert">{actionError}</div>}
          {publishStatusMessage && <div className="agent-success-alert">{publishStatusMessage}</div>}

          {/* Quick Execution Actions */}
          <div className="agent-actions-grid">
            <button
              type="button"
              className="btn-agent-primary"
              onClick={() => {
                if (task.trim()) {
                  setCommandHistory((prev) => [
                    { text: task.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
                    ...prev.slice(0, 9),
                  ]);
                }
                onGeneratePlan();
              }}
              disabled={isPlanning || isRunning || !task.trim()}
            >
              <SparklesIcon size={16} />
              <span>{isPlanning ? "Planning..." : "Execute Command / Plan"}</span>
            </button>

            <button
              type="button"
              className="btn-agent-preset"
              onClick={onRunResearch}
              disabled={isRunning}
              title="Launch verified 5-step research pipeline and export to Excel"
            >
              <FileSpreadsheetIcon size={16} />
              <span>Research Startups &amp; Excel</span>
            </button>
          </div>

          <div className="preset-quick-links">
            <button
              type="button"
              className="preset-sublink"
              onClick={onRunDemo}
              disabled={isRunning}
            >
              Run System Controller Demo
            </button>
            <span className="preset-divider">•</span>
            <button
              type="button"
              className="preset-sublink"
              onClick={onOpenSocial}
            >
              <InstagramIcon size={14} /> Social Autopilot
            </button>
          </div>

          {/* Command History Section */}
          {commandHistory.length > 0 && (
            <div className="agent-history-section">
              <div className="agent-history-header">
                <ClockIcon size={14} />
                <span>Recent Voice &amp; Desktop Commands</span>
              </div>
              <div className="agent-history-list">
                {commandHistory.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="agent-history-item-btn"
                    onClick={() => onTaskChange(item.text)}
                    title="Click to populate this command"
                  >
                    <span className="history-cmd-text">"{item.text}"</span>
                    <span className="history-cmd-time">{item.time}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Plan Draft Review Card */}
        {draft && !isRunning && (
          <div className="agent-draft-card">
            <div className="draft-card-header">
              <span className="draft-badge">Plan Draft Ready</span>
              <span className="draft-steps-count">{draft.plan.steps.length} Steps</span>
            </div>
            <h4 className="draft-goal-text">{draft.plan.goal}</h4>

            <div className="draft-steps-list">
              {draft.plan.steps.map((st, i) => (
                <div key={st.id} className="draft-step-item">
                  <span className="step-num">{i + 1}</span>
                  <div className="step-info">
                    <span className="step-title">{st.title}</span>
                    <span className="step-tool-tag">{st.tool}</span>
                  </div>
                  {draft.approvalStepIds.includes(st.id) && (
                    <span className="approval-flag" title="Requires user approval">
                      <AlertTriangleIcon size={13} />
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="draft-actions-row">
              <button
                type="button"
                className="btn-start-draft"
                onClick={onStartDraft}
                disabled={starting}
              >
                <PlayIcon size={15} />
                <span>{starting ? "Starting..." : "Start Mission"}</span>
              </button>
              <button
                type="button"
                className="btn-discard-draft"
                onClick={onDiscardDraft}
                disabled={starting}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Live Mission Execution Status */}
        {run && (
          <div className={`agent-mission-card status-${run.status}`}>
            <div className="mission-card-top">
              <span className={`mission-status-pill ${run.status}`}>
                {run.status.replace(/_/g, " ")}
              </span>
              <span className="mission-time-stamp">
                {run.createdAt ? new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
              </span>
            </div>

            <h4 className="mission-goal">{run.goal}</h4>

            {/* Approval Gate Banner (Mandatory before publishing sensitive actions) */}
            {needsApproval && pendingStep && (
              <div className="mission-approval-banner">
                <div className="approval-text-wrap">
                  <AlertTriangleIcon size={18} className="warn-icon" />
                  <div>
                    <strong>Approval Checkpoint Required</strong>
                    <p>{pendingStep.title}</p>
                    <span className="approval-subtext">
                      Safety gate: Review the generated content and platforms before granting approval.
                    </span>
                  </div>
                </div>

                {attachedImage && (
                  <div className="approval-media-snippet">
                    <img src={attachedImage.previewUrl} alt="Approved media" className="snippet-thumb" />
                    <span>Attached: {attachedImage.fileName}</span>
                  </div>
                )}

                <div className="approval-btns-row">
                  <button
                    type="button"
                    className="btn-approve"
                    onClick={() => onApprove(pendingStep.id)}
                  >
                    Approve &amp; Publish
                  </button>
                  <button
                    type="button"
                    className="btn-reject"
                    onClick={() => onReject(pendingStep.id)}
                  >
                    Reject &amp; Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Step Progress Timeline */}
            <div className="mission-steps-progress">
              {run.steps?.map((st: { id: string; title: string; status: string }) => {
                const isCurrent = st.id === run.currentStepId;
                const isCompleted = st.status === "completed";
                const isFailed = st.status === "failed";

                return (
                  <div key={st.id} className={`progress-step-row ${st.status} ${isCurrent ? "current" : ""}`}>
                    <div className="step-status-icon">
                      {isCompleted ? (
                        <CheckCircleIcon size={14} className="icon-success" />
                      ) : isFailed ? (
                        <XCircleIcon size={14} className="icon-fail" />
                      ) : isCurrent ? (
                        <span className="step-spin-indicator" />
                      ) : (
                        <ClockIcon size={14} className="icon-pending" />
                      )}
                    </div>
                    <span className="step-progress-title">{st.title}</span>
                  </div>
                );
              })}
            </div>

            {/* Control Buttons (Pause, Resume, Cancel) */}
            {isRunning && (
              <div className="mission-controls-row">
                {isPaused ? (
                  <button type="button" className="btn-mission-ctrl resume" onClick={onResume}>
                    <PlayIcon size={14} /> Resume
                  </button>
                ) : (
                  <button type="button" className="btn-mission-ctrl pause" onClick={onPause}>
                    <PauseIcon size={14} /> Pause
                  </button>
                )}
                <button type="button" className="btn-mission-ctrl cancel" onClick={onCancel}>
                  <StopIcon size={14} /> Cancel
                </button>
              </div>
            )}

            {/* 1. Clarification Request Banner */}
            {clarificationStep && (
              <div className="mission-clarification-card">
                <div className="clarification-header">
                  <AlertTriangleIcon size={16} className="warn-icon" />
                  <strong>Clarification Needed / विषय स्पष्ट करें</strong>
                </div>
                <p className="clarification-text">
                  {(clarificationStep.input as any)?.text ||
                    "Kripya topic batayein jiske upar research aur Excel report generate karni hai."}
                </p>
                <div className="clarification-chips">
                  {["AI Agent Frameworks", "Machine Learning Startups", "Autonomous AI Agents"].map(
                    (chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="clarification-chip-btn"
                        onClick={() => {
                          onTaskChange(`${chip} par research karke Excel bana do`);
                        }}
                      >
                        + "{chip}"
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {/* 2. Editable Content Draft Card (Post draft ready) */}
            {draftData && (
              <div className="mission-draft-content-card">
                <div className="draft-content-header">
                  <div className="draft-platform-badge">
                    <span>{draftData.platform?.toUpperCase() || "CONTENT"} DRAFT</span>
                    <span className="draft-editable-pill">Editable Draft (Not Published)</span>
                  </div>
                  <span className="draft-char-count">
                    {(editedDraftContent ?? draftData.fullContent)?.length} /{" "}
                    {draftData.characterLimit || 3000} chars
                  </span>
                </div>

                <textarea
                  rows={6}
                  value={editedDraftContent ?? draftData.fullContent}
                  onChange={(e) => setEditedDraftContent(e.target.value)}
                  className="draft-editor-textarea"
                  placeholder="Review or edit your post draft here..."
                />

                <div className="draft-actions-bar">
                  <button
                    type="button"
                    className="btn-copy-draft"
                    onClick={() => {
                      navigator.clipboard?.writeText(editedDraftContent ?? draftData.fullContent);
                      setCopiedDraft(true);
                      setTimeout(() => setCopiedDraft(false), 2500);
                    }}
                  >
                    {copiedDraft ? "✓ Copied to Clipboard!" : "📋 Copy Draft"}
                  </button>
                  <button
                    type="button"
                    className="btn-save-draft"
                    onClick={() => {
                      const text = editedDraftContent ?? draftData.fullContent;
                      const blob = new Blob([text], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${draftData.platform || "post"}_draft.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    💾 Save as .txt
                  </button>
                </div>
              </div>
            )}

            {/* 3. Excel Download Result if completed */}
            {run.status === "completed" && sheetStep && (
              <div className="mission-output-card">
                <FileSpreadsheetIcon size={20} className="excel-icon" />
                <div className="output-info">
                  <strong>Excel Workbook Generated</strong>
                  <span>
                    {outputFileName} ({(sheetStep.output as any)?.rowCount || 0} rows, verified)
                  </span>
                </div>
                <a
                  href={downloadUrl}
                  download={outputFileName}
                  className="btn-download-workbook"
                  title={`Download verified Excel workbook: ${outputFileName}`}
                >
                  Download {outputFileName}
                </a>
              </div>
            )}

            {/* 4. Actionable Failure & Recovery Banner */}
            {run.status === "failed" && failedStep && (
              <div className="mission-failure-card">
                <div className="failure-header">
                  <XCircleIcon size={16} className="icon-fail" />
                  <strong>Task Failed at Step: "{failedStep.title}"</strong>
                </div>
                <p className="failure-reason">
                  {failedStep.reason || "The step encountered an unexpected error."}
                </p>
                <div className="failure-recovery-row">
                  <button
                    type="button"
                    className="btn-retry-failed-task"
                    onClick={() => onGeneratePlan()}
                  >
                    🔄 Retry Task
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Real-time Activity Log */}
        {log.length > 0 && (
          <div className="agent-logs-card">
            <span className="logs-heading">Live Agent Log Stream</span>
            <div className="logs-terminal-box">
              {log.slice(-15).map((l) => (
                <div key={l.key} className={`log-line type-${l.type}`}>
                  <span className="log-time">[{l.time.slice(11, 19)}]</span>
                  <span className="log-msg">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
