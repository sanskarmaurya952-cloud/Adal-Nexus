import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DesktopBrowserDriver } from "../browser/desktopDriver.js";
import { UrlGuard } from "../browser/urlSafety.js";
import { validateImageMagicBytes, validateUserImage } from "./imageValidator.js";
import { MultiPlatformCaptionService } from "./multiPlatformCaptionService.js";
import { SocialPublishingService } from "./socialPublishingService.js";
import { SocialStore } from "./socialStore.js";
import { createSocialTools } from "./tools.js";
import { PLATFORM_LIMITS } from "./types.js";

describe("Phase 3: Multi-Platform Social Publishing & Browser Tools", () => {
  let tempDir: string;
  let testJpegPath: string;
  let testPngPath: string;
  let testFakePath: string;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "adal-multi-test-"));

    // Create a valid JPEG file (SOI 0xFFD8 + APP0 + EOI)
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
    testJpegPath = path.join(tempDir, "valid.jpg");
    await fs.promises.writeFile(testJpegPath, jpegBuffer);

    // Create a valid PNG file
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    testPngPath = path.join(tempDir, "valid.png");
    await fs.promises.writeFile(testPngPath, pngBuffer);

    // Create an invalid/fake file
    const fakeBuffer = Buffer.from("NOT_AN_IMAGE_FILE_JUST_PLAIN_TEXT");
    testFakePath = path.join(tempDir, "fake.png");
    await fs.promises.writeFile(testFakePath, fakeBuffer);
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("Image Validator & Magic Bytes", () => {
    it("validates JPEG buffer magic bytes", () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const res = validateImageMagicBytes(buf);
      assert.equal(res.valid, true);
      assert.equal(res.detectedMime, "image/jpeg");
    });

    it("validates PNG buffer magic bytes", () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const res = validateImageMagicBytes(buf);
      assert.equal(res.valid, true);
      assert.equal(res.detectedMime, "image/png");
    });

    it("validates WebP buffer magic bytes", () => {
      const buf = Buffer.alloc(14);
      buf.write("RIFF", 0, "ascii");
      buf.write("WEBP", 8, "ascii");
      const res = validateImageMagicBytes(buf);
      assert.equal(res.valid, true);
      assert.equal(res.detectedMime, "image/webp");
    });

    it("validates existing local JPEG file path", async () => {
      const res = await validateUserImage({ filePath: testJpegPath });
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, "image/jpeg");
      assert.ok(res.fileSize > 0);
    });

    it("validates existing local PNG file path", async () => {
      const res = await validateUserImage({ filePath: testPngPath });
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, "image/png");
    });

    it("rejects fake image file with mismatched magic bytes", async () => {
      const res = await validateUserImage({ filePath: testFakePath });
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("Invalid image format"));
    });

    it("validates base64 data URL with valid PNG bytes", async () => {
      const pngBase64 = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
      const res = await validateUserImage({ base64Data: pngBase64, fileName: "test.png" });
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, "image/png");
    });

    it("rejects base64 data with invalid magic bytes", async () => {
      const badBase64 = `data:image/png;base64,${Buffer.from("invalid-bytes-header").toString("base64")}`;
      const res = await validateUserImage({ base64Data: badBase64 });
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("Invalid image format"));
    });

    it("rejects oversized images (> 10MB)", async () => {
      const res = await validateUserImage({
        filePath: testJpegPath,
        fileSize: 15 * 1024 * 1024,
      });
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("exceeds maximum allowed size"));
    });

    it("rejects path traversal or null byte attempts", async () => {
      const res = await validateUserImage({
        filePath: "C:\\Windows\\System32\\..\\..\\test\0file.png",
      });
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("Invalid file path"));
    });
  });

  describe("Multi-Platform Caption Generator", () => {
    const service = new MultiPlatformCaptionService();

    it("enforces strict character limits for all platforms", async () => {
      const res = await service.generate({
        topic: "Announcing our breakthrough autonomous AI browser features with real-world task execution and verified research.",
        platforms: ["linkedin", "twitter", "instagram"],
      });

      assert.ok(res.captions.twitter);
      assert.ok(res.captions.linkedin);
      assert.ok(res.captions.instagram);

      // Twitter / X strict 280 char limit
      assert.ok(
        res.captions.twitter.characterCount <= PLATFORM_LIMITS.twitter.maxCharacters,
        `Twitter caption length (${res.captions.twitter.characterCount}) exceeds 280`,
      );

      // LinkedIn 3000 limit
      assert.ok(
        res.captions.linkedin.characterCount <= PLATFORM_LIMITS.linkedin.maxCharacters,
        `LinkedIn caption length (${res.captions.linkedin.characterCount}) exceeds 3000`,
      );

      // Instagram 2200 limit
      assert.ok(
        res.captions.instagram.characterCount <= PLATFORM_LIMITS.instagram.maxCharacters,
        `Instagram caption length (${res.captions.instagram.characterCount}) exceeds 2200`,
      );
    });

    it("generates platform-specific captions only for selected platforms", async () => {
      const res = await service.generate({
        topic: "Quick product update",
        platforms: ["twitter"],
      });

      assert.ok(res.captions.twitter);
      assert.equal(res.captions.linkedin, undefined);
      assert.equal(res.captions.instagram, undefined);
    });
  });

  describe("Multi-Platform Publishing Service & Approvals", () => {
    let store: SocialStore;
    let service: SocialPublishingService;

    before(() => {
      store = new SocialStore(path.join(tempDir, "store"));
      service = new SocialPublishingService(store);
    });

    it("fails if user approval is not granted", async () => {
      await assert.rejects(
        () =>
          service.publishMultiPlatform({
            platforms: ["linkedin", "twitter"],
            image: { fileName: "test.png", mimeType: "image/png", fileSize: 1024 },
            captions: { linkedin: "Post", twitter: "Tweet" },
            ownershipConfirmed: true,
            userApproved: false,
          }),
        /explicit user approval/i,
      );
    });

    it("fails if ownership is not confirmed", async () => {
      await assert.rejects(
        () =>
          service.publishMultiPlatform({
            platforms: ["linkedin"],
            image: { fileName: "test.png", mimeType: "image/png", fileSize: 1024 },
            captions: { linkedin: "Post" },
            ownershipConfirmed: false,
            userApproved: true,
          }),
        /ownership is required/i,
      );
    });

    it("publishes to multiple platforms with safe mock instagram and audit logging", async () => {
      const res = await service.publishMultiPlatform({
        platforms: ["linkedin", "twitter", "instagram"],
        image: { fileName: "launch.png", mimeType: "image/png", fileSize: 2048 },
        captions: {
          linkedin: "Exciting company update on LinkedIn!",
          twitter: "Exciting update on X! #Tech",
          instagram: "Exciting update on Insta! ✨",
        },
        ownershipConfirmed: true,
        userApproved: true,
      });

      assert.ok(res.workflowId);
      assert.ok(res.auditEventId);
      assert.equal(res.overallStatus, "completed");

      // Check results for each platform (in mock simulation mode, non-live platforms return succeeded_mock)
      assert.ok(
        res.results.linkedin.status === "succeeded_mock" || res.results.linkedin.status === "published",
        `Expected linkedin status succeeded_mock or published, got ${res.results.linkedin.status}`,
      );
      assert.ok(res.results.linkedin.publishedUrl);

      assert.ok(
        res.results.twitter.status === "succeeded_mock" || res.results.twitter.status === "published",
        `Expected twitter status succeeded_mock or published, got ${res.results.twitter.status}`,
      );
      assert.ok(res.results.twitter.publishedUrl);

      assert.equal(res.results.instagram.status, "succeeded_mock");
      assert.ok(res.results.instagram.publishedUrl?.includes("instagram.com/p/mock_"));

      // Verify audit event persisted
      const events = await store.readAuditLog();
      assert.ok(events.length > 0);
      const audit = events.find((e) => e.eventId === res.auditEventId);
      assert.ok(audit);
      assert.equal(audit?.action, "social.post.published");
    });

    it("enforces idempotency using idempotencyKey", async () => {
      const idempotencyKey = "idemp_test_key_12345";
      const payload = {
        platforms: ["linkedin"] as any,
        image: { fileName: "img.png", mimeType: "image/png", fileSize: 500 },
        captions: { linkedin: "Unique text" },
        ownershipConfirmed: true,
        userApproved: true,
        idempotencyKey,
      };

      const res1 = await service.publishMultiPlatform(payload);
      const res2 = await service.publishMultiPlatform(payload);

      assert.equal(res1.workflowId, res2.workflowId);
      assert.equal(res1.auditEventId, res2.auditEventId);
    });
  });

  describe("Social Tools Registration & Capabilities", () => {
    const driver = new DesktopBrowserDriver({ channel: "chrome", guard: new UrlGuard() });
    const guard = new UrlGuard();
    const tools = createSocialTools({ driver, guard });

    it("creates social tools with expected names and sensitivity", () => {
      const names = tools.map((t) => t.name);
      assert.ok(names.includes("social.validate_image"));
      assert.ok(names.includes("social.generate_captions"));
      assert.ok(names.includes("social.compose_post"));
      assert.ok(names.includes("social.publish"));

      // Crucial: social.publish MUST be marked sensitive
      const publishTool = tools.find((t) => t.name === "social.publish");
      assert.equal(publishTool?.sensitive, true, "social.publish must require user approval");
    });

    it("runs social.validate_image successfully", async () => {
      const tool = tools.find((t) => t.name === "social.validate_image")!;
      const result = await tool.run(
        { filePath: testJpegPath },
        {
          progress: () => {},
          signal: new AbortController().signal,
        },
      );
      assert.equal((result.output as any).valid, true);
      assert.equal((result.output as any).mimeType, "image/jpeg");
    });

    it("runs social.generate_captions successfully", async () => {
      const tool = tools.find((t) => t.name === "social.generate_captions")!;
      const result = await tool.run(
        { topic: "Announcing AdaL-Nexus Phase 3 release", platforms: ["linkedin", "twitter"] },
        {
          progress: () => {},
          signal: new AbortController().signal,
        },
      );
      const output = result.output as any;
      assert.ok(output.captions.linkedin);
      assert.ok(output.captions.twitter);
    });
  });
});
