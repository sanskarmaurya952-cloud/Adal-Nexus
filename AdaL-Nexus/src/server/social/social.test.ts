import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompleteOptions, LLMProvider } from "../llm/types.js";
import { CaptionService, CaptionServiceError } from "./captionService.js";
import { IntegrationService } from "./integrationService.js";

function makeMockLLM(response: string, configured = true): LLMProvider {
  return {
    name: "mock-llm",
    model: "mock-model",
    configured,
    async complete(_prompt: string, _opts?: CompleteOptions): Promise<string> {
      if (!configured) throw new Error("not configured");
      return response;
    },
  };
}

describe("Social Autopilot — Integration Service", () => {
  it("honestly reports unconfigured Google Drive when client ID is missing", () => {
    const service = new IntegrationService({} as NodeJS.ProcessEnv);
    const status = service.getDriveStatus();

    assert.equal(status.configured, false);
    assert.equal(status.clientIdPresent, false);
    assert.match(status.message, /not configured/i);
    assert.ok(status.setupInstructions.steps.length >= 4);
  });

  it("reports configured Drive when GOOGLE_CLIENT_ID is provided", () => {
    const service = new IntegrationService({ GOOGLE_CLIENT_ID: "sample-client-id.apps.googleusercontent.com" });
    const status = service.getDriveStatus();

    assert.equal(status.configured, true);
    assert.equal(status.clientIdPresent, true);
  });

  it("reports configured Drive when VITE_GOOGLE_CLIENT_ID is provided", () => {
    const service = new IntegrationService({ VITE_GOOGLE_CLIENT_ID: "vite-sample-client-id.apps.googleusercontent.com" });
    const status = service.getDriveStatus();

    assert.equal(status.configured, true);
    assert.equal(status.clientIdPresent, true);
  });

  it("provides actionable 6-step Google Cloud setup instructions in drive status", () => {
    const service = new IntegrationService({} as NodeJS.ProcessEnv);
    const status = service.getDriveStatus();

    assert.equal(status.setupInstructions.steps.length, 6);
    assert.ok(status.setupInstructions.steps[0].includes("Google Picker API"));
    assert.ok(status.setupInstructions.steps[2].includes("OAuth 2.0"));
    assert.ok(status.setupInstructions.steps[3].includes("API key restricted"));
  });

  it("approves draft with Google Drive asset preserving driveFileId and source", async () => {
    const service = new IntegrationService();
    const record = await service.approveDraft({
      image: {
        fileName: "cloud_asset.png",
        mimeType: "image/png",
        fileSize: 204800,
        source: "drive",
        driveFileId: "1AbC-xYz_789DriveFileId",
      },
      caption: "Sourced securely from Google Drive! ☁️",
      hashtags: ["#GoogleDrive", "#Automation"],
      ownershipConfirmed: true,
    });

    assert.equal(record.status, "approved");
    assert.equal(record.image.source, "drive");
    assert.equal(record.image.driveFileId, "1AbC-xYz_789DriveFileId");
    assert.equal(record.ownershipConfirmed, true);
    assert.equal(record.publishingStatus, "unavailable_personal_account");
  });

  it("never exposes client secrets in drive status", () => {
    const service = new IntegrationService({
      GOOGLE_CLIENT_ID: "client-id-123.apps.googleusercontent.com",
      CLIENT_SECRET: "super-secret-do-not-expose",
    });
    const status = service.getDriveStatus() as unknown as Record<string, unknown>;

    assert.equal(status.configured, true);
    assert.equal("secret" in status, false);
    assert.equal("clientSecret" in status, false);
  });

  it("reports Personal Instagram account as ineligible for direct API publishing", () => {
    const service = new IntegrationService();
    const ig = service.getInstagramStatus();

    assert.equal(ig.connected, false);
    assert.equal(ig.accountType, "personal");
    assert.equal(ig.publishingEligible, false);
    assert.match(ig.message, /personal instagram accounts are not supported by the meta graph api/i);
    assert.ok(ig.requirements.some((r) => r.includes("Creator or Business")));
  });

  it("rejects draft approval if ownership is not confirmed", async () => {
    const service = new IntegrationService();

    await assert.rejects(
      async () =>
        await service.approveDraft({
          image: { fileName: "photo.jpg", mimeType: "image/jpeg", source: "local" },
          caption: "Exciting update!",
          hashtags: ["#Tech"],
          ownershipConfirmed: false,
        }),
      /confirm content ownership/i,
    );
  });

  it("rejects draft approval without an image", async () => {
    const service = new IntegrationService();

    await assert.rejects(
      async () =>
        await service.approveDraft({
          image: { fileName: "", mimeType: "image/jpeg", source: "local" },
          caption: "Valid caption",
          hashtags: ["#Tech"],
          ownershipConfirmed: true,
        }),
      /image must be selected/i,
    );
  });

  it("creates an approved draft with immutable audit metadata", async () => {
    const service = new IntegrationService();
    const record = await service.approveDraft({
      image: { fileName: "demo.png", mimeType: "image/png", fileSize: 10240, source: "local" },
      caption: "Launching our new agent workflow! 🚀",
      hashtags: ["#AI", "#Innovation"],
      callToAction: "Link in bio",
      ownershipConfirmed: true,
    });

    assert.ok(record.id);
    assert.equal(record.status, "approved");
    assert.equal(record.ownershipConfirmed, true);
    assert.equal(record.publishingStatus, "unavailable_personal_account");
    assert.ok(record.approvedAt);
    assert.equal(service.getApprovedDraft(record.id)?.id, record.id);
  });
});

describe("Social Autopilot — Caption Service", () => {
  it("rejects empty or missing topic", async () => {
    const llm = makeMockLLM("{}");
    const service = new CaptionService(llm);

    await assert.rejects(
      () => service.generate({ topic: "   " }),
      (err: CaptionServiceError) => err.code === "invalid_input",
    );
  });

  it("fails honestly when LLM provider is unconfigured", async () => {
    const llm = makeMockLLM("{}", false);
    const service = new CaptionService(llm);

    await assert.rejects(
      () => service.generate({ topic: "AI launch" }),
      (err: CaptionServiceError) => err.code === "not_configured" && err.message.includes("GEMINI_API_KEY"),
    );
  });

  it("generates structured captions, normalizes hashtags, and returns alternatives", async () => {
    const mockOutput = JSON.stringify({
      primaryCaption: "Meet AdaL-Nexus: Browser automation reinvented. ⚡",
      hashtags: ["ai", "#innovation", "automation and agents"],
      callToAction: "Check out the repo in bio!",
      alternatives: [
        { caption: "We just launched AdaL-Nexus.", style: "Short & Punchy" },
        { caption: "Why did we build an autonomous research agent?", style: "Storytelling" },
      ],
    });

    const llm = makeMockLLM(mockOutput, true);
    const service = new CaptionService(llm);

    const res = await service.generate({
      topic: "AdaL-Nexus Launch",
      tone: "engaging",
      callToAction: "Link in bio",
    });

    assert.equal(res.primaryCaption, "Meet AdaL-Nexus: Browser automation reinvented. ⚡");
    assert.ok(res.hashtags.every((tag) => tag.startsWith("#")));
    assert.ok(!res.hashtags.some((tag) => tag.includes(" ")));
    assert.equal(res.callToAction, "Check out the repo in bio!");
    assert.equal(res.alternatives.length, 2);
    assert.equal(res.alternatives[0].style, "Short & Punchy");
  });
});
