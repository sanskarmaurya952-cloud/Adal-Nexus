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
  LinkedInIcon,
  ShareIcon,
  ShieldIcon,
  XTwitterIcon,
} from "../Icons";
import { InstagramPreview } from "./InstagramPreview";

interface MultiPlatformPreviewProps {
  selectedImage: SelectedMedia | null;
  caption: string;
  hashtags: string[];
  callToAction?: string;
  accountHandle?: string;
  publishingStatus?: "unavailable_personal_account" | "succeeded_mock" | "failed_mock";
  mockPermalink?: string;
  linkedInCaption?: string;
  twitterCaption?: string;
}

export function MultiPlatformPreview({
  selectedImage,
  caption,
  hashtags,
  callToAction,
  accountHandle = "adal.nexus",
  publishingStatus,
  mockPermalink,
  linkedInCaption,
  twitterCaption,
}: MultiPlatformPreviewProps) {
  const [platformTab, setPlatformTab] = useState<"instagram" | "linkedin" | "twitter">("instagram");
  const [copied, setCopied] = useState(false);

  const formattedHashtags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
  const effectiveLinkedInText =
    linkedInCaption ||
    [caption, callToAction ? `\n\n${callToAction}` : "", formattedHashtags.length > 0 ? `\n\n${formattedHashtags.join(" ")}` : ""]
      .filter(Boolean)
      .join("");

  const effectiveTwitterText =
    twitterCaption ||
    `${caption.slice(0, 200)} ${formattedHashtags.slice(0, 2).join(" ")}`.trim();

  const handleCopyCurrent = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="multi-platform-preview-container">
      {/* Platform Switcher Tab Bar */}
      <div className="preview-platform-bar">
        <button
          type="button"
          className={`platform-preview-btn ${platformTab === "instagram" ? "active" : ""}`}
          onClick={() => setPlatformTab("instagram")}
        >
          <InstagramIcon size={16} />
          <span>Instagram</span>
        </button>
        <button
          type="button"
          className={`platform-preview-btn ${platformTab === "linkedin" ? "active" : ""}`}
          onClick={() => setPlatformTab("linkedin")}
        >
          <LinkedInIcon size={16} />
          <span>LinkedIn</span>
        </button>
        <button
          type="button"
          className={`platform-preview-btn ${platformTab === "twitter" ? "active" : ""}`}
          onClick={() => setPlatformTab("twitter")}
        >
          <XTwitterIcon size={14} />
          <span>X (Twitter)</span>
        </button>
      </div>

      {/* Render Current Platform Preview */}
      {platformTab === "instagram" && (
        <InstagramPreview
          selectedImage={selectedImage}
          caption={caption}
          hashtags={hashtags}
          callToAction={callToAction}
          accountHandle={accountHandle}
          publishingStatus={publishingStatus}
          mockPermalink={mockPermalink}
        />
      )}

      {platformTab === "linkedin" && (
        <div className="linkedin-feed-card">
          <div className="linkedin-header">
            <div className="linkedin-avatar">AN</div>
            <div className="linkedin-user-info">
              <span className="linkedin-name">AdaL-Nexus Workspace</span>
              <span className="linkedin-title">Autonomous AI Browser &amp; Enterprise Assistant</span>
              <span className="linkedin-time">Just now • 🌐</span>
            </div>
          </div>

          <div className="linkedin-body">
            <p className="linkedin-text">{effectiveLinkedInText || "Craft your message or generate with Gemini AI..."}</p>
          </div>

          {selectedImage?.previewUrl ? (
            <div className="linkedin-image-wrap">
              <img src={selectedImage.previewUrl} alt="Attached asset" className="linkedin-post-image" />
            </div>
          ) : (
            <div className="linkedin-image-placeholder">
              <CameraIcon size={24} />
              <span>Select an image to preview attachment</span>
            </div>
          )}

          <div className="linkedin-action-bar">
            <div className="li-action-item">👍 Like</div>
            <div className="li-action-item">💬 Comment</div>
            <div className="li-action-item">🔄 Repost</div>
            <div className="li-action-item">✈️ Send</div>
          </div>

          <div className="linkedin-footer-meta">
            <span className="char-count-pill">{effectiveLinkedInText.length} / 3000 chars</span>
            <button
              type="button"
              className="btn-copy-preview-text"
              onClick={() => handleCopyCurrent(effectiveLinkedInText)}
            >
              <CopyIcon size={12} />
              <span>{copied ? "Copied!" : "Copy Post"}</span>
            </button>
          </div>
        </div>
      )}

      {platformTab === "twitter" && (
        <div className="twitter-tweet-card">
          <div className="twitter-header">
            <div className="twitter-avatar">𝕏</div>
            <div className="twitter-user-info">
              <span className="twitter-name">AdaL-Nexus</span>
              <span className="twitter-handle">@{accountHandle || "adal_nexus"}</span>
              <span className="twitter-dot">•</span>
              <span className="twitter-time">1m</span>
            </div>
          </div>

          <div className="twitter-body">
            <p className="twitter-text">{effectiveTwitterText || "What is happening?! Generate with Gemini AI..."}</p>
          </div>

          {selectedImage?.previewUrl ? (
            <div className="twitter-media-wrap">
              <img src={selectedImage.previewUrl} alt="Tweet media" className="twitter-post-image" />
            </div>
          ) : (
            <div className="twitter-media-placeholder">
              <CameraIcon size={24} />
              <span>Select an image to preview attachment</span>
            </div>
          )}

          <div className="twitter-actions-row">
            <span className="tw-action">💬 24</span>
            <span className="tw-action">🔁 12</span>
            <span className="tw-action">❤️ 88</span>
            <span className="tw-action">📊 1.2K</span>
          </div>

          <div className="twitter-footer-meta">
            <span className={`char-count-pill ${effectiveTwitterText.length > 280 ? "error" : ""}`}>
              {effectiveTwitterText.length} / 280 max
            </span>
            <button
              type="button"
              className="btn-copy-preview-text"
              onClick={() => handleCopyCurrent(effectiveTwitterText)}
            >
              <CopyIcon size={12} />
              <span>{copied ? "Copied!" : "Copy Tweet"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
