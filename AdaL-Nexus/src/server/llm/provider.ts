import { config } from "../config.js";
import { GeminiProvider } from "./gemini.js";
import { LLMError, type LLMProvider } from "./types.js";

export type { LLMProvider } from "./types.js";
export { LLMError } from "./types.js";

/** Provider that is selected but cannot answer (no key, or provider "none"). The app still starts. */
export class UnconfiguredProvider implements LLMProvider {
  readonly configured = false;
  constructor(
    readonly name: string = "none",
    readonly model?: string,
  ) {}
  async complete(): Promise<string> {
    throw new LLMError(
      "not_configured",
      "No LLM is configured. Set GEMINI_API_KEY in .env and restart the server (see README).",
    );
  }
}

export interface ProviderConfig {
  llmProvider: string;
  geminiApiKey: string;
  geminiModel: string;
}

export function getProvider(cfg: ProviderConfig = config): LLMProvider {
  switch (cfg.llmProvider) {
    case "none":
      return new UnconfiguredProvider("none");
    case "gemini":
      return cfg.geminiApiKey
        ? new GeminiProvider({ apiKey: cfg.geminiApiKey, model: cfg.geminiModel })
        : new UnconfiguredProvider("gemini", cfg.geminiModel);
    default:
      console.warn(`LLM_PROVIDER="${cfg.llmProvider}" is not supported; using "none".`);
      return new UnconfiguredProvider("none");
  }
}
