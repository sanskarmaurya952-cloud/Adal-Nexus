import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { IntegrationService } from "./integrationService.js";
import { MockInstagramPublishingProvider } from "./mockInstagramProvider.js";
import { ConflictError, SocialStore } from "./socialStore.js";
import type { ApproveDraftRequest, MockPublishRequest } from "./types.js";

describe("Phase 3A: Safe Mock Instagram Publishing", () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "adal-social-test-"));
  });

  after(async () => {
    try {
      await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  function createTestFixture(options?: {
    publishingProvider?: string;
    simulatedDelayMs?: number;
    subDir?: string;
  }) {
    const storeDir = path.join(
      tempBaseDir,
      options?.subDir || `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    const store = new SocialStore(storeDir);
    const publishingProvider = options?.publishingProvider ?? "mock";
    const mockProvider = new MockInstagramPublishingProvider({
      configuredProvider: publishingProvider,
      simulatedDelayMs: options?.simulatedDelayMs ?? 10, // Short delay for fast unit tests
    });
    const service = new IntegrationService({
      store,
      mockProvider,
      publishingProvider,
    });
    return { service, store, mockProvider, storeDir };
  }

  function sampleDraftRequest(id?: string): ApproveDraftRequest {
    return {
      draftId: id,
      image: {
        fileName: "product_launch.png",
        mimeType: "image/png",
        fileSize: 102400,
        source: "local",
      },
      caption: "Introducing our next generation agentic platform! 🚀",
      hashtags: ["#AdaLNexus", "#Innovation"],
      callToAction: "Learn more in bio",
      ownershipConfirmed: true,
    };
  }

  it("fails closed when SOCIAL_PUBLISHING_PROVIDER is not 'mock'", async () => {
    const { service } = createTestFixture({ publishingProvider: "" });
    const status = service.getInstagramStatus();

    assert.equal(status.publishingMode, "disabled");
    assert.equal(status.provider, "none");
    assert.equal(status.publishingEligible, false);

    // Create an approved draft
    const draft = await service.approveDraft(sampleDraftRequest());

    // Attempting to publish must fail closed with 503
    await assert.rejects(
      async () => {
        await service.publishMockDraft({ draftId: draft.id, confirmedPublish: true });
      },
      (err: any) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, "MOCK_PROVIDER_DISABLED");
        assert.match(err.message, /not in mock mode/i);
        return true;
      }
    );
  });

  it("fails closed if provider is set to live or meta (live publishing is forbidden)", async () => {
    const { service } = createTestFixture({ publishingProvider: "meta" });
    const draft = await service.approveDraft(sampleDraftRequest());

    await assert.rejects(
      async () => {
        await service.publishMockDraft({ draftId: draft.id, confirmedPublish: true });
      },
      (err: any) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, "MOCK_PROVIDER_DISABLED");
        return true;
      }
    );
  });

  it("draft approval alone NEVER initiates or simulates publishing", async () => {
    const { service, store } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_isolated_approval"));

    assert.equal(draft.status, "approved");
    assert.equal(draft.publishingStatus, "unavailable_personal_account");
    assert.equal(draft.latestAttemptId, undefined);

    // No publishing attempts must exist
    const attempts = await store.getAttemptsForDraft(draft.id);
    assert.equal(attempts.length, 0);

    // Audit log should only contain draft approved event
    const auditLogs = await store.readAuditLog();
    assert.ok(auditLogs.some((l) => l.action === "social.draft.approved"));
    assert.ok(!auditLogs.some((l) => l.action.startsWith("social.mock_publish")));
  });

  it("requires explicit user confirmation to simulate publishing", async () => {
    const { service } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest());

    // Omitting confirmation or setting to false must be rejected with 400
    await assert.rejects(
      async () => {
        await service.publishMockDraft({ draftId: draft.id, confirmedPublish: false });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "PUBLISH_CONFIRMATION_REQUIRED");
        return true;
      }
    );
  });

  it("rejects non-existent draft ID with 404", async () => {
    const { service } = createTestFixture();
    await assert.rejects(
      async () => {
        await service.publishMockDraft({ draftId: "non_existent_draft_999", confirmedPublish: true });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, "DRAFT_NOT_FOUND");
        return true;
      }
    );
  });

  it("executes safe mock publish with internal mock:// URI and durable state", async () => {
    const { service, store } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_success_1"));

    const attempt = await service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
    });

    // Attempt verification
    assert.ok(attempt.attemptId.startsWith("mock_att_"));
    assert.equal(attempt.draftId, draft.id);
    assert.equal(attempt.provider, "mock");
    assert.equal(attempt.state, "succeeded_mock");
    assert.equal(attempt.attemptNumber, 1);
    assert.ok(attempt.result);
    assert.match(attempt.result.mockPermalink, /^mock:\/\/instagram\/p\/mock-[a-f0-9]+$/);
    assert.match(attempt.result.simulatedPostId, /^mock_post_[a-f0-9]+$/);
    assert.ok(attempt.result.simulatedAt);

    // Updated draft verification
    const updatedDraft = await service.getDraft(draft.id);
    assert.ok(updatedDraft);
    assert.equal(updatedDraft.publishingStatus, "succeeded_mock");
    assert.equal(updatedDraft.latestAttemptId, attempt.attemptId);

    // Audit log check
    const auditLogs = await store.readAuditLog();
    assert.ok(auditLogs.some((l) => l.action === "social.mock_publish.started"));
    assert.ok(auditLogs.some((l) => l.action === "social.mock_publish.succeeded"));
  });

  it("rejects subsequent publishing attempts on already mock-published draft with 409 Conflict", async () => {
    const { service } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_conflict_1"));

    await service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
    });

    // Second publish must be rejected with 409
    await assert.rejects(
      async () => {
        await service.publishMockDraft({
          draftId: draft.id,
          confirmedPublish: true,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /already been successfully mock-published/i);
        return true;
      }
    );
  });

  it("honors idempotency keys: duplicate replay returns same attempt without re-executing", async () => {
    const { service, store } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_idempotency_1"));
    const idempotencyKey = "idem_req_abc_123";

    const attempt1 = await service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
      idempotencyKey,
    });

    // Replay with exact same key on same draft
    const attempt2 = await service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
      idempotencyKey,
    });

    assert.equal(attempt1.attemptId, attempt2.attemptId);
    assert.equal(attempt1.result?.mockPermalink, attempt2.result?.mockPermalink);

    // Total attempts for this draft must be exactly 1
    const attempts = await store.getAttemptsForDraft(draft.id);
    assert.equal(attempts.length, 1);
  });

  it("Fix 1: rejects cross-draft idempotency key reuse with 409 Conflict", async () => {
    const { service } = createTestFixture();
    const draft1 = await service.approveDraft(sampleDraftRequest("draft_fix1_a"));
    const draft2 = await service.approveDraft(sampleDraftRequest("draft_fix1_b"));
    const sharedKey = "shared_idem_key_999";

    // First draft succeeds with sharedKey
    const attempt1 = await service.publishMockDraft({
      draftId: draft1.id,
      confirmedPublish: true,
      idempotencyKey: sharedKey,
    });
    assert.equal(attempt1.state, "succeeded_mock");

    // Second draft attempts to reuse sharedKey -> must be rejected with 409 Conflict
    await assert.rejects(
      async () => {
        await service.publishMockDraft({
          draftId: draft2.id,
          confirmedPublish: true,
          idempotencyKey: sharedKey,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /already used for a different draft/i);
        return true;
      }
    );
  });

  it("Fix 1: prevents concurrent cross-draft key reuse from bypassing validation", async () => {
    const { service } = createTestFixture({ simulatedDelayMs: 60 });
    const draftA = await service.approveDraft(sampleDraftRequest("draft_fix1_conc_a"));
    const draftB = await service.approveDraft(sampleDraftRequest("draft_fix1_conc_b"));
    const raceKey = "race_idem_key_456";

    // Launch publish on draftA
    const p1 = service.publishMockDraft({
      draftId: draftA.id,
      confirmedPublish: true,
      idempotencyKey: raceKey,
    });

    // Concurrent publish on draftB with the exact same key before p1 finishes
    await assert.rejects(
      async () => {
        await service.publishMockDraft({
          draftId: draftB.id,
          confirmedPublish: true,
          idempotencyKey: raceKey,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /already used for a different draft/i);
        return true;
      }
    );

    const res1 = await p1;
    assert.equal(res1.state, "succeeded_mock");
  });

  it("prevents concurrent publish execution on the same draft via mutex locking", async () => {
    const { service } = createTestFixture({ simulatedDelayMs: 50 });
    const draft = await service.approveDraft(sampleDraftRequest("draft_concurrency_1"));

    // Launch first publish
    const p1 = service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
    });

    // Immediate second launch before p1 finishes
    await assert.rejects(
      async () => {
        await service.publishMockDraft({
          draftId: draft.id,
          confirmedPublish: true,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /already in progress/i);
        return true;
      }
    );

    // p1 finishes cleanly
    const result1 = await p1;
    assert.equal(result1.state, "succeeded_mock");
  });

  it("persists state durably across store re-instantiations", async () => {
    const subDir = "durable_test_dir";
    const fixture1 = createTestFixture({ subDir });
    const draft = await fixture1.service.approveDraft(sampleDraftRequest("draft_persist_1"));

    const attempt = await fixture1.service.publishMockDraft({
      draftId: draft.id,
      confirmedPublish: true,
    });

    // Instantiate fresh service and store pointing to the same directory
    const store2 = new SocialStore(fixture1.storeDir);
    const service2 = new IntegrationService({
      store: store2,
      publishingProvider: "mock",
    });

    const persistedDraft = await service2.getDraft(draft.id);
    assert.ok(persistedDraft);
    assert.equal(persistedDraft.id, draft.id);
    assert.equal(persistedDraft.publishingStatus, "succeeded_mock");
    assert.equal(persistedDraft.latestAttemptId, attempt.attemptId);

    const persistedAttempt = await service2.getAttempt(attempt.attemptId);
    assert.ok(persistedAttempt);
    assert.equal(persistedAttempt.attemptId, attempt.attemptId);
    assert.equal(persistedAttempt.state, "succeeded_mock");
    assert.equal(persistedAttempt.result?.mockPermalink, attempt.result?.mockPermalink);
  });

  it("startup reconciliation recovers dangling processing attempts", async () => {
    const subDir = "reconcile_test_dir";
    const { store, service } = createTestFixture({ subDir });
    const draft = await service.approveDraft(sampleDraftRequest("draft_reconcile_1"));

    // Create a simulated dangling attempt left in processing
    const danglingAttempt = {
      attemptId: "mock_att_dangling_1",
      draftId: draft.id,
      provider: "mock" as const,
      state: "processing" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptNumber: 1,
      auditCorrelationId: "audit_dang_1",
    };
    await store.saveAttempt(danglingAttempt);

    // Run reconciliation on fresh store
    const store2 = new SocialStore(store.baseDir);
    const reconciledCount = await store2.reconcileStartupState();
    assert.equal(reconciledCount, 1);

    const reconciledAttempt = await store2.getAttempt("mock_att_dangling_1");
    assert.ok(reconciledAttempt);
    assert.equal(reconciledAttempt.state, "unknown");
    assert.equal(reconciledAttempt.error?.code, "SERVER_RESTARTED");

    const auditLogs = await store2.readAuditLog();
    assert.ok(auditLogs.some((l) => l.action === "social.startup.reconciled"));
  });

  it("makes zero outbound network calls during mock publish", async () => {
    const { service } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_zero_net"));

    // Spy on globalThis.fetch
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: any[]) => {
      fetchCalled = true;
      throw new Error(`Outbound network call detected: ${args[0]}`);
    }) as any;

    try {
      const attempt = await service.publishMockDraft({
        draftId: draft.id,
        confirmedPublish: true,
      });
      assert.equal(attempt.state, "succeeded_mock");
      assert.equal(fetchCalled, false, "globalThis.fetch must NEVER be called during mock publishing");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Fix 2 Tests: Temporary File Cleanup ---

  it("Fix 2: cleans up temporary file when atomic write fails without masking error", async () => {
    const { store } = createTestFixture({ subDir: "cleanup_write_fail" });
    await store.ensureDirs();

    // Mock fs.promises.writeFile to fail
    const originalWriteFile = fs.promises.writeFile;
    fs.promises.writeFile = async () => {
      throw new Error("Simulated disk I/O failure during writeFile");
    };

    try {
      await assert.rejects(
        async () => {
          await store.saveDraft({
            id: "draft_clean_write",
            image: { fileName: "t.png", mimeType: "image/png", source: "local" },
            caption: "test",
            hashtags: [],
            status: "approved",
            approvedAt: new Date().toISOString(),
            ownershipConfirmed: true,
            publishingStatus: "unavailable_personal_account",
          });
        },
        /Simulated disk I\/O failure during writeFile/
      );

      // Verify no temporary files remain in drafts directory
      const files = await fs.promises.readdir(store.draftsDir);
      const tempFiles = files.filter((f) => f.includes(".tmp."));
      assert.equal(tempFiles.length, 0, "All temporary files must be cleaned up on writeFile failure");
    } finally {
      fs.promises.writeFile = originalWriteFile;
    }
  });

  it("Fix 2: cleans up temporary file when atomic rename fails without masking error or destination", async () => {
    const { store } = createTestFixture({ subDir: "cleanup_rename_fail" });
    await store.ensureDirs();

    // First save a valid draft to test destination preservation
    const validDraft = {
      id: "draft_dest_preserved",
      image: { fileName: "existing.png", mimeType: "image/png", source: "local" as const },
      caption: "Original content",
      hashtags: [],
      status: "approved" as const,
      approvedAt: new Date().toISOString(),
      ownershipConfirmed: true,
      publishingStatus: "unavailable_personal_account" as const,
    };
    await store.saveDraft(validDraft);

    // Mock fs.promises.rename to fail
    const originalRename = fs.promises.rename;
    fs.promises.rename = async () => {
      throw new Error("Simulated permission denied during rename");
    };

    try {
      await assert.rejects(
        async () => {
          await store.saveDraft({
            ...validDraft,
            caption: "Updated content that fails to rename",
          });
        },
        /Simulated permission denied during rename/
      );

      // Verify no temporary files remain
      const files = await fs.promises.readdir(store.draftsDir);
      const tempFiles = files.filter((f) => f.includes(".tmp."));
      assert.equal(tempFiles.length, 0, "Temp file must be removed when rename fails");

      // Verify original destination file was NOT destroyed or deleted
      const preserved = await store.getDraft("draft_dest_preserved");
      assert.ok(preserved);
      assert.equal(preserved.caption, "Original content", "Destination file must be preserved");
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  // --- Fix 3 Tests: Draft Approval Audit Reliability ---

  it("Fix 3: draft approval awaits and records audit log reliably", async () => {
    const { service, store } = createTestFixture();
    const draft = await service.approveDraft(sampleDraftRequest("draft_audit_reliable"));

    // Verify draft file exists on disk
    const onDisk = await store.getDraft(draft.id);
    assert.ok(onDisk);
    assert.equal(onDisk.id, draft.id);

    // Verify audit log exists on disk and contains draft approved entry
    const auditLogs = await store.readAuditLog();
    const draftApprovedEvent = auditLogs.find(
      (l) => l.action === "social.draft.approved" && l.draftId === draft.id
    );
    assert.ok(draftApprovedEvent, "Audit log must contain social.draft.approved entry");
    assert.equal(draftApprovedEvent.details.imageSource, "local");
    assert.equal(typeof draftApprovedEvent.details.captionLength, "number");
  });

  it("Fix 3: draft approval rolls back persistence and fails if audit write fails", async () => {
    const { service, store } = createTestFixture();

    // Mock store.appendAudit to reject
    const originalAppendAudit = store.appendAudit.bind(store);
    store.appendAudit = async () => {
      throw new Error("Simulated audit disk failure: disk full");
    };

    try {
      await assert.rejects(
        async () => {
          await service.approveDraft(sampleDraftRequest("draft_audit_rollback"));
        },
        (err: any) => {
          assert.equal(err.statusCode, 500);
          assert.equal(err.code, "AUDIT_WRITE_FAILED");
          assert.match(err.message, /Draft approval audit write failed/i);
          assert.match(err.message, /disk full/i);
          return true;
        }
      );

      // Verify draft was ROLLED BACK from disk - state remains consistent!
      const onDisk = await store.getDraft("draft_audit_rollback");
      assert.equal(onDisk, null, "Draft file must be deleted on disk if audit write fails");

      // Verify draft was removed from in-memory cache
      const inMem = service.getApprovedDraft("draft_audit_rollback");
      assert.equal(inMem, undefined, "Draft must not be cached in memory if audit write fails");
    } finally {
      store.appendAudit = originalAppendAudit;
    }
  });
});
