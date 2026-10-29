import { LLMError, type LLMProvider } from "../llm/types.js";
import type { GenerateCaptionRequest, GenerateCaptionResponse } from "./types.js";

const CAPTION_SCHEMA = {
  type: "object",
  properties: {
    primaryCaption: {
      type: "string",
      description: "Engaging, well-formatted Instagram caption with appropriate line breaks and emojis.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "5 to 15 relevant, high-performing hashtags prefixed with #.",
    },
    callToAction: {
      type: "string",
      description: "Clear, engaging call-to-action (e.g., 'Link in bio', 'Share your thoughts below').",
    },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          caption: { type: "string" },
          style: { type: "string", description: "e.g. 'Punchy & Short', 'Storytelling', 'Question/Community'" },
        },
        required: ["caption", "style"],
      },
      description: "2 or 3 alternative caption variations with different editorial angles.",
    },
  },
  required: ["primaryCaption", "hashtags", "callToAction", "alternatives"],
};

export class CaptionServiceError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_configured" | "provider_error" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "CaptionServiceError";
  }
}

export class CaptionService {
  constructor(private readonly llm: LLMProvider) {}

  async generate(req: GenerateCaptionRequest): Promise<GenerateCaptionResponse> {
    const topic = req?.topic?.trim();
    if (!topic) {
      throw new CaptionServiceError("invalid_input", "A topic or focus description is required to generate captions.");
    }
    if (topic.length > 1000) {
      throw new CaptionServiceError("invalid_input", "Topic description exceeds maximum length of 1000 characters.");
    }

    if (!this.llm.configured) {
      throw new CaptionServiceError(
        "not_configured",
        "Gemini LLM provider is not configured. Add GEMINI_API_KEY to your .env file to enable AI caption generation.",
      );
    }

    const tone = req.tone || "engaging";
    const targetAudience = req.targetAudience?.trim() || "general audience";
    const imageContext = req.imageContext?.trim();
    const customCta = req.callToAction?.trim();

    const systemPrompt =
      "You are a professional social media marketing copywriter specializing in Instagram. " +
      "Create high-converting, human, and authentic Instagram captions with appropriate line breaks, subtle emojis, " +
      "relevant hashtags, and clear calls-to-action. " +
      "Do NOT invent false claims or fabricate real-world statistics unless provided by the user. " +
      "Focus solely on the topic and context provided. Output valid JSON matching the requested schema.";

    const promptParts = [
      `Topic: ${topic}`,
      `Desired Tone: ${tone}`,
      `Target Audience: ${targetAudience}`,
    ];

    if (imageContext) {
      promptParts.push(`Visual Context (described by user): ${imageContext}`);
    }
    if (customCta) {
      promptParts.push(`Requested Call to Action: ${customCta}`);
    }

    promptParts.push(
      "\nInstructions:",
      "1. Produce one compelling primary caption optimized for Instagram readability.",
      "2. Provide 5-15 relevant, targeted hashtags (each starting with #).",
      "3. Suggest an effective call to action.",
      "4. Include 2 or 3 distinct alternative caption variations (e.g., Short/Punchy, Storytelling, Conversational).",
    );

    let raw: string;
    try {
      raw = await this.llm.complete(promptParts.join("\n"), {
        system: systemPrompt,
        jsonSchema: CAPTION_SCHEMA,
        timeoutMs: 30000,
      });
    } catch (err) {
      if (err instanceof LLMError) {
        throw new CaptionServiceError("provider_error", err.message);
      }
      throw new CaptionServiceError("provider_error", err instanceof Error ? err.message : "AI generation failed");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CaptionServiceError("invalid_response", "AI returned non-JSON response");
    }

    if (!this.isValidResponse(parsed)) {
      throw new CaptionServiceError("invalid_response", "AI response did not match expected schema structure");
    }

    // Clean and normalize hashtags
    const hashtags = parsed.hashtags
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      .map((tag) => tag.replace(/\s+/g, ""))
      .filter((tag) => tag.length > 1);

    return {
      primaryCaption: parsed.primaryCaption.trim(),
      hashtags: hashtags.length > 0 ? hashtags : ["#AI", "#Innovation", "#Tech"],
      callToAction: parsed.callToAction.trim(),
      alternatives: parsed.alternatives.map((alt) => ({
        caption: alt.caption.trim(),
        style: alt.style.trim(),
      })),
    };
  }

  private isValidResponse(data: unknown): data is GenerateCaptionResponse {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.primaryCaption === "string" &&
      Array.isArray(d.hashtags) &&
      typeof d.callToAction === "string" &&
      Array.isArray(d.alternatives)
    );
  }
}
