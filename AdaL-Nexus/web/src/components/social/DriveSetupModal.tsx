import React from "react";
import type { DriveConfigStatus } from "../../../../src/server/social/types";
import { DriveIcon, ExternalLinkIcon, ShieldIcon, XCircleIcon } from "../Icons";

interface DriveSetupModalProps {
  status: DriveConfigStatus | null;
  onClose: () => void;
}

export function DriveSetupModal({ status, onClose }: DriveSetupModalProps) {
  const steps = [
    {
      title: "Enable Required APIs in Google Cloud Console",
      detail:
        "Open console.cloud.google.com, create or select your project, and enable both the 'Google Picker API' and the 'Google Drive API' under APIs & Services > Library.",
    },
    {
      title: "Configure OAuth Consent Screen",
      detail:
        "Under Google Auth Platform / OAuth consent screen, select User Type (External or Internal). Fill in the application name and support email. Add your account email under 'Test users' while in Testing mode.",
    },
    {
      title: "Create OAuth 2.0 Web Client ID",
      detail:
        "Under APIs & Services > Credentials, click Create Credentials > OAuth client ID. Select 'Web application'. In Authorized JavaScript origins, add your exact origins:\n• Local development: http://localhost:5173\n• Production: https://your-production-domain.com",
    },
    {
      title: "Create Restricted Browser API Key",
      detail:
        "Click Create Credentials > API Key. Restrict the key to 'Google Picker API' and 'Google Drive API'. Under Website restrictions (HTTP referrers), add your app origin (http://localhost:5173/*) and https://docs.google.com/* (required by Google Picker guidance).",
    },
    {
      title: "Obtain Google Cloud Project Number",
      detail:
        "In the Google Cloud Console Dashboard or Project Settings, copy the numeric 'Project number'. This serves as the App ID for the Google Picker.",
    },
    {
      title: "Set Environment Variables & Rebuild",
      detail:
        "Add VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, and VITE_GOOGLE_APP_ID to your .env file in the project root. Rebuild or restart the Vite dev server.",
    },
  ];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="drive-modal-title">
      <div className="modal-content glass-card drive-modal-card">
        <div className="modal-header">
          <div className="modal-title-row">
            <div className="modal-icon-badge">
              <DriveIcon size={24} />
            </div>
            <div>
              <h3 id="drive-modal-title" className="modal-heading">
                Google Drive &amp; Picker Setup Guide
              </h3>
              <p className="modal-subheading">
                Step-by-step instructions to configure Google Identity Services and Google Picker in your own Google Cloud project.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close setup instructions"
          >
            <XCircleIcon size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="drive-setup-notice">
            <ShieldIcon size={18} />
            <div>
              <strong>Security Invariants:</strong>
              <div>
                • Browser-facing identifiers (Client ID, API Key, Project Number) are public identifiers and must <em>never</em> contain a Client Secret.
              </div>
              <div>
                • Token access uses the narrowest scope: <code>https://www.googleapis.com/auth/drive.file</code> (only user-selected files).
              </div>
              <div>
                • Direct authorized byte retrieval stays strictly in browser memory. Tokens are never sent to Gemini or logged.
              </div>
            </div>
          </div>

          <h4 className="drive-steps-title">Configuration Steps:</h4>
          <ol className="drive-steps-list">
            {steps.map((step, idx) => (
              <li key={idx} className="drive-step-item">
                <span className="step-num">{idx + 1}</span>
                <div className="step-content-box">
                  <span className="step-title-text">{step.title}</span>
                  <p className="step-detail-text">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="drive-env-box">
            <div className="env-header">Required Environment Variables in .env:</div>
            <code>VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com</code>
            <code>VITE_GOOGLE_API_KEY=your_restricted_browser_api_key</code>
            <code>VITE_GOOGLE_APP_ID=your_numeric_project_number</code>
          </div>

          <div className="drive-docs-links">
            <span className="docs-links-title">Official Google Documentation:</span>
            <div className="links-row">
              <a
                href="https://developers.google.com/workspace/drive/picker/guides/web-picker"
                target="_blank"
                rel="noreferrer noopener"
                className="docs-link"
              >
                <span>Google Drive Web Picker Guide</span>
                <ExternalLinkIcon size={14} />
              </a>
              <a
                href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth"
                target="_blank"
                rel="noreferrer noopener"
                className="docs-link"
              >
                <span>Google Drive API-Specific Auth Guide</span>
                <ExternalLinkIcon size={14} />
              </a>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="action-btn secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
