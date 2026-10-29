import React from "react";
import { CheckCircleIcon, PuzzleIcon, ShieldIcon, SparklesIcon, XIcon } from "../Icons";

interface ExtensionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExtensionsModal({ isOpen, onClose }: ExtensionsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card extensions-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <PuzzleIcon size={20} className="text-glow-purple" />
            <h2 className="modal-title">Browser Extensions &amp; Shields</h2>
          </div>
          <button type="button" className="btn-modal-close" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="modal-list-body">
          <div className="extension-card-item active">
            <div className="ext-icon-box purple">
              <SparklesIcon size={20} />
            </div>
            <div className="ext-meta">
              <div className="ext-title-row">
                <strong>AdaL AI Research Copilot</strong>
                <span className="ext-status-pill active">Built-in Active</span>
              </div>
              <p>Autonomous task planning, page evidence extraction, and Excel workbook compilation.</p>
            </div>
          </div>

          <div className="extension-card-item active">
            <div className="ext-icon-box green">
              <ShieldIcon size={20} />
            </div>
            <div className="ext-meta">
              <div className="ext-title-row">
                <strong>Chromium Sandbox &amp; Scheme Shield</strong>
                <span className="ext-status-pill active">Protected</span>
              </div>
              <p>Blocks dangerous protocols (`javascript:`, `file:`, `data:`) and enforces strict isolated WebContentsView.</p>
            </div>
          </div>

          <div className="extension-card-item active">
            <div className="ext-icon-box blue">
              <CheckCircleIcon size={20} />
            </div>
            <div className="ext-meta">
              <div className="ext-title-row">
                <strong>Pop-up &amp; Navigation Guard</strong>
                <span className="ext-status-pill active">Enforced</span>
              </div>
              <p>Intercepts untracked popups and routes external tabs safely inside AdaL-Nexus.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
