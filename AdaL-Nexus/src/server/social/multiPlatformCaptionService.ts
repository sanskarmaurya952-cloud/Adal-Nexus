import type { LLMProvider } from "../llm/types.js";
import {
  PLATFORM_LIMITS,
  type GenerateMultiPlatformCaptionsRequest,
  type GenerateMultiPlatformCaptionsResponse,
  type MultiPlatformCaptionItem,
  type SocialPlatform,
} from "./types.js";

const MULTI_CAPTION_SCHEMA = {
  type: "object",
  properties: {
    linkedin: {
      type: "object",
      properties: {
        caption: { type: "string", description: "Professional, insightful LinkedIn post with clear paragraphs." },
        hashtags: { type: "array", items: { type: "string" }, description: "3 to 5 industry-relevant hashtags prefixed with #." },
        callToAction: { type: "string" },
      },
      required: ["caption", "hashtags"],
    },
    twitter: {
      type: "object",
      properties: {
        caption: { type: "string", description: "Concise, punchy tweet strictly under 240 characters to leave room for hashtags." },
        hashtags: { type: "array", items: { type: "string" }, description: "1 or 2 high-impact hashtags prefixed with #." },
        callToAction: { type: "string" },
      },
      required: ["caption", "hashtags"],
    },
    instagram: {
      type: "object",
      properties: {
        caption: { type: "string", description: "Engaging Instagram caption with hook, line breaks, and emojis." },
        hashtags: { type: "array", items: { type: "string" }, description: "5 to 12 targeted hashtags prefixed with #." },
        callToAction: { type: "string" },
      },
      required: ["caption", "hashtags"],
    },
  },
  required: ["linkedin", "twitter", "instagram"],
};

export class MultiPlatformCaptionService {
  constructor(private readonly llm?: LLMProvider) {}

  /**
   * Generates tailored captions for selected platforms (LinkedIn, X/Twitter, Instagram).
   */
  async generate(
    req: GenerateMultiPlatformCaptionsRequest,
  ): Promise<GenerateMultiPlatformCaptionsResponse> {
    const topic = (req.topic || (req as any).prompt)?.trim();
    if (!topic) {
      throw new Error("A topic or prompt is required to generate social captions.");
    }

    const requestedPlatforms: SocialPlatform[] = req.platforms && req.platforms.length > 0
      ? req.platforms
      : ["linkedin", "twitter", "instagram"];

    const tone = req.tone || "professional";
    const targetAudience = req.targetAudience?.trim() || "professionals & community";
    const imageContext = req.imageContext?.trim() || "";
    const cta = req.callToAction?.trim() || "";

    let rawJson: any = null;

    if (this.llm && this.llm.configured) {
      try {
        const systemPrompt = [
          "You are an expert social media strategist and copywriter.",
          "Write distinct, platform-optimized captions for LinkedIn, X (Twitter), and Instagram.",
          "Rules:",
          "1. LinkedIn: professional, thought leadership, industry insight, line breaks, 3-5 hashtags.",
          "2. X (Twitter): strictly punchy and concise, MUST be under 250 characters including hashtags, 1-2 hashtags.",
          "3. Instagram: visual storytelling, hook, engaging emojis, clear call to action, 5-10 hashtags.",
          "Return valid JSON matching the schema.",
        ].join(" ");

        const userPrompt = [
          `Topic / Message: ${topic}`,
          `Tone: ${tone}`,
          `Target Audience: ${targetAudience}`,
          imageContext ? `Visual Context: ${imageContext}` : "",
          cta ? `Call to action: ${cta}` : "",
        ].filter(Boolean).join("\n");

        const responseText = await this.llm.complete(userPrompt, {
          system: systemPrompt,
          jsonSchema: MULTI_CAPTION_SCHEMA,
        });

        rawJson = JSON.parse(responseText);
      } catch {
        // Fall back to deterministic templates if LLM error occurs
        rawJson = null;
      }
    }

    if (!rawJson) {
      rawJson = this.generateDeterministicFallback(topic, tone, cta);
    }

    const captions: Record<SocialPlatform, MultiPlatformCaptionItem> = {} as any;

    for (const p of requestedPlatforms) {
      const pData = rawJson[p] || this.generatePlatformFallback(p, topic, tone);
      const limit = PLATFORM_LIMITS[p];

      let fullCaption = pData.caption.trim();
      const tags = (pData.hashtags || []).map((t: string) => (t.startsWith("#") ? t : `#${t}`)).slice(0, limit.maxHashtags);

      // If Twitter, enforce strict 280-char total limit
      if (p === "twitter") {
        const tagsString = tags.length > 0 ? ` ${tags.join(" ")}` : "";
        const maxTextLen = Math.max(0, limit.maxCharacters - tagsString.length);
        if (fullCaption.length > maxTextLen) {
          fullCaption = `${fullCaption.slice(0, maxTextLen - 3)}...`;
        }
      }

      const totalLength = fullCaption.length + (tags.length > 0 ? tags.join(" ").length + 1 : 0);

      captions[p] = {
        platform: p,
        caption: fullCaption,
        characterCount: totalLength,
        maxCharacters: limit.maxCharacters,
        hashtags: tags,
        callToAction: pData.callToAction || cta || undefined,
        compliant: totalLength <= limit.maxCharacters,
      };
    }

    return {
      captions,
      generatedAt: new Date().toISOString(),
    };
  }

  private generateDeterministicFallback(topic: string, tone: string, cta: string): any {
    return {
      linkedin: {
        caption: `Excited to share insights on ${topic}. In today's fast-moving ecosystem, strategic execution and quality matter more than ever. ${cta || "Looking forward to hearing thoughts from the community."}`,
        hashtags: ["#Innovation", "#Technology", "#Leadership", "#Growth"],
        callToAction: cta || "What are your key takeaways?",
      },
      twitter: {
        caption: `Exploring ${topic}. Key takeaway: keep iterating and focus on what creates genuine value.`,
        hashtags: ["#Tech", "#BuildInPublic"],
        callToAction: cta,
      },
      instagram: {
        caption: `Behind the scenes with ${topic} ✨\n\nEvery milestone is built one step at a time. Staying focused on the mission and embracing the journey! 🚀\n\n${cta || "Drop a comment with your thoughts 👇"}`,
        hashtags: ["#TechJourney", "#Creativity", "#DailyInspiration", "#Innovation", "#BuilderLife"],
        callToAction: cta || "Drop your thoughts below!",
      },
    };
  }

  private generatePlatformFallback(platform: SocialPlatform, topic: string, tone: string): any {
    const all = this.generateDeterministicFallback(topic, tone, "");
    return all[platform];
  }
}
