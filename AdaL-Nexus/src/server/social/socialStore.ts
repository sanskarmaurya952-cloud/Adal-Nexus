import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ApprovedDraftRecord,
  LinkedInAccountRecord,
  LinkedInOAuthStateRecord,
  PublishingAttemptRecord,
  SocialAuditEvent,
} from "./types.js";

export class ConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class SocialStore {
  readonly baseDir: string;
  readonly draftsDir: string;
  readonly attemptsDir: string;
  readonly auditLogPath: string;

  // In-memory locks for single-process concurrency control.
  // Note: Supports a single Node.js process only; does not provide distributed cross-process locking.
  private readonly draftLocks = new Set<string>();
  private readonly idempotencyLocks = new Map<string, string>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), "data", "social");
    this.draftsDir = path.join(this.baseDir, "drafts");
    this.attemptsDir = path.join(this.baseDir, "publishing_attempts");
    this.auditLogPath = path.join(this.baseDir, "audit.log");
  }

  /** Ensures underlying storage directories exist */
  async ensureDirs(): Promise<void> {
    await fs.promises.mkdir(this.draftsDir, { recursive: true });
    await fs.promises.mkdir(this.attemptsDir, { recursive: true });
  }

  /**
   * Safe atomic write using temporary file and atomic rename.
   * Guarantees file integrity across abrupt process terminations.
   * Wrapped in try/finally to remove temp file if write or rename fails.
   */
  private async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tempFile = `${filePath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
    const payload = JSON.stringify(data, null, 2);
    let success = false;
    try {
      await fs.promises.writeFile(tempFile, payload, "utf8");
      await fs.promises.rename(tempFile, filePath);
      success = true;
    } finally {
      if (!success) {
        try {
          await fs.promises.unlink(tempFile);
        } catch {
          // Ignore error if tempFile was not created or already unlinked
        }
      }
    }
  }

  /** Draft lock management for preventing concurrent execution */
  acquireDraftLock(draftId: string): void {
    if (this.draftLocks.has(draftId)) {
      throw new ConflictError(`A publishing attempt is already in progress for draft '${draftId}'`);
    }
    this.draftLocks.add(draftId);
  }

  releaseDraftLock(draftId: string): void {
    this.draftLocks.delete(draftId);
  }

  isDraftLocked(draftId: string): boolean {
    return this.draftLocks.has(draftId);
  }

  /**
   * Idempotency key lock management for preventing concurrent requests
   * from reusing the same idempotency key across different drafts.
   */
  acquireIdempotencyLock(key: string, draftId: string): void {
    const activeDraftId = this.idempotencyLocks.get(key);
    if (activeDraftId) {
      if (activeDraftId !== draftId) {
        throw new ConflictError(`Idempotency key '${key}' was already used for a different draft`);
      }
      throw new ConflictError(`A publishing attempt with idempotency key '${key}' is already in progress`);
    }
    this.idempotencyLocks.set(key, draftId);
  }

  releaseIdempotencyLock(key: string): void {
    this.idempotencyLocks.delete(key);
  }

  // --- Draft Operations ---

  async saveDraft(draft: ApprovedDraftRecord): Promise<void> {
    await this.ensureDirs();
    const filePath = path.join(this.draftsDir, `${draft.id}.json`);
    await this.atomicWriteJson(filePath, draft);
  }

  async getDraft(draftId: string): Promise<ApprovedDraftRecord | null> {
    const filePath = path.join(this.draftsDir, `${draftId}.json`);
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      return JSON.parse(content) as ApprovedDraftRecord;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async deleteDraft(draftId: string): Promise<void> {
    const filePath = path.join(this.draftsDir, `${draftId}.json`);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }
  }

  async listDrafts(): Promise<ApprovedDraftRecord[]> {
    await this.ensureDirs();
    const files = await fs.promises.readdir(this.draftsDir);
    const drafts: ApprovedDraftRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.promises.readFile(path.join(this.draftsDir, file), "utf8");
        drafts.push(JSON.parse(content) as ApprovedDraftRecord);
      } catch {
        // Ignore unreadable/corrupt files during listing
      }
    }
    return drafts.sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime());
  }

  // --- Publishing Attempt Operations ---

  async saveAttempt(attempt: PublishingAttemptRecord): Promise<void> {
    await this.ensureDirs();
    const filePath = path.join(this.attemptsDir, `${attempt.attemptId}.json`);
    await this.atomicWriteJson(filePath, attempt);
  }

  async getAttempt(attemptId: string): Promise<PublishingAttemptRecord | null> {
    const filePath = path.join(this.attemptsDir, `${attemptId}.json`);
    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      return JSON.parse(content) as PublishingAttemptRecord;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async listAttempts(): Promise<PublishingAttemptRecord[]> {
    await this.ensureDirs();
    const files = await fs.promises.readdir(this.attemptsDir);
    const attempts: PublishingAttemptRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.promises.readFile(path.join(this.attemptsDir, file), "utf8");
        attempts.push(JSON.parse(content) as PublishingAttemptRecord);
      } catch {
        // Ignore unreadable/corrupt files during listing
      }
    }
    return attempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getAttemptsForDraft(draftId: string): Promise<PublishingAttemptRecord[]> {
    const all = await this.listAttempts();
    return all.filter((a) => a.draftId === draftId);
  }

  async getLatestAttemptForDraft(draftId: string): Promise<PublishingAttemptRecord | null> {
    const draftAttempts = await this.getAttemptsForDraft(draftId);
    return draftAttempts.length > 0 ? draftAttempts[0] : null;
  }

  async findAttemptByIdempotencyKey(key: string): Promise<PublishingAttemptRecord | null> {
    if (!key) return null;
    const all = await this.listAttempts();
    return all.find((a) => a.idempotencyKey === key) || null;
  }

  // --- Audit Logging ---

  async appendAudit(event: SocialAuditEvent): Promise<void> {
    const dir = path.dirname(this.auditLogPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    await fs.promises.appendFile(this.auditLogPath, line, "utf8");
  }

  async readAuditLog(): Promise<SocialAuditEvent[]> {
    try {
      const content = await fs.promises.readFile(this.auditLogPath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line) as SocialAuditEvent);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  // --- Startup Reconciliation ---

  /**
   * Reconciles any dangling attempts left in "processing" or "pending"
   * from an ungraceful server termination.
   */
  async reconcileStartupState(): Promise<number> {
    await this.ensureDirs();
    const attempts = await this.listAttempts();
    let reconciledCount = 0;

    for (const attempt of attempts) {
      if (attempt.state === "processing" || attempt.state === "pending") {
        attempt.state = "unknown";
        attempt.error = {
          code: "SERVER_RESTARTED",
          message: "Server restarted while publishing attempt was in progress",
        };
        attempt.updatedAt = new Date().toISOString();
        await this.saveAttempt(attempt);

        // Update draft if needed
        const draft = await this.getDraft(attempt.draftId);
        if (draft && draft.publishingStatus !== "succeeded_mock") {
          draft.publishingStatus = "failed_mock";
          draft.latestAttemptId = attempt.attemptId;
          await this.saveDraft(draft);
        }

        await this.appendAudit({
          eventId: `audit_rec_${crypto.randomUUID()}`,
          timestamp: new Date().toISOString(),
          action: "social.startup.reconciled",
          draftId: attempt.draftId,
          attemptId: attempt.attemptId,
          details: {
            previousState: "processing",
            newState: "unknown",
            reason: "Server restart recovery",
          },
        });
        reconciledCount++;
      }
    }

    return reconciledCount;
  }

  // --- LinkedIn Account & OAuth State Storage ---

  private get linkedInAccountPath(): string {
    return path.join(this.baseDir, "linkedin_account.json");
  }

  private get oauthStatesDir(): string {
    return path.join(this.baseDir, "oauth_states");
  }

  async saveLinkedInAccount(account: LinkedInAccountRecord): Promise<void> {
    await this.ensureDirs();
    await this.atomicWriteJson(this.linkedInAccountPath, account);
  }

  async getLinkedInAccount(): Promise<LinkedInAccountRecord | null> {
    try {
      if (!fs.existsSync(this.linkedInAccountPath)) return null;
      const content = await fs.promises.readFile(this.linkedInAccountPath, "utf-8");
      return JSON.parse(content) as LinkedInAccountRecord;
    } catch {
      return null;
    }
  }

  async clearLinkedInAccount(): Promise<void> {
    try {
      if (fs.existsSync(this.linkedInAccountPath)) {
        await fs.promises.unlink(this.linkedInAccountPath);
      }
    } catch {}
  }

  async saveOAuthState(state: string, ttlMs: number = 600000): Promise<void> {
    await fs.promises.mkdir(this.oauthStatesDir, { recursive: true });
    const filePath = path.join(this.oauthStatesDir, `${state}.json`);
    const record: LinkedInOAuthStateRecord = {
      state,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    await this.atomicWriteJson(filePath, record);
  }

  async verifyAndConsumeOAuthState(state: string): Promise<boolean> {
    if (!state || typeof state !== "string") return false;
    // Prevent directory traversal
    const safeName = path.basename(state);
    const filePath = path.join(this.oauthStatesDir, `${safeName}.json`);

    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const record = JSON.parse(raw) as LinkedInOAuthStateRecord;

      // Always consume / delete state after check to prevent replay attacks
      await fs.promises.unlink(filePath).catch(() => {});

      if (Date.now() > record.expiresAt) {
        return false;
      }
      return record.state === state;
    } catch {
      return false;
    }
  }
}
