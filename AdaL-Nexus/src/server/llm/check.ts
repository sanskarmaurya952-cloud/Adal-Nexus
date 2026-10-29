// Usage: npm run llm:check            -> prints configuration status, makes NO API call
//        npm run llm:check -- --live  -> makes ONE tiny request (uses free-tier quota)
// Never prints the API key or the model's response text.
import { config } from "../config.js";
import { getProvider, LLMError } from "./provider.js";

const provider = getProvider();
console.log(
  JSON.stringify({
    provider: provider.name,
    model: provider.model ?? null,
    configured: provider.configured,
    apiKeyPresent: config.geminiApiKey.length > 0,
  }),
);

if (!process.argv.includes("--live")) {
  console.log("No API call was made. Re-run with --live to send ONE small request.");
  process.exit(provider.configured ? 0 : 1);
}

if (!provider.configured) {
  console.log("Not configured: set GEMINI_API_KEY in .env first.");
  process.exit(1);
}

try {
  const text = await provider.complete("Reply with the single word: ok", { timeoutMs: 20_000 });
  console.log(`Live call succeeded (received ${text.length} characters).`);
} catch (err) {
  const e = err instanceof LLMError ? err : null;
  console.log(`Live call FAILED [${e?.code ?? "unknown"}]: ${e?.message ?? "unexpected error"}`);
  process.exit(1);
}
