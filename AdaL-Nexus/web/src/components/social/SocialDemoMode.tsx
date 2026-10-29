import React, { useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  InstagramIcon,
  LinkedInIcon,
  SparklesIcon,
  XTwitterIcon,
} from "../Icons";

export interface DemoPostRecord {
  id: string;
  timestamp: string;
  platforms: ("linkedin" | "twitter" | "instagram")[];
  captions: {
    linkedin: string;
    twitter: string;
    instagram: string;
  };
  imageName: string;
  imageUrl: string;
  status: "DEMO_COMPLETED";
  demoUrls: {
    linkedin?: string;
    twitter?: string;
    instagram?: string;
  };
}

export function SocialDemoMode() {
  const [selectedTemplate, setSelectedTemplate] = useState<number>(0);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [confirmedOwnership, setConfirmedOwnership] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<"linkedin" | "twitter" | "instagram">("linkedin");

  const sampleTemplates = [
    {
      title: "🚀 AdaL-Nexus 2.0 Product Launch",
      imageName: "adal-nexus-launch.png",
      imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
      captions: {
        linkedin:
          "Excited to introduce AdaL-Nexus 2.0! 🚀 A next-generation autonomous desktop browser and AI agent capable of multi-tab navigation, voice interaction in Hindi/English, and research workflows. Built with Electron, React, and Gemini. #AdaLNexus #AIAgents #TechInnovation",
        twitter:
          "Meet AdaL-Nexus 2.0 ⚡ Voice-controlled autonomous desktop browser powered by AI. Navigate tabs, stream video & research startups in real-time. #AdaLNexus #AI",
        instagram:
          "The future of browsing is autonomous ✨ AdaL-Nexus brings voice-controlled browser navigation and AI automation to your desktop. Experience real-time intelligent research. #AdaLNexus #FutureOfTech #AIInnovation",
      },
    },
    {
      title: "💡 AI Browser Engineering Insights",
      imageName: "browser-architecture.png",
      imageUrl: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=800&q=80",
      captions: {
        linkedin:
          "How do you build a real Chromium-based browser with autonomous agent control? In our latest engineering deep dive, we break down WebContentsView lifecycle, anti-replay CSRF protection, and policy engines. #Engineering #Chromium #TypeScript",
        twitter:
          "Deep dive into autonomous browser architecture: WebContentsView, IPC tab management, and safety gates. #DevCommunity #TypeScript",
        instagram:
          "Inside the code: Building an autonomous desktop browser with native Chromium views and voice commands. #CodeLife #SoftwareEngineering",
      },
    },
    {
      title: "🎨 Creative Social Autopilot",
      imageName: "creative-ai.png",
      imageUrl: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=800&q=80",
      captions: {
        linkedin:
          "Streamlining social publishing without compromising security. AdaL-Nexus pairs human-in-the-loop approval gates with multi-platform caption synthesis. #SocialMedia #Productivity #AI",
        twitter:
          "Human-in-the-loop social automation: Review, approve, and simulate multi-platform posting securely. #Productivity #AI",
        instagram:
          "Create once, tailor everywhere. Multi-platform social automation with complete user review control. #SocialStrategy #AIWorkflow",
      },
    },
  ];

  // Editable captions state based on selected template
  const [captions, setCaptions] = useState(sampleTemplates[0].captions);

  // Demo Activity Feed
  const [activityFeed, setActivityFeed] = useState<DemoPostRecord[]>([
    {
      id: "DEMO-POST-INIT-901",
      timestamp: new Date(Date.now() - 3600000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      platforms: ["linkedin", "twitter", "instagram"],
      captions: sampleTemplates[0].captions,
      imageName: sampleTemplates[0].imageName,
      imageUrl: sampleTemplates[0].imageUrl,
      status: "DEMO_COMPLETED",
      demoUrls: {
        linkedin: "demo://linkedin.com/feed/update/urn:li:demo:901",
        twitter: "demo://x.com/adalnexus/status/demo-901",
        instagram: "demo://instagram.com/p/demo-901",
      },
    },
  ]);

  const handleSelectTemplate = (idx: number) => {
    setSelectedTemplate(idx);
    setCaptions({ ...sampleTemplates[idx].captions });
  };

  const handleApproveAndPublish = () => {
    if (!confirmedOwnership) return;
    setIsPublishing(true);

    setTimeout(() => {
      const demoId = `DEMO-POST-${Math.floor(1000 + Math.random() * 9000)}`;
      const newRecord: DemoPostRecord = {
        id: demoId,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        platforms: ["linkedin", "twitter", "instagram"],
        captions: { ...captions },
        imageName: sampleTemplates[selectedTemplate].imageName,
        imageUrl: sampleTemplates[selectedTemplate].imageUrl,
        status: "DEMO_COMPLETED",
        demoUrls: {
          linkedin: `demo://linkedin.com/feed/update/urn:li:demo:${demoId}`,
          twitter: `demo://x.com/adalnexus/status/${demoId.toLowerCase()}`,
          instagram: `demo://instagram.com/p/${demoId.toLowerCase()}`,
        },
      };

      setActivityFeed((prev) => [newRecord, ...prev]);
      setIsPublishing(false);
      setShowApprovalModal(false);
      setConfirmedOwnership(false);
    }, 1200);
  };

  return (
    <div className="social-demo-mode-workspace">
      {/* 1. Visible DEMO MODE Banner */}
      <div className="demo-mode-presentation-banner">
        <div className="demo-badge-wrap">
          <span className="demo-pulsing-dot" />
          <span className="demo-banner-title">✨ DEMO MODE — PRESENTATION SANDBOX</span>
        </div>
        <p className="demo-banner-subtitle">
          Safe presentation simulator for hackathon demonstrations. Creates realistic mock posts, multi-platform previews, and durable activity entries without connecting live credentials.
        </p>
        <span className="demo-strict-tag">DEMO — NOT PUBLISHED TO LIVE ACCOUNTS</span>
      </div>

      {/* 2. Sample Post Templates */}
      <div className="demo-templates-section">
        <div className="demo-section-header">
          <SparklesIcon size={16} />
          <h3>Choose a Presentation Template or Edit Below:</h3>
        </div>
        <div className="demo-template-cards-grid">
          {sampleTemplates.map((tmpl, idx) => (
            <button
              key={idx}
              type="button"
              className={`demo-template-btn ${selectedTemplate === idx ? "selected" : ""}`}
              onClick={() => handleSelectTemplate(idx)}
            >
              <img src={tmpl.imageUrl} alt={tmpl.title} className="demo-thumb" />
              <div className="demo-template-info">
                <strong>{tmpl.title}</strong>
                <span>{tmpl.imageName}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Main Workspace Grid: Caption Editor + Preview Cards */}
      <div className="demo-workspace-grid">
        {/* Left Column: Caption Customizer */}
        <div className="demo-editor-column">
          <div className="demo-panel-card">
            <h4>✏️ Presentation Post Customizer</h4>
            <div className="demo-platform-tabs">
              {(["linkedin", "twitter", "instagram"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`demo-plat-tab ${activePreviewTab === p ? "active" : ""}`}
                  onClick={() => setActivePreviewTab(p)}
                >
                  {p === "linkedin" && <LinkedInIcon size={14} />}
                  {p === "twitter" && <XTwitterIcon size={14} />}
                  {p === "instagram" && <InstagramIcon size={14} />}
                  <span>{p.toUpperCase()}</span>
                </button>
              ))}
            </div>

            <div className="demo-caption-field">
              <label>Edit {activePreviewTab.toUpperCase()} Caption:</label>
              <textarea
                rows={5}
                value={captions[activePreviewTab]}
                onChange={(e) =>
                  setCaptions({ ...captions, [activePreviewTab]: e.target.value })
                }
                className="demo-textarea"
              />
              <span className="demo-char-counter">
                {captions[activePreviewTab].length} characters
              </span>
            </div>

            <div className="demo-selected-media-info">
              <img
                src={sampleTemplates[selectedTemplate].imageUrl}
                alt="Selected"
                className="demo-attached-img-preview"
              />
              <div>
                <strong>{sampleTemplates[selectedTemplate].imageName}</strong>
                <p>1920 × 1080 · Verified JPEG Buffer</p>
              </div>
            </div>

            <button
              type="button"
              className="demo-open-approval-btn"
              onClick={() => setShowApprovalModal(true)}
            >
              <CheckCircleIcon size={16} />
              Review & Approve Demo Post
            </button>
          </div>
        </div>

        {/* Right Column: Realistic Post Preview Cards */}
        <div className="demo-preview-column">
          <div className="demo-panel-card">
            <h4>📱 Realistic Mock Platform Preview</h4>
            <div className="demo-mock-phone-frame">
              {activePreviewTab === "linkedin" && (
                <div className="mock-linkedin-card">
                  <div className="mock-author-header">
                    <div className="mock-avatar">A</div>
                    <div>
                      <strong>AdaL-Nexus Official</strong>
                      <p>AI Browser & Research Automation · 1d</p>
                    </div>
                  </div>
                  <p className="mock-caption-body">{captions.linkedin}</p>
                  <img
                    src={sampleTemplates[selectedTemplate].imageUrl}
                    alt="Post"
                    className="mock-post-image"
                  />
                  <div className="mock-post-footer">
                    <span>👍 42 · 💬 8 comments</span>
                    <span className="demo-watermark-pill">DEMO — NOT PUBLISHED</span>
                  </div>
                </div>
              )}

              {activePreviewTab === "twitter" && (
                <div className="mock-twitter-card">
                  <div className="mock-author-header">
                    <div className="mock-avatar twitter">X</div>
                    <div>
                      <strong>AdaL-Nexus</strong>
                      <span>@adalnexus</span>
                    </div>
                  </div>
                  <p className="mock-caption-body">{captions.twitter}</p>
                  <img
                    src={sampleTemplates[selectedTemplate].imageUrl}
                    alt="Post"
                    className="mock-post-image"
                  />
                  <div className="mock-post-footer">
                    <span>🔄 18 · ❤️ 95</span>
                    <span className="demo-watermark-pill">DEMO — NOT PUBLISHED</span>
                  </div>
                </div>
              )}

              {activePreviewTab === "instagram" && (
                <div className="mock-instagram-card">
                  <div className="mock-author-header">
                    <div className="mock-avatar ig">A</div>
                    <div>
                      <strong>adal.nexus</strong>
                      <p>Bengaluru, India</p>
                    </div>
                  </div>
                  <img
                    src={sampleTemplates[selectedTemplate].imageUrl}
                    alt="Post"
                    className="mock-post-image"
                  />
                  <div className="mock-caption-body">
                    <strong>adal.nexus</strong> {captions.instagram}
                  </div>
                  <div className="mock-post-footer">
                    <span className="demo-watermark-pill">DEMO — NOT PUBLISHED</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Local Demo Activity Feed */}
      <div className="demo-activity-feed-section">
        <div className="demo-section-header">
          <ClockIcon size={16} />
          <h3>Demo Presentation Activity Feed</h3>
        </div>
        <div className="demo-feed-list">
          {activityFeed.map((post) => (
            <div key={post.id} className="demo-feed-item-card">
              <div className="demo-feed-item-top">
                <div className="demo-id-badge">
                  <CheckCircleIcon size={14} />
                  <span>{post.id}</span>
                </div>
                <span className="demo-timestamp">{post.timestamp}</span>
                <span className="demo-not-published-flag">DEMO — NOT PUBLISHED</span>
              </div>
              <div className="demo-feed-content">
                <img src={post.imageUrl} alt="post" className="demo-feed-thumb" />
                <div className="demo-feed-meta">
                  <p className="demo-feed-caption-snippet">"{post.captions.linkedin}"</p>
                  <div className="demo-feed-links">
                    <span className="demo-url-label">Simulated URLs:</span>
                    <code>{post.demoUrls.linkedin}</code>
                    <code>{post.demoUrls.twitter}</code>
                    <code>{post.demoUrls.instagram}</code>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Human-in-the-Loop Demo Approval Modal */}
      {showApprovalModal && (
        <div className="demo-modal-overlay">
          <div className="demo-modal-content">
            <div className="demo-modal-header">
              <AlertTriangleIcon size={24} className="warning-icon" />
              <h3>Human-in-the-Loop Approval Gate</h3>
            </div>
            <p className="demo-modal-desc">
              AdaL-Nexus strictly requires human confirmation before simulating any multi-platform post publication.
            </p>

            <div className="demo-modal-summary">
              <div>
                <strong>Selected Platforms:</strong> LinkedIn, X, Instagram
              </div>
              <div>
                <strong>Asset:</strong> {sampleTemplates[selectedTemplate].imageName}
              </div>
              <div>
                <strong>Mode:</strong> Safe Presentation Sandbox (No live networks)
              </div>
            </div>

            <label className="demo-confirm-checkbox">
              <input
                type="checkbox"
                checked={confirmedOwnership}
                onChange={(e) => setConfirmedOwnership(e.target.checked)}
              />
              <span>I confirm approval to record this simulated post in the demo presentation feed.</span>
            </label>

            <div className="demo-modal-actions">
              <button
                type="button"
                className="demo-btn-cancel"
                onClick={() => setShowApprovalModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="demo-btn-confirm"
                disabled={!confirmedOwnership || isPublishing}
                onClick={handleApproveAndPublish}
              >
                {isPublishing ? "Simulating Publication..." : "Confirm & Record Demo Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
