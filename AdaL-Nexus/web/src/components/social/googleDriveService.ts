/**
 * Google Drive OAuth and Google Picker integration service.
 * Enforces client-side security invariants:
 * - Scope: https://www.googleapis.com/auth/drive.file (narrowest, file-specific access)
 * - OAuth tokens are held only in short-lived in-memory closures
 * - Tokens are NEVER persisted, NEVER sent to the backend, and NEVER sent to Gemini
 * - Image bytes are fetched directly in browser memory and validated (size <= 10MB, MIME type, magic bytes)
 */

export type DrivePickerState =
  | "not_configured"
  | "ready"
  | "authorizing"
  | "picker_open"
  | "file_selected"
  | "cancelled"
  | "denied"
  | "error";

export interface GoogleDriveConfig {
  clientId: string;
  apiKey: string;
  appId?: string;
}

export interface DriveSelectedFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  previewUrl: string;
  blob?: Blob;
}

// Ambient declarations for Google APIs loaded via CDN
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
            error_callback?: (err: unknown) => void;
          }): {
            requestAccessToken(overrideConfig?: { prompt?: string }): void;
          };
        };
      };
      picker?: {
        PickerBuilder: new () => {
          addView(view: unknown): any;
          setOAuthToken(token: string): any;
          setDeveloperKey(key: string): any;
          setAppId(appId: string): any;
          setCallback(cb: (data: any) => void): any;
          setTitle(title: string): any;
          build(): {
            setVisible(visible: boolean): void;
            dispose?(): void;
          };
        };
        DocsView: new (viewId?: string) => {
          setMimeTypes(mimeTypes: string): any;
          setMode(mode: any): any;
        };
        ViewId: {
          DOCS_IMAGES: string;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
        Response: {
          ACTION: string;
          DOCUMENTS: string;
        };
        Document: {
          ID: string;
          NAME: string;
          MIME_TYPE: string;
          SIZE_BYTES: string;
        };
      };
    };
    gapi?: {
      load(apiName: string, callbackOrConfig: { callback: () => void; onerror?: () => void } | (() => void)): void;
    };
  }
}

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GAPI_SCRIPT_URL = "https://apis.google.com/js/api.js";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Inspects image magic bytes to ensure the downloaded asset is genuinely a JPEG, PNG, or WebP. */
export async function validateImageMagicBytes(blob: Blob): Promise<boolean> {
  const buffer = await blob.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return false;

  // JPEG magic: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  // PNG magic: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  // WebP magic: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Redacts token-like strings, bearer headers, and keys from user-facing error messages. */
export function sanitizeErrorMessage(err: unknown): string {
  if (!err) return "Unknown Google Drive error";
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/AIza[a-zA-Z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
}

export class GoogleDriveService {
  private gsiLoaded = false;
  private gapiLoaded = false;
  private pickerApiLoaded = false;
  private scriptLoadingPromise: Promise<void> | null = null;

  /** Inspects environment configuration. Returns non-secret configuration status. */
  getConfig(): GoogleDriveConfig | null {
    const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    const apiKey = (import.meta.env.VITE_GOOGLE_API_KEY || "").trim();
    const appId = (import.meta.env.VITE_GOOGLE_APP_ID || "").trim();

    if (!clientId || !apiKey) {
      return null;
    }
    return {
      clientId,
      apiKey,
      appId: appId || undefined,
    };
  }

  isConfigured(): boolean {
    return this.getConfig() !== null;
  }

  /**
   * Lazily loads the Google Identity Services and Google API Client libraries.
   * Prevents duplicate script loading and handles network errors.
   */
  async loadGoogleScripts(): Promise<void> {
    if (this.gsiLoaded && this.gapiLoaded && this.pickerApiLoaded) {
      return;
    }
    if (this.scriptLoadingPromise) {
      return this.scriptLoadingPromise;
    }

    this.scriptLoadingPromise = (async () => {
      // 1. Load Google Identity Services (GIS)
      await new Promise<void>((resolve, reject) => {
        if (window.google?.accounts?.oauth2) {
          this.gsiLoaded = true;
          return resolve();
        }
        const existing = document.querySelector(`script[src="${GSI_SCRIPT_URL}"]`);
        if (existing) {
          existing.addEventListener("load", () => {
            this.gsiLoaded = true;
            resolve();
          });
          existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services script")));
          return;
        }
        const script = document.createElement("script");
        script.src = GSI_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          this.gsiLoaded = true;
          resolve();
        };
        script.onerror = () => reject(new Error("Failed to load Google Identity Services (network error)"));
        document.head.appendChild(script);
      });

      // 2. Load Google API Client (GAPI)
      await new Promise<void>((resolve, reject) => {
        if (window.gapi) {
          this.gapiLoaded = true;
          return resolve();
        }
        const existing = document.querySelector(`script[src="${GAPI_SCRIPT_URL}"]`);
        if (existing) {
          existing.addEventListener("load", () => {
            this.gapiLoaded = true;
            resolve();
          });
          existing.addEventListener("error", () => reject(new Error("Failed to load Google API Client script")));
          return;
        }
        const script = document.createElement("script");
        script.src = GAPI_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          this.gapiLoaded = true;
          resolve();
        };
        script.onerror = () => reject(new Error("Failed to load Google API Client (network error)"));
        document.head.appendChild(script);
      });

      // 3. Load Picker API via gapi
      await new Promise<void>((resolve, reject) => {
        if (window.google?.picker) {
          this.pickerApiLoaded = true;
          return resolve();
        }
        if (!window.gapi) {
          return reject(new Error("GAPI not available to load picker"));
        }
        window.gapi.load("picker", {
          callback: () => {
            this.pickerApiLoaded = true;
            resolve();
          },
          onerror: () => reject(new Error("Failed to initialize Google Picker library")),
        });
      });
    })();

    try {
      await this.scriptLoadingPromise;
    } finally {
      this.scriptLoadingPromise = null;
    }
  }

  /**
   * Prompts user for OAuth consent and opens the official Google Picker.
   * Downloads and validates the chosen image directly in browser memory.
   */
  async pickImage(
    onStateChange?: (state: DrivePickerState, detail?: string) => void,
  ): Promise<DriveSelectedFile | null> {
    const config = this.getConfig();
    if (!config) {
      onStateChange?.("not_configured");
      throw new Error("Google Drive is not configured. Missing Client ID or API Key.");
    }

    onStateChange?.("authorizing", "Loading Google scripts...");
    await this.loadGoogleScripts();

    return new Promise<DriveSelectedFile | null>((resolve, reject) => {
      onStateChange?.("authorizing", "Waiting for Google authorization...");

      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        onStateChange?.("error", "Google Identity Services not initialized");
        return reject(new Error("Google Identity Services not initialized"));
      }

      let tokenClient: { requestAccessToken(config?: { prompt?: string }): void };
      try {
        tokenClient = oauth2.initTokenClient({
          client_id: config.clientId,
          scope: DRIVE_FILE_SCOPE,
          callback: async (tokenResp) => {
            if (tokenResp.error) {
              if (tokenResp.error === "access_denied") {
                onStateChange?.("denied", "Google Drive authorization was denied by the user.");
                return resolve(null);
              }
              const msg = sanitizeErrorMessage(tokenResp.error_description || tokenResp.error);
              onStateChange?.("error", msg);
              return reject(new Error(`OAuth error: ${msg}`));
            }

            const accessToken = tokenResp.access_token;
            if (!accessToken) {
              onStateChange?.("error", "No access token returned from Google.");
              return reject(new Error("No access token received from Google."));
            }

            // Launch the Google Picker with the in-memory access token
            try {
              onStateChange?.("picker_open", "Opening Google Drive Picker...");
              await this.showPicker({
                config,
                accessToken,
                onStateChange,
                onSelected: async (selected) => {
                  resolve(selected);
                },
                onCancel: () => {
                  onStateChange?.("cancelled", "Google Drive selection was cancelled.");
                  resolve(null);
                },
                onError: (err) => {
                  const sanitized = sanitizeErrorMessage(err);
                  onStateChange?.("error", sanitized);
                  reject(new Error(sanitized));
                },
              });
            } catch (err) {
              const sanitized = sanitizeErrorMessage(err);
              onStateChange?.("error", sanitized);
              reject(new Error(sanitized));
            }
          },
          error_callback: (err) => {
            const sanitized = sanitizeErrorMessage(err);
            onStateChange?.("error", sanitized);
            reject(new Error(`Google authorization error: ${sanitized}`));
          },
        });
      } catch (err) {
        const sanitized = sanitizeErrorMessage(err);
        onStateChange?.("error", sanitized);
        return reject(new Error(`Failed to initialize token client: ${sanitized}`));
      }

      // Prompt the user for OAuth token
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }

  private async showPicker({
    config,
    accessToken,
    onStateChange,
    onSelected,
    onCancel,
    onError,
  }: {
    config: GoogleDriveConfig;
    accessToken: string;
    onStateChange?: (state: DrivePickerState, detail?: string) => void;
    onSelected: (file: DriveSelectedFile) => Promise<void>;
    onCancel: () => void;
    onError: (err: unknown) => void;
  }): Promise<void> {
    const google = window.google;
    const pickerApi = google?.picker;
    if (!google || !pickerApi) {
      throw new Error("Google Picker API is not available.");
    }

    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS_IMAGES);
    view.setMimeTypes("image/png,image/jpeg,image/webp");

    const builder = new pickerApi.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.apiKey);

    if (config.appId) {
      builder.setAppId(config.appId);
    }

    builder.setTitle("Select an Image for Instagram Draft");

    builder.setCallback(async (data: any) => {
      const action = data[pickerApi.Response.ACTION];
      if (action === pickerApi.Action.CANCEL) {
        onCancel();
        return;
      }
      if (action === pickerApi.Action.PICKED) {
        const doc = data[pickerApi.Response.DOCUMENTS]?.[0];
        if (!doc) {
          onError(new Error("No file was returned from the Picker."));
          return;
        }

        const fileId = doc[pickerApi.Document.ID];
        const fileName = doc[pickerApi.Document.NAME] || "drive_image.jpg";
        const mimeType = doc[pickerApi.Document.MIME_TYPE] || "image/jpeg";
        const sizeBytes = Number(doc[pickerApi.Document.SIZE_BYTES]) || undefined;

        if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
          onError(
            new Error(`Unsupported file type (${mimeType}). Only PNG, JPEG, and WebP images are permitted.`),
          );
          return;
        }

        if (sizeBytes && sizeBytes > MAX_FILE_SIZE_BYTES) {
          onError(
            new Error(
              `Selected file exceeds 10 MB limit (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB). Please select a smaller image.`,
            ),
          );
          return;
        }

        onStateChange?.("authorizing", "Verifying and downloading selected image...");

        // Fetch the file bytes securely from Google Drive API into memory
        try {
          const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
          const resp = await fetch(driveUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!resp.ok) {
            throw new Error(`Failed to retrieve file from Google Drive (HTTP ${resp.status}).`);
          }

          const blob = await resp.blob();

          if (blob.size > MAX_FILE_SIZE_BYTES) {
            throw new Error(
              `Selected image exceeds 10 MB limit (${(blob.size / (1024 * 1024)).toFixed(2)} MB).`,
            );
          }

          const isValidMagic = await validateImageMagicBytes(blob);
          if (!isValidMagic) {
            throw new Error("File content is not a valid JPEG, PNG, or WebP image.");
          }

          const previewUrl = URL.createObjectURL(blob);
          onStateChange?.("file_selected", fileName);

          await onSelected({
            fileId,
            fileName,
            mimeType: blob.type || mimeType,
            fileSize: blob.size,
            previewUrl,
            blob,
          });
        } catch (err) {
          onError(err);
        }
      }
    });

    const picker = builder.build();
    picker.setVisible(true);
  }
}

export const googleDriveService = new GoogleDriveService();
