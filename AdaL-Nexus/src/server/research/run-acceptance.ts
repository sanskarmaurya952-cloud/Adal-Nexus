import { mkdirSync, writeFileSync } from "node:fs";
import { Controller } from "../agent/controller.js";
import { PolicyEngine } from "../agent/policy.js";
import type { RunEvent, RunSnapshot } from "../agent/types.js";
import { PlaywrightDriver } from "../browser/playwrightDriver.js";
import { UrlGuard } from "../browser/urlSafety.js";
import { config } from "../config.js";
import { createDefaultRegistry } from "../tools/index.js";

async function main() {
  console.log("Starting Milestone 5 Acceptance Run...");
  console.log(`Browser channel: ${config.browserChannel || "(default/bundled)"}`);

  const guard = new UrlGuard();
  const channel = config.browserChannel || "chrome";
  const browser = new PlaywrightDriver({ channel, guard });
  const registry = createDefaultRegistry(browser, guard);

  let finalSnapshot: RunSnapshot | null = null;
  const events: RunEvent[] = [];

  const finishedPromise = new Promise<RunSnapshot>((resolve, reject) => {
    function sink(e: RunEvent): void {
      events.push(e);
      const time = new Date(e.time).toLocaleTimeString();
      console.log(`[${time}] [${e.type}] ${e.message}`);
      if (e.type === "step.progress" && e.stepId) {
        // e.message already contains progress
      }
      if (e.type === "task.finished") {
        finalSnapshot = e.snapshot;
        try {
          mkdirSync("data/runs", { recursive: true });
          writeFileSync(`data/runs/${e.runId}.json`, JSON.stringify(e.snapshot, null, 2));
          console.log(`Run snapshot saved to data/runs/${e.runId}.json`);
        } catch (err) {
          console.error("Failed to save run snapshot:", err);
        }
        resolve(e.snapshot);
      }
    }

    const controller = new Controller(registry, new PolicyEngine(registry), sink);

    const plan = {
      goal: "Milestone 5 Acceptance Run: Research 10 AI startups",
      steps: [
        {
          id: "find",
          title: "Find candidate official site URLs (search with seed-list fallback)",
          tool: "research.find_sources",
          input: { query: "AI startups", maxSources: 15 },
        },
        {
          id: "collect",
          title: "Open sites and extract name, product, target market, pricing",
          tool: "research.collect",
          input: { sources: { $ref: "find.sources" }, maxStartups: 10 },
        },
        {
          id: "consolidate",
          title: "Validate and consolidate records",
          tool: "research.consolidate",
          input: { records: { $ref: "collect.records" }, expectedCount: 10 },
        },
      ],
    };

    try {
      controller.start(plan);
    } catch (err) {
      reject(err);
    }
  });

  try {
    const snapshot = await finishedPromise;
    console.log("\n=== RUN FINISHED ===");
    console.log(`Run ID: ${snapshot.runId}`);
    console.log(`Status: ${snapshot.status}`);

    const consolidateStep = snapshot.steps.find((s) => s.id === "consolidate");
    const output = consolidateStep?.output as { records?: unknown[]; stats?: unknown } | undefined;
    if (output?.records) {
      mkdirSync("docs/audits", { recursive: true });
      const auditRecordsPath = "docs/audits/m5-acceptance-run-records.json";
      writeFileSync(auditRecordsPath, JSON.stringify(output.records, null, 2));
      console.log(`Consolidated records saved to ${auditRecordsPath}`);
      console.log("Stats:", JSON.stringify(output.stats, null, 2));
    }
  } catch (err) {
    console.error("Acceptance run failed with error:", err);
  } finally {
    console.log("Closing browser...");
    await browser.close();
    console.log("Browser closed.");
  }
}

void main();
