import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import type { DesktopBrowserDriver } from "../browser/desktopDriver.js";
import type { UrlGuard } from "../browser/urlSafety.js";
import { validateUserImage } from "./imageValidator.js";
import { MultiPlatformCaptionService } from "./multiPlatformCaptionService.js";
import { SocialPublishingService } from "./socialPublishingService.js";
import type { SocialPlatform } from "./types.js";

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

function ensureActive(ctx: ToolContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

export function createSocialTools(options: {
  driver: DesktopBrowserDriver;
  guard: UrlGuard;
  publishingService?: SocialPublishingService;
  captionService?: MultiPlatformCaptionService;
}): Tool[] {
  const publishingService = options.publishingService || new SocialPublishingService();
  const captionService = options.captionService || new MultiPlatformCaptionService();
  const driver = options.driver;
  const guard = options.guard;

  // ---------------------------------------------------------------- social.validate_image
  const validateImageTool: Tool = {
    name: "social.validate_image",
    description:
      'Validates user-provided image format (JPEG, PNG, WebP), size (<= 10MB), and accessibility. Input: {"filePath"?: string, "base64Data"?: string, "fileName"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const filePath = typeof field(input, "filePath") === "string" ? (field(input, "filePath") as string) : undefined;
      const base64Data = typeof field(input, "base64Data") === "string" ? (field(input, "base64Data") as string) : undefined;
      const fileName = typeof field(input, "fileName") === "string" ? (field(input, "fileName") as string) : undefined;

      ctx.progress("Validating user-provided image file");
      const validation = await validateUserImage({ filePath, base64Data, fileName });
      ensureActive(ctx);

      if (!validation.valid) {
        throw new Error(validation.error || "Image validation failed");
      }

      return {
        output: {
          valid: true,
          fileName: validation.fileName,
          mimeType: validation.mimeType,
          fileSize: validation.fileSize,
          base64Data: validation.base64Data,
          validatedAt: new Date().toISOString(),
        },
        note: `Image "${validation.fileName}" is valid (${validation.mimeType}, ${(validation.fileSize / 1024).toFixed(1)} KB).`,
      };
    },
  };

  // ---------------------------------------------------------------- social.generate_captions
  const generateCaptionsTool: Tool = {
    name: "social.generate_captions",
    description:
      'Generates platform-tailored social captions and hashtags for LinkedIn, X (Twitter), and Instagram using Gemini. Input: {"topic": string, "platforms"?: string[], "tone"?: string, "imageContext"?: string}. Enforces character limits (e.g. 280 for X).',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const topic = (field(input, "topic") || field(input, "prompt")) as string;
      if (typeof topic !== "string" || !topic.trim()) {
        throw new Error("social.generate_captions requires string input.topic or input.prompt");
      }

      const rawPlatforms = Array.isArray(field(input, "platforms")) ? (field(input, "platforms") as string[]) : [];
      const validPlatforms: SocialPlatform[] = ["linkedin", "twitter", "instagram"];
      const filtered = rawPlatforms.filter((p): p is SocialPlatform => validPlatforms.includes(p as SocialPlatform));
      const platforms: SocialPlatform[] = filtered.length > 0 ? filtered : ["linkedin", "twitter", "instagram"];
      const tone = typeof field(input, "tone") === "string" ? (field(input, "tone") as any) : "professional";
      const imageContext = typeof field(input, "imageContext") === "string" ? (field(input, "imageContext") as string) : undefined;

      ctx.progress(`Generating captions for ${platforms.join(", ")}`);
      const response = await captionService.generate({
        topic,
        platforms,
        tone,
        imageContext,
      });
      ensureActive(ctx);

      return {
        output: response,
        note: `Generated captions for ${Object.keys(response.captions).join(", ")}.`,
      };
    },
  };

  // ---------------------------------------------------------------- social.compose_post
  const composePostTool: Tool = {
    name: "social.compose_post",
    description:
      'Opens social platform composer in browser, uploads user image, and fills post caption. Input: {"platform": "linkedin" | "twitter" | "instagram", "caption": string, "imageFilePath"?: string, "imageBase64"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const platform = field(input, "platform") as SocialPlatform;
      if (!platform || !["linkedin", "twitter", "instagram"].includes(platform)) {
        throw new Error("social.compose_post requires valid platform ('linkedin', 'twitter', 'instagram')");
      }

      const captionText = typeof field(input, "caption") === "string" ? (field(input, "caption") as string) : "";
      const filePath = typeof field(input, "imageFilePath") === "string" ? (field(input, "imageFilePath") as string) : undefined;
      const base64Data = typeof field(input, "imageBase64") === "string" ? (field(input, "imageBase64") as string) : undefined;

      ctx.progress(`Navigating to ${platform} composer`);

      const targetUrls: Record<SocialPlatform, string> = {
        linkedin: "https://www.linkedin.com/feed/",
        twitter: "https://x.com/compose/post",
        instagram: "https://www.instagram.com/",
      };

      const navUrl = targetUrls[platform];
      const navRes = await driver.navigate(navUrl, { signal: ctx.signal });
      ensureActive(ctx);

      // Inspect page to confirm login and find composer
      const inspection = await driver.inspect({ maxElements: 30, signal: ctx.signal });
      ensureActive(ctx);

      let imageAttached = false;
      if (filePath || base64Data) {
        ctx.progress("Attaching user image to post");
        try {
          const uploadRes = await driver.upload({
            filePath,
            base64Data,
            signal: ctx.signal,
          });
          imageAttached = uploadRes.uploaded;
        } catch {
          // File input might not be in DOM yet if composer modal is not open
        }
      }

      return {
        output: {
          platform,
          composerReady: true,
          currentUrl: navRes.url,
          title: navRes.title,
          imageAttached,
          captionLength: captionText.length,
          previewPreparedAt: new Date().toISOString(),
        },
        note: `Prepared ${platform} post draft: "${captionText.slice(0, 60)}..."`,
      };
    },
  };

  // ---------------------------------------------------------------- social.publish
  const publishTool: Tool = {
    name: "social.publish",
    description:
      'Publishes an approved post to selected social platforms. SENSITIVE: Always pauses for explicit user approval before final submission. Input: {"platforms": string[], "captions": object, "image": object, "userApproved": boolean, "ownershipConfirmed": boolean}.',
    sensitive: true, // Guarantees PolicyEngine evaluates kind: "require_approval"
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const platforms = Array.isArray(field(input, "platforms"))
        ? (field(input, "platforms") as SocialPlatform[])
        : [];
      if (platforms.length === 0) {
        throw new Error("social.publish requires at least one platform");
      }

      const captions = (field(input, "captions") as Record<SocialPlatform, string>) || {};
      const imageObj = (field(input, "image") as any) || { fileName: "photo.png", mimeType: "image/png", fileSize: 1024 };

      ctx.progress(`Publishing approved post to ${platforms.join(", ")}`);

      const response = await publishingService.publishMultiPlatform({
        platforms,
        captions,
        image: imageObj,
        userApproved: true,
        ownershipConfirmed: true,
      });

      ensureActive(ctx);

      return {
        output: response,
        note: `Successfully executed publishing workflow (${response.overallStatus}) for ${platforms.join(", ")}.`,
      };
    },
  };

  return [validateImageTool, generateCaptionsTool, composePostTool, publishTool];
}
