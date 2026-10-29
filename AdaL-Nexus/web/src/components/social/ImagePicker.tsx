import React, { useRef, useState } from "react";
import type { DriveConfigStatus } from "../../../../src/server/social/types";
import { AlertTriangleIcon, CameraIcon, DriveIcon, TrashIcon, UploadIcon } from "../Icons";
import { googleDriveService, type DrivePickerState } from "./googleDriveService";

export interface SelectedMedia {
  file?: File;
  previewUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType: string;
  source: "local" | "drive";
  driveFileId?: string;
}

interface ImagePickerProps {
  selectedImage: SelectedMedia | null;
  onImageSelect: (image: SelectedMedia | null) => void;
  driveStatus: DriveConfigStatus | null;
  onOpenDriveSetup: () => void;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function formatBytes(bytes?: number): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImagePicker({
  selectedImage,
  onImageSelect,
  driveStatus,
  onOpenDriveSetup,
}: ImagePickerProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveState, setDriveState] = useState<DrivePickerState>("ready");
  const [driveDetail, setDriveDetail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check whether Google Drive credentials are configured on the client
  const isDriveConfigured = googleDriveService.isConfigured() || Boolean(driveStatus?.configured);

  const validateAndProcessFile = (file: File) => {
    setError(null);
    setDriveDetail(null);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError(`Unsupported format (${file.type || "unknown"}). Please upload a JPEG, PNG, or WebP image.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File size exceeds 10 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    onImageSelect({
      file,
      previewUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      source: "local",
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndProcessFile(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndProcessFile(file);
    }
  };

  const handleRemove = () => {
    if (selectedImage?.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(selectedImage.previewUrl);
    }
    onImageSelect(null);
    setError(null);
    setDriveDetail(null);
    setDriveState("ready");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePickFromDrive = async () => {
    if (!isDriveConfigured) {
      onOpenDriveSetup();
      return;
    }

    setError(null);
    setDriveDetail(null);
    try {
      const file = await googleDriveService.pickImage((state, detail) => {
        setDriveState(state);
        setDriveDetail(detail || null);
      });

      if (file) {
        onImageSelect({
          previewUrl: file.previewUrl,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          source: "drive",
          driveFileId: file.fileId,
        });
        setDriveState("file_selected");
        setDriveDetail(null);
      } else {
        setDriveState("ready");
      }
    } catch (err) {
      setDriveState("error");
      setError(err instanceof Error ? err.message : "Failed to select file from Google Drive");
    }
  };

  const isDriveBusy = driveState === "authorizing" || driveState === "picker_open";

  return (
    <div className="glass-card social-card image-picker-card">
      <div className="social-card-header">
        <div className="social-card-title-wrap">
          <CameraIcon size={20} className="social-accent-icon" />
          <h3 className="social-card-title">1. Visual Asset</h3>
        </div>
        <span className="social-card-badge">Required</span>
      </div>

      <p className="social-card-desc">
        Select a high-resolution image for your Instagram post. Upload a local asset or choose directly from your Google Drive.
      </p>

      {/* Hidden File Input for Local Upload */}
      <input
        id="local-file-input"
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {error && (
        <div className="social-error-banner" role="alert">
          <AlertTriangleIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      {driveDetail && isDriveBusy && (
        <div className="social-info-banner" role="status">
          <span className="spinner-border sm" />
          <span>{driveDetail}</span>
        </div>
      )}

      {!selectedImage ? (
        <div className="image-drop-area-container">
          <div
            className={`image-drop-zone ${dragActive ? "drag-active" : ""}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
          >
            <div className="drop-icon-circle">
              <UploadIcon size={28} />
            </div>
            <div className="drop-text-content">
              <span className="drop-primary-text">Click to upload or drag &amp; drop</span>
              <span className="drop-secondary-text">PNG, JPG, or WebP up to 10 MB</span>
            </div>
          </div>

          <div className="image-source-divider">
            <span>OR</span>
          </div>

          {/* Google Drive Option */}
          <div className="drive-option-card">
            <div className="drive-option-info">
              <div className="drive-icon-badge">
                <DriveIcon size={20} />
              </div>
              <div className="drive-text-info">
                <span className="drive-title">Google Drive Asset Picker</span>
                <span className="drive-status-desc">
                  {isDriveConfigured
                    ? "Official Google Identity Services &amp; Web Picker"
                    : "Not configured (OAuth Client ID missing)"}
                </span>
              </div>
            </div>
            <div className="drive-action-group">
              <button
                type="button"
                className={`action-btn ${isDriveConfigured ? "primary-btn" : "secondary-btn"} drive-setup-btn`}
                onClick={handlePickFromDrive}
                disabled={isDriveBusy}
              >
                {isDriveBusy ? (
                  <>
                    <span className="spinner-border sm" />
                    <span>Opening Drive...</span>
                  </>
                ) : isDriveConfigured ? (
                  "Choose from Google Drive"
                ) : (
                  "Setup Instructions"
                )}
              </button>
              {isDriveConfigured && (
                <button
                  type="button"
                  className="setup-guide-link-btn"
                  onClick={onOpenDriveSetup}
                  title="View Google Drive setup guide and credentials"
                >
                  Guide
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="selected-image-preview-box">
          <div className="preview-thumbnail-container">
            <img
              src={selectedImage.previewUrl}
              alt={selectedImage.fileName}
              className="selected-thumbnail-img"
            />
            <span className={`image-source-tag ${selectedImage.source === "drive" ? "drive-source-tag" : ""}`}>
              {selectedImage.source === "drive" ? "Google Drive" : "Local Upload"}
            </span>
          </div>

          <div className="preview-meta-info">
            <div className="meta-row">
              <span className="meta-label">File name:</span>
              <span className="meta-value filename-val" title={selectedImage.fileName}>
                {selectedImage.fileName}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Format:</span>
              <span className="meta-value">{selectedImage.mimeType}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">File size:</span>
              <span className="meta-value">{formatBytes(selectedImage.fileSize)}</span>
            </div>
            {selectedImage.driveFileId && (
              <div className="meta-row">
                <span className="meta-label">Drive ID:</span>
                <span className="meta-value filename-val" title={selectedImage.driveFileId}>
                  {selectedImage.driveFileId}
                </span>
              </div>
            )}

            <div className="preview-action-buttons">
              <button
                type="button"
                className="action-btn secondary-btn sm-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Replace Local
              </button>
              {isDriveConfigured && (
                <button
                  type="button"
                  className="action-btn secondary-btn sm-btn"
                  onClick={handlePickFromDrive}
                  disabled={isDriveBusy}
                >
                  Replace from Drive
                </button>
              )}
              <button
                type="button"
                className="action-btn danger-btn sm-btn"
                onClick={handleRemove}
                title="Remove image"
              >
                <TrashIcon size={14} />
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
