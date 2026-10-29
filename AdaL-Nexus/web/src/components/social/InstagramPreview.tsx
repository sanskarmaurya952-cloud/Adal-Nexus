import React, { useState } from "react";
import type { SelectedMedia } from "./ImagePicker";
import {
  BookmarkIcon,
  CameraIcon,
  CheckCircleIcon,
  CommentIcon,
  CopyIcon,
  HeartIcon,
  InstagramIcon,
  ShareIcon,
  ShieldIcon,
} from "../Icons";

interface InstagramPreviewProps {
  selectedImage: SelectedMedia | null;
  caption: string;
  hashtags: string[];
  callToAction?: string;
  accountHandle?: string;
  publishingStatus?: "unavailable_personal_account" | "succeeded_mock" | "failed_mock";
  mockPermalink?: string;
}

export function InstagramPreview({
  selectedImage,
  caption,
  hashtags,
  callToAction,
  accountHandle = "adal.nexus",
  publishingStatus,
  mockPermalink,
}: InstagramPreviewProps) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const formattedHashtags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
  const fullCopyText = [
    caption,
    callToAction ? `\n\n${callToAction}` : "",
    formattedHashtags.length > 0 ? `\n\n${formattedHashtags.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullCopyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const likesCount = liked ? 419 : 418;
  const isMockPublished = publishingStatus === "succeeded_mock";

  return (
    <div className="glass-card social-card preview-column-card">
      <div className="social-card-header">
        <div className="social-card-title-wrap">
          <InstagramIcon size={20} className="social-accent-icon" />
          <h3 className="social-card-title">Live Instagram Preview</h3>
        </div>
        <span className={`social-status-pill ${isMockPublished ? "mock-published-mode-pill" : "preview-mode-pill"}`}>
          {isMockPublished ? "Mock Post" : "Draft Preview"}
        </span>
      </div>

      <div className="preview-phone-frame">
        <div className="phone-notch-bar">
          <div className="phone-time">9:41</div>
          <div className="phone-speaker-notch" />
          <div className="phone-status-icons">5G 100%</div>
        </div>

        <div className="ig-post-card">
          {/* Post Header */}
          <div className="ig-header">
            <div className="ig-user-info">
              <div className="ig-avatar-ring">
                <div className="ig-avatar-circle">
                  <span>AN</span>
                </div>
              </div>
              <div className="ig-user-text">
                <div className="ig-username-row">
                  <span className="ig-username">{accountHandle}</span>
                  <span className="ig-badge-personal" title="Personal Account">
                    Personal
                  </span>
                </div>
                <span className="ig-location">San Francisco, CA</span>
              </div>
            </div>
            <div className="ig-header-dots" aria-hidden="true">
              •••
            </div>
          </div>

          {/* Post Media Container */}
          <div className="ig-media-box">
            {selectedImage ? (
              <img
                src={selectedImage.previewUrl}
                alt={selectedImage.fileName}
                className="ig-post-img"
              />
            ) : (
              <div className="ig-placeholder-media">
                <CameraIcon size={44} className="placeholder-cam-icon" />
                <span className="placeholder-msg">Select or upload an image to preview</span>
                <span className="placeholder-submsg">Aspect ratio 1:1 or 4:5 recommended</span>
              </div>
            )}

            {/* Prominent Overlay Watermark Badge */}
            <div className="ig-watermark-overlay" aria-label="Watermark preview indicator">
              <span className={`watermark-pill ${isMockPublished ? "mock-watermark-pill" : ""}`}>
                {isMockPublished ? "MOCK PUBLISHED — LOCAL SIMULATION" : "PREVIEW ONLY — NOT PUBLISHED"}
              </span>
            </div>
          </div>

          {/* Action Row */}
          <div className="ig-actions-row">
            <div className="ig-left-actions">
              <button
                type="button"
                className={`ig-action-btn like-btn ${liked ? "active-like" : ""}`}
                onClick={() => setLiked(!liked)}
                title={liked ? "Unlike" : "Like"}
                aria-label={liked ? "Unlike" : "Like"}
              >
                <HeartIcon size={22} fill={liked ? "#f43f5e" : "none"} stroke={liked ? "#f43f5e" : "currentColor"} />
              </button>
              <button
                type="button"
                className="ig-action-btn"
                title="Comment"
                aria-label="Comment"
              >
                <CommentIcon size={22} />
              </button>
              <button
                type="button"
                className="ig-action-btn"
                title="Share"
                aria-label="Share"
              >
                <ShareIcon size={22} />
              </button>
            </div>
            <button
              type="button"
              className={`ig-action-btn save-btn ${saved ? "active-save" : ""}`}
              onClick={() => setSaved(!saved)}
              title={saved ? "Unsave" : "Save"}
              aria-label={saved ? "Unsave" : "Save"}
            >
              <BookmarkIcon size={22} fill={saved ? "#c084fc" : "none"} stroke={saved ? "#c084fc" : "currentColor"} />
            </button>
          </div>

          {/* Likes Summary */}
          <div className="ig-likes-row">
            <span>
              Liked by <strong>alex_dev</strong> and <strong>{likesCount.toLocaleString()} others</strong>
            </span>
          </div>

          {/* Caption Area */}
          <div className="ig-caption-block">
            {caption || formattedHashtags.length > 0 ? (
              <div className="ig-caption-text">
                <span className="ig-author-name">{accountHandle}</span>{" "}
                <span className="ig-body-text">{caption || "Your post caption will appear here..."}</span>
                {callToAction && (
                  <div className="ig-cta-text">{callToAction}</div>
                )}
                {formattedHashtags.length > 0 && (
                  <div className="ig-hashtags-row">
                    {formattedHashtags.map((tag, i) => (
                      <span key={i} className="ig-hashtag-item">
                        {tag}{" "}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="ig-caption-empty">
                <span className="ig-author-name">{accountHandle}</span>{" "}
                <span className="empty-caption-prompt">
                  Generate or type a caption in the editor to see it here...
                </span>
              </div>
            )}
          </div>

          {/* Time & Safety Meta */}
          <div className="ig-post-timestamp">
            <span>JUST NOW • SAFE DRAFT PREVIEW</span>
          </div>
        </div>
      </div>

      {/* Copy and Export Bar */}
      <div className="preview-action-tray">
        <button
          type="button"
          className="action-btn secondary-btn copy-caption-btn"
          onClick={handleCopy}
          disabled={!caption && formattedHashtags.length === 0}
        >
          {copied ? (
            <>
              <CheckCircleIcon size={16} />
              <span>Copied to Clipboard!</span>
            </>
          ) : (
            <>
              <CopyIcon size={16} />
              <span>Copy Caption &amp; Hashtags</span>
            </>
          )}
        </button>

        <div className="preview-policy-notice">
          <ShieldIcon size={14} />
          <span>
            Personal Instagram account mode. Direct publishing is disabled. Use the copied draft for verified manual posting.
          </span>
        </div>
      </div>
    </div>
  );
}
