import { existsSync } from "node:fs";

// Load .env if present (Node built-in; no dotenv dependency). Never log values.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  llmProvider: (process.env.LLM_PROVIDER || "gemini").toLowerCase(),
  // The key is read here and only handed to the provider. It is never returned by the API or logged.
  geminiApiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
  // "chrome" or "msedge" uses an installed browser; empty uses Playwright's bundled Chromium.
  browserChannel: (process.env.BROWSER_CHANNEL ?? "").trim(),
  geminiModel: (process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim(),
  // Social publishing provider: "mock" (safe local simulation, zero network calls).
  // If unset or any other value, publishing attempts fail closed with HTTP 503.
  socialPublishingProvider: (process.env.SOCIAL_PUBLISHING_PROVIDER || "").trim().toLowerCase(),
};
