// Usage: npm run planner:check
// Validates plan drafting with Gemini using the registered tools and JSON schema.
// Makes AT MOST ONE plan draft request.
// NEVER launches a browser, executes steps, or writes workbooks.
// NEVER prints the API key or raw credentials.
import { Controller } from "../agent/controller.js";
import { PolicyEngine } from "../agent/policy.js";
import { config } from "../config.js";
import { getProvider, LLMError } from "../llm/provider.js";
import { createDefaultRegistry } from "../tools/index.js";
import { Planner, PlannerError } from "./planner.js";

async function main() {
  const provider = getProvider();
  console.log(
    JSON.stringify({
      provider: provider.name,
      model: provider.model ?? null,
      configured: provider.configured,
      apiKeyPresent: config.geminiApiKey.length > 0,
    }),
  );

  if (!provider.configured) {
    console.error("Planner check aborted: GEMINI_API_KEY is not configured in .env.");
    process.exit(1);
  }

  const registry = createDefaultRegistry();
  const policy = new PolicyEngine(registry);
  const planner = new Planner(provider, registry, policy);

  const task =
    "Research 10 AI startups, extract verified pricing and plan details, export to an Excel spreadsheet, and verify the file.";

  console.log(`Sending minimal planner-only request to Gemini (${provider.model})...`);
  console.log(`Task: "${task}"`);
  console.log("No browser will open; no steps will execute; no files will be created.\n");

  try {
    const draft = await planner.draft(task);

    console.log("=== PLANNER DRAFT VALIDATION SUCCEEDED ===");
    console.log(`Plan ID: ${draft.planId}`);
    console.log(`Goal: ${draft.plan.goal}`);
    console.log(`Limitations: ${JSON.stringify(draft.limitations)}`);
    console.log(`Step count: ${draft.plan.steps.length}`);
    console.log("\nGenerated Steps & References:");
    for (let i = 0; i < draft.plan.steps.length; i++) {
      const s = draft.plan.steps[i];
      console.log(`  ${i + 1}. [${s.id}] "${s.title}" -> tool: ${s.tool}`);
      if (s.input) {
        console.log(`     input: ${JSON.stringify(s.input)}`);
      }
    }
    console.log("\nPlan verification: ALL tool names valid, reference DAG valid, schema adhered to.");
    return;
  } catch (err) {
    console.error("=== PLANNER DRAFT VALIDATION FAILED ===");
    if (err instanceof PlannerError || err instanceof LLMError) {
      console.error(`Error Code: [${err.code}]`);
      console.error(`Message: ${err.message}`);
      if ("details" in err && err.details) {
        console.error(`Details: ${JSON.stringify(err.details)}`);
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      // Redact anything resembling an API key just in case
      const redacted = msg.replace(/AIza[0-9A-Za-z_-]{35}/g, "[REDACTED_API_KEY]");
      console.error(`Unexpected Error: ${redacted}`);
    }
    process.exit(1);
  }
}

main();
