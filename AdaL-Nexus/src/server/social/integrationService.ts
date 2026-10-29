import crypto from "node:crypto";
import { MockInstagramPublishingProvider } from "./mockInstagramProvider.js";
import { ConflictError, SocialStore } from "./socialStore.js";
import type {
  ApproveDraftRequest,
  ApprovedDraftRecord,
  DriveConfigStatus,
  InstagramConfigStatus,
  MockPublishRequest,
  PublishingAttemptRecord,
  SocialIntegrationStatus,
} from "./types.js";

/** Provider boundary interface for Google Drive asset selection */
export interface DriveProvider {
  isConfigured(): boolean;
  getClientId?(): string | null;
}

export interface IntegrationServiceOptions {
  env?: NodeJS.ProcessEnv;
  store?: SocialStore;
  mockProvider?: MockInstagramPublishingProvider;
  publishingProvider?: string;
}

export class IntegrationService {
  private readonly driveClientId: string | null;
  private readonly instagramAccountType: "personal" | "business" | "creator" | "none";
  private readonly publishingProvider: string;
  private readonly approvedDrafts = new Map<string, ApprovedDraftRecord>();

  readonly store: SocialStore;
  readonly mockProvider: MockInstagramPublishingProvider;

  constructor(envOrOptions?: NodeJS.ProcessEnv | IntegrationServiceOptions) {
    let env: NodeJS.ProcessEnv;
    let options: IntegrationServiceOptions = {};

    if (
      envOrOptions &&
      ("store" in envOrOptions || "mockProvider" in envOrOptions || "publishingProvider" in envOrOptions)
    ) {
      options = envOrOptions as IntegrationServiceOptions;
      env = options.env ?? process.env;
    } else {
      env = (envOrOptions as NodeJS.ProcessEnv) ?? process.env;
    }

    this.driveClientId = (env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "").trim() || null;
    this.instagramAccountType = "personal";
    this.publishingProvider =
      options.publishingProvider ?? (env.SOCIAL_PUBLISHING_PROVIDER || "").trim().toLowerCase();

    this.store = options.store ?? new SocialStore();
    this.mockProvider =
      options.mockProvider ??
      new MockInstagramPublishingProvider({ configuredProvider: this.publishingProvider });
  }

  getDriveStatus(): DriveConfigStatus {
    const configured = Boolean(this.driveClientId);
    return {
      configured,
      clientIdPresent: configured,
      message: configured
        ? "Google Cloud OAuth credentials detected. Google Drive Picker ready."
        : "Google Drive integration is not configured. Local upload is available.",
      setupInstructions: {
        title: "Google Drive OAuth & Picker Setup",
        steps: [
          "Enable Google Picker API and Google Drive API in your Google Cloud Console project.",
          "Configure Google Auth Platform / OAuth consent screen (External or Internal) and add test users.",
          "Create a Web OAuth 2.0 Client ID with Authorized JavaScript Origins (e.g. http://localhost:5173 for local dev; your production URL for prod).",
          "Create an API key restricted to Google Picker API and Google Drive API, with website origin restrictions including your app origin and https://docs.google.com/*.",
          "Obtain your numeric Google Cloud Project Number to use as the Picker App ID.",
          "Configure VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, and VITE_GOOGLE_APP_ID in your .env file and restart/rebuild.",
        ],
      },
    };
  }

  getInstagramStatus(): InstagramConfigStatus {
    const isMock = this.publishingProvider === "mock";
    return {
      connected: false,
      accountType: this.instagramAccountType,
      accountHandle: "@adal.nexus",
      publishingEligible: false,
      publishingMode: isMock ? "mock" : "disabled",
      provider: isMock ? "mock" : "none",
      message:
        "Direct API publishing is unavailable: Personal Instagram accounts are not supported by the Meta Graph API. " +
        "Meta platform rules require an Instagram Professional account (Creator or Business) connected to a Facebook Page. " +
        (isMock
          ? "Safe mock publishing simulation is active (zero external network requests)."
          : "Publishing is disabled."),
      requirements: [
        "Instagram Creator or Business Account",
        "Associated Facebook Business Page",
        "Meta Developer App with 'instagram_content_publish' permission",
        "Meta Graph API long-lived user access token",
      ],
    };
  }

  getStatus(): SocialIntegrationStatus {
    return {
      drive: this.getDriveStatus(),
      instagram: this.getInstagramStatus(),
    };
  }

  async approveDraft(req: ApproveDraftRequest): Promise<ApprovedDraftRecord> {
    if (!req.ownershipConfirmed) {
      throw new Error("You must confirm content ownership or authorization before approving the draft.");
    }
    if (!req.image?.fileName) {
      throw new Error("An image must be selected to approve a draft.");
    }
    if (!req.caption?.trim()) {
      throw new Error("A caption is required to approve a draft.");
    }

    const id = req.draftId || crypto.randomUUID();
    const approvedAt = new Date().toISOString();

    const record: ApprovedDraftRecord = {
      id,
      image: {
        fileName: req.image.fileName,
        mimeType: req.image.mimeType || "image/jpeg",
        fileSize: req.image.fileSize,
        source: req.image.source || "local",
        ...(req.image.driveFileId ? { driveFileId: req.image.driveFileId } : {}),
      },
      caption: req.caption.trim(),
      hashtags: Array.isArray(req.hashtags) ? req.hashtags : [],
      callToAction: req.callToAction?.trim(),
      status: "approved",
      approvedAt,
      ownershipConfirmed: true,
      publishingStatus: "unavailable_personal_account",
    };

    // 1. Persist draft to durable storage
    await this.store.saveDraft(record);

    // 2. Await draft-approval audit write. If it fails, roll back draft
    // persistence and memory state to avoid inconsistent partially-audited state.
    try {
      await this.store.appendAudit({
        eventId: `audit_appr_${crypto.randomUUID()}`,
        timestamp: approvedAt,
        action: "social.draft.approved",
        draftId: id,
        details: {
          imageSource: record.image.source,
          captionLength: record.caption.length,
          hashtagCount: record.hashtags.length,
        },
      });
    } catch (auditErr: any) {
      // Rollback draft from disk and memory so no inconsistent state remains
      await this.store.deleteDraft(id).catch(() => {});
      this.approvedDrafts.delete(id);

      const sanitizedMsg = auditErr instanceof Error ? auditErr.message : "Unknown audit write failure";
      const err = new Error(`Draft approval audit write failed: ${sanitizedMsg}`);
      (err as any).statusCode = 500;
      (err as any).code = "AUDIT_WRITE_FAILED";
      throw err;
    }

    this.approvedDrafts.set(id, record);
    return record;
  }

  getApprovedDraft(id: string): ApprovedDraftRecord | undefined {
    return this.approvedDrafts.get(id);
  }

  async getDraft(id: string): Promise<ApprovedDraftRecord | null> {
    const mem = this.approvedDrafts.get(id);
    if (mem) return mem;
    return this.store.getDraft(id);
  }

  /**
   * Safe mock publishing workflow (Phase 3A).
   * Enforces strict fail-closed security, explicit user confirmation,
   * scoped idempotency keys, single-process mutex lock per draft, and zero external network calls.
   */
  async publishMockDraft(req: MockPublishRequest): Promise<PublishingAttemptRecord> {
    // 1. Fail closed if mock provider is not explicitly enabled
    if (this.publishingProvider !== "mock") {
      const err = new Error(
        "Social publishing provider is unconfigured or not in mock mode. Live Instagram posting is not supported for Personal accounts."
      );
      (err as any).statusCode = 503;
      (err as any).code = "MOCK_PROVIDER_DISABLED";
      throw err;
    }

    // 2. Explicit confirmation required
    if (!req.confirmedPublish) {
      const err = new Error("Explicit user confirmation is required to simulate publishing");
      (err as any).statusCode = 400;
      (err as any).code = "PUBLISH_CONFIRMATION_REQUIRED";
      throw err;
    }

    // 3. Draft ID required
    const draftId = req.draftId?.trim();
    if (!draftId) {
      const err = new Error("Draft ID is required to simulate publishing");
      (err as any).statusCode = 400;
      (err as any).code = "DRAFT_ID_REQUIRED";
      throw err;
    }

    const cleanIdempotencyKey = req.idempotencyKey?.trim() || undefined;

    // 4. Acquire single-process draft lock and idempotency lock (prevents concurrent duplicate attempts)
    this.store.acquireDraftLock(draftId);
    let idempotencyLocked = false;
    if (cleanIdempotencyKey) {
      try {
        this.store.acquireIdempotencyLock(cleanIdempotencyKey, draftId);
        idempotencyLocked = true;
      } catch (lockErr) {
        this.store.releaseDraftLock(draftId);
        throw lockErr;
      }
    }

    try {
      // 5. Idempotency check: if an attempt with this key already completed, verify draftId scope
      if (cleanIdempotencyKey) {
        const existing = await this.store.findAttemptByIdempotencyKey(cleanIdempotencyKey);
        if (existing) {
          if (existing.draftId !== draftId) {
            throw new ConflictError(
              `Idempotency key '${cleanIdempotencyKey}' was already used for a different draft`
            );
          }
          // Same-draft, same-key replay: return existing attempt without re-executing
          return existing;
        }
      }

      // 6. Look up draft (in-memory or disk)
      let draft = this.approvedDrafts.get(draftId) || (await this.store.getDraft(draftId));
      if (!draft) {
        const err = new Error(`Approved draft '${draftId}' not found`);
        (err as any).statusCode = 404;
        (err as any).code = "DRAFT_NOT_FOUND";
        throw err;
      }

      // 7. Prevent re-publishing an already succeeded draft
      if (draft.publishingStatus === "succeeded_mock") {
        const err = new ConflictError(
          `Draft '${draftId}' has already been successfully mock-published (attempt: ${draft.latestAttemptId || "unknown"})`
        );
        throw err;
      }

      // 8. Create new publishing attempt record
      const existingAttempts = await this.store.getAttemptsForDraft(draft.id);
      const attemptNumber = existingAttempts.length + 1;
      const attemptId = `mock_att_${crypto.randomUUID().replace(/-/g, "")}`;
      const correlationId = `audit_pub_${crypto.randomUUID().replace(/-/g, "")}`;
      const now = new Date().toISOString();

      const attempt: PublishingAttemptRecord = {
        attemptId,
        draftId: draft.id,
        provider: "mock",
        state: "processing",
        createdAt: now,
        updatedAt: now,
        attemptNumber,
        idempotencyKey: req.idempotencyKey?.trim() || undefined,
        auditCorrelationId: correlationId,
      };

      // Persist attempt in processing state
      await this.store.saveAttempt(attempt);
      await this.store.appendAudit({
        eventId: correlationId,
        timestamp: now,
        action: "social.mock_publish.started",
        draftId: draft.id,
        attemptId,
        details: { attemptNumber, provider: "mock" },
      });

      // 9. Execute mock provider simulation
      try {
        const result = await this.mockProvider.publish({ draft, attemptId });

        attempt.state = "succeeded_mock";
        attempt.result = result;
        attempt.updatedAt = new Date().toISOString();
        await this.store.saveAttempt(attempt);

        // Update draft status
        draft.publishingStatus = "succeeded_mock";
        draft.latestAttemptId = attemptId;
        this.approvedDrafts.set(draft.id, draft);
        await this.store.saveDraft(draft);

        await this.store.appendAudit({
          eventId: `audit_succ_${crypto.randomUUID().replace(/-/g, "")}`,
          timestamp: attempt.updatedAt,
          action: "social.mock_publish.succeeded",
          draftId: draft.id,
          attemptId,
          details: {
            mockPermalink: result.mockPermalink,
            simulatedPostId: result.simulatedPostId,
          },
        });

        return attempt;
      } catch (execErr: any) {
        attempt.state = "failed";
        attempt.error = {
          code: execErr.code || "MOCK_PUBLISH_FAILED",
          message: execErr.message || String(execErr),
        };
        attempt.updatedAt = new Date().toISOString();
        await this.store.saveAttempt(attempt);

        draft.publishingStatus = "failed_mock";
        draft.latestAttemptId = attemptId;
        this.approvedDrafts.set(draft.id, draft);
        await this.store.saveDraft(draft);

        await this.store.appendAudit({
          eventId: `audit_fail_${crypto.randomUUID().replace(/-/g, "")}`,
          timestamp: attempt.updatedAt,
          action: "social.mock_publish.failed",
          draftId: draft.id,
          attemptId,
          details: { error: attempt.error },
        });

        throw execErr;
      }
    } finally {
      // Release single-process locks
      if (cleanIdempotencyKey && idempotencyLocked) {
        this.store.releaseIdempotencyLock(cleanIdempotencyKey);
      }
      this.store.releaseDraftLock(draftId);
    }
  }

  async getAttempt(attemptId: string): Promise<PublishingAttemptRecord | null> {
    return this.store.getAttempt(attemptId);
  }

  async getAttemptsForDraft(draftId: string): Promise<PublishingAttemptRecord[]> {
    return this.store.getAttemptsForDraft(draftId);
  }
}
