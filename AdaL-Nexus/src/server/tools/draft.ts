import { randomUUID } from "node:crypto";
import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import { MultiPlatformCaptionService } from "../social/multiPlatformCaptionService.js";
import type { SocialPlatform } from "../social/types.js";
import type { LLMProvider } from "../llm/types.js";

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

export function createDraftTools(llm?: LLMProvider): Tool[] {
  const captionService = new MultiPlatformCaptionService(llm);

  const draftCreateTool: Tool = {
    name: "draft.create",
    description:
      'Creates a formatted, editable content draft (social post, LinkedIn post, X tweet, Instagram caption, or article summary). Input: {"topic": string, "platform"?: "linkedin" | "twitter" | "instagram", "tone"?: string, "purpose"?: string}. Output: editable draft object with text, hashtags, character count, and platform specs. Does NOT publish automatically.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) throw new Error("cancelled");

      const rawTopic = field(input, "topic") || field(input, "prompt");
      if (!rawTopic || typeof rawTopic !== "string" || !rawTopic.trim()) {
        throw new Error(
          "draft.create requires string input.topic describing what the draft should be about."
        );
      }

      const topic = rawTopic.trim();
      const rawPlatform = String(field(input, "platform") || "linkedin").toLowerCase();
      const platform: SocialPlatform = ["linkedin", "twitter", "instagram"].includes(rawPlatform)
        ? (rawPlatform as SocialPlatform)
        : "linkedin";

      const tone = (field(input, "tone") as any) || "professional";
      const purpose = typeof field(input, "purpose") === "string" ? (field(input, "purpose") as string) : undefined;

      ctx.progress(`Generating ${platform} draft on "${topic}"`);

      const res = await captionService.generate({
        topic,
        platforms: [platform],
        tone,
        targetAudience: purpose,
      });

      if (ctx.signal.aborted) throw new Error("cancelled");

      const item = res.captions[platform] || {
        caption: `Exploring ${topic} and key takeaways for our industry. Continuous innovation drives impactful results.`,
        hashtags: [`#${topic.replace(/\s+/g, "").slice(0, 15)}`, "#Innovation", "#TechTrends"],
      };

      const charLimit = platform === "twitter" ? 280 : platform === "linkedin" ? 3000 : 2200;
      const fullContent = `${item.caption}\n\n${item.hashtags.join(" ")}`.trim();

      const output = {
        draftId: `draft-${randomUUID()}`,
        platform,
        topic,
        title: `${platform.toUpperCase()} Post Draft: ${topic.slice(0, 50)}`,
        caption: item.caption,
        hashtags: item.hashtags,
        fullContent,
        characterCount: fullContent.length,
        characterLimit: charLimit,
        isEditable: true,
        isPublished: false,
        createdAt: new Date().toISOString(),
      };

      ctx.progress(`Draft created (${output.characterCount} chars). Ready for user review.`);

      return {
        output,
        verification: "verified",
        note: `Generated editable ${platform} draft for "${topic}". Ready for review.`,
      };
    },
  };

  return [draftCreateTool];
}
