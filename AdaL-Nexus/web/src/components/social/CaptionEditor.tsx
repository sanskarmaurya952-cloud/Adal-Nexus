import React, { useState } from "react";
import type {
  CaptionAlternative,
  GenerateCaptionRequest,
  GenerateCaptionResponse,
  SocialTone,
} from "../../../../src/server/social/types";
import { AlertTriangleIcon, PencilIcon, RefreshIcon, SparklesIcon } from "../Icons";
import { getApiUrl } from "../../api";

interface CaptionEditorProps {
  caption: string;
  onCaptionChange: (caption: string) => void;
  hashtags: string[];
  onHashtagsChange: (hashtags: string[]) => void;
  callToAction: string;
  onCallToActionChange: (cta: string) => void;
  alternatives: CaptionAlternative[];
  onAlternativesChange: (alts: CaptionAlternative[]) => void;
  onCaptionGenerated?: (response: GenerateCaptionResponse) => void;
}

const TONES: { id: SocialTone; label: string; desc: string }[] = [
  { id: "engaging", label: "Engaging", desc: "Interactive, conversation-starting" },
  { id: "professional", label: "Professional", desc: "Authoritative, industry-grade" },
  { id: "casual", label: "Casual", desc: "Friendly, relaxed, approachable" },
  { id: "creative", label: "Creative", desc: "Storytelling, evocative, imaginative" },
  { id: "bold", label: "Bold", desc: "Punchy, visionary, statement-making" },
];

export function CaptionEditor({
  caption,
  onCaptionChange,
  hashtags,
  onHashtagsChange,
  callToAction,
  onCallToActionChange,
  alternatives,
  onAlternativesChange,
  onCaptionGenerated,
}: CaptionEditorProps) {
  // Generation parameters
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<SocialTone>("engaging");
  const [targetAudience, setTargetAudience] = useState("");
  const [imageContext, setImageContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Raw hashtag string editor
  const hashtagString = hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");

  const handleHashtagsInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#+/, ""))
      .filter((t) => t.length > 0)
      .map((t) => `#${t}`);
    onHashtagsChange(tags);
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setGenError("Please provide a topic or focus for the post.");
      return;
    }

    setGenerating(true);
    setGenError(null);

    const reqBody: GenerateCaptionRequest = {
      topic: topic.trim(),
      tone,
      targetAudience: targetAudience.trim() || undefined,
      imageContext: imageContext.trim() || undefined,
      callToAction: callToAction.trim() || undefined,
    };

    try {
      const res = await fetch(getApiUrl("/api/social/generate-caption"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const genData = data as GenerateCaptionResponse;
      onCaptionChange(genData.primaryCaption);
      onHashtagsChange(genData.hashtags || []);
      if (genData.callToAction) {
        onCallToActionChange(genData.callToAction);
      }
      onAlternativesChange(genData.alternatives || []);
      if (onCaptionGenerated) {
        onCaptionGenerated(genData);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate caption");
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyAlternative = (alt: CaptionAlternative) => {
    onCaptionChange(alt.caption);
  };

  const charCount = caption.length;
  const isCharOver = charCount > 2200;
  const tagCount = hashtags.length;
  const isTagOver = tagCount > 30;

  return (
    <div className="glass-card social-card caption-editor-card">
      <div className="social-card-header">
        <div className="social-card-title-wrap">
          <PencilIcon size={20} className="social-accent-icon" />
          <h3 className="social-card-title">2. AI Caption &amp; Copy Generation</h3>
        </div>
        <span className="social-card-badge">Gemini Powered</span>
      </div>

      <p className="social-card-desc">
        Draft engaging, Instagram-optimized copy with hashtags and tailored tone using Gemini.
      </p>

      {/* Generation Input Grid */}
      <div className="caption-gen-controls">
        <div className="form-group">
          <label htmlFor="social-topic" className="form-label">
            Post Topic or Focus <span className="req-star">*</span>
          </label>
          <input
            id="social-topic"
            type="text"
            className="form-input"
            placeholder="e.g. Launching autonomous AI agents with human verification"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={generating}
          />
        </div>

        <div className="form-row-grid">
          <div className="form-group">
            <label htmlFor="social-tone" className="form-label">
              Tone of Voice
            </label>
            <select
              id="social-tone"
              className="form-select"
              value={tone}
              onChange={(e) => setTone(e.target.value as SocialTone)}
              disabled={generating}
            >
              {TONES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} — {t.desc}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="social-audience" className="form-label">
              Target Audience
            </label>
            <input
              id="social-audience"
              type="text"
              className="form-input"
              placeholder="e.g. Founders, engineers, tech enthusiasts"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              disabled={generating}
            />
          </div>
        </div>

        <div className="form-row-grid">
          <div className="form-group">
            <label htmlFor="social-image-ctx" className="form-label">
              Visual Context (Optional)
            </label>
            <input
              id="social-image-ctx"
              type="text"
              className="form-input"
              placeholder="e.g. Dark theme IDE screenshot with code diff"
              value={imageContext}
              onChange={(e) => setImageContext(e.target.value)}
              disabled={generating}
            />
          </div>

          <div className="form-group">
            <label htmlFor="social-cta" className="form-label">
              Call to Action (CTA)
            </label>
            <input
              id="social-cta"
              type="text"
              className="form-input"
              placeholder="e.g. Link in bio to try the alpha release"
              value={callToAction}
              onChange={(e) => {
                onCallToActionChange(e.target.value);
              }}
              disabled={generating}
            />
          </div>
        </div>

        {genError && (
          <div className="social-error-banner" role="alert">
            <AlertTriangleIcon size={16} />
            <span>{genError}</span>
          </div>
        )}

        <div className="gen-action-row">
          <button
            type="button"
            className="action-btn primary-btn gen-caption-btn"
            onClick={handleGenerate}
            disabled={generating || !topic.trim()}
          >
            {generating ? (
              <>
                <span className="spinner-border" />
                <span>Crafting Copy with Gemini...</span>
              </>
            ) : (
              <>
                <SparklesIcon size={18} />
                <span>{caption ? "Regenerate Caption" : "Generate Caption (AI)"}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editable Primary Caption Area */}
      <div className="editable-caption-section">
        <div className="section-label-row">
          <label htmlFor="social-caption-text" className="form-label">
            Primary Caption
          </label>
          <span className={`char-counter ${isCharOver ? "char-over" : ""}`}>
            {charCount} / 2,200 chars
          </span>
        </div>

        <textarea
          id="social-caption-text"
          className="form-textarea caption-textarea"
          rows={5}
          placeholder="Write or edit your post caption here..."
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
        />

        {/* Hashtags Input */}
        <div className="section-label-row">
          <label htmlFor="social-hashtags" className="form-label">
            Hashtags
          </label>
          <span className={`char-counter ${isTagOver ? "char-over" : ""}`}>
            {tagCount} / 30 tags
          </span>
        </div>

        <input
          id="social-hashtags"
          type="text"
          className="form-input"
          placeholder="#ai #tech #startups #innovation"
          value={hashtagString}
          onChange={handleHashtagsInput}
        />

        {/* Alternative Variations */}
        {alternatives.length > 0 && (
          <div className="alternatives-wrapper">
            <div className="alternatives-header">
              <span className="alt-title">Alternative Style Variations</span>
              <span className="alt-desc">Click any version to apply it to your primary caption</span>
            </div>

            <div className="alternatives-list">
              {alternatives.map((alt, idx) => (
                <div
                  key={idx}
                  className="alt-item-card"
                  onClick={() => handleApplyAlternative(alt)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleApplyAlternative(alt)}
                >
                  <div className="alt-badge-row">
                    <span className="alt-style-tag">{alt.style}</span>
                    <button
                      type="button"
                      className="alt-use-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyAlternative(alt);
                      }}
                    >
                      Apply
                    </button>
                  </div>
                  <p className="alt-caption-preview">{alt.caption}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
