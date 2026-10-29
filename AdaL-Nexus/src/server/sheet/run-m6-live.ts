import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Controller } from "../agent/controller.js";
import { PolicyEngine } from "../agent/policy.js";
import type { RunEvent, RunSnapshot } from "../agent/types.js";
import { createApp } from "../app.js";
import { PlaywrightDriver } from "../browser/playwrightDriver.js";
import { UrlGuard } from "../browser/urlSafety.js";
import { config } from "../config.js";
import { getProvider } from "../llm/provider.js";
import { createDefaultRegistry } from "../tools/index.js";

async function main() {
  console.log("=== Milestone 6 Final Acceptance Run ===");
  console.log(`Browser channel: ${config.browserChannel || "chrome"}`);

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
      goal: "Milestone 6: Research 10 AI startups, generate verified Excel workbook, and verify",
      steps: [
        {
          id: "find",
          title: "Find source URLs (search with seed fallback)",
          tool: "research.find_sources",
          input: { query: "AI startups", maxSources: 15 },
        },
        {
          id: "collect",
          title: "Visit sites and extract facts with evidence quotes",
          tool: "research.collect",
          input: { sources: { $ref: "find.sources" }, maxStartups: 10 },
        },
        {
          id: "consolidate",
          title: "Consolidate and validate research records",
          tool: "research.consolidate",
          input: { records: { $ref: "collect.records" }, expectedCount: 10 },
        },
        {
          id: "write",
          title: "Generate Excel workbook from consolidated records",
          tool: "sheet.write",
          input: {
            records: { $ref: "consolidate.records" },
            fileName: "m6-accepted-startups",
          },
        },
        {
          id: "verify",
          title: "Independently reopen and verify workbook integrity",
          tool: "sheet.verify",
          input: {
            filePath: { $ref: "write.filePath" },
            expectedRowCount: 10,
          },
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
    console.log("\n=== WORKFLOW FINISHED ===");
    console.log(`Run ID: ${snapshot.runId}`);
    console.log(`Status: ${snapshot.status}`);

    const writeStep = snapshot.steps.find((s) => s.id === "write");
    const verifyStep = snapshot.steps.find((s) => s.id === "verify");

    console.log(`Write Step Status: ${writeStep?.status}`);
    console.log("Write Output:", JSON.stringify(writeStep?.output, null, 2));

    console.log(`Verify Step Status: ${verifyStep?.status}`);
    console.log("Verify Output:", JSON.stringify(verifyStep?.output, null, 2));

    const writeOut = writeStep?.output as { filePath?: string; fileName?: string } | undefined;
    if (writeOut?.filePath && existsSync(writeOut.filePath)) {
      const stats = statSync(writeOut.filePath);
      console.log(`Workbook verified on disk: ${writeOut.filePath} (${stats.size} bytes)`);

      // Test the real download route
      console.log("\nTesting download route GET /api/downloads/:fileName...");
      const dummyController = new Controller(registry, new PolicyEngine(registry));
      const app = createApp({ controller: dummyController, registry, llm: getProvider() });
      const testServer = await new Promise<{ server: any; port: number }>((resolveServer) => {
        const s = app.listen(0, "127.0.0.1", () => {
          resolveServer({ server: s, port: (s.address() as AddressInfo).port });
        });
      });

      try {
        const res = await fetch(`http://127.0.0.1:${testServer.port}/api/downloads/${writeOut.fileName}`);
        console.log(`Download response status: ${res.status}`);
        console.log(`Content-Type: ${res.headers.get("content-type")}`);
        console.log(`Content-Disposition: ${res.headers.get("content-disposition")}`);
        const buffer = await res.arrayBuffer();
        console.log(`Downloaded byte length: ${buffer.byteLength}`);
        if (buffer.byteLength === stats.size) {
          console.log("Download verified: downloaded byte length exactly matches disk file size!");
        } else {
          console.error("Size mismatch between download and disk!");
        }
      } finally {
        testServer.server.close();
      }
    }
  } catch (err) {
    console.error("Workflow failed with error:", err);
  } finally {
    console.log("Closing browser...");
    await browser.close();
    console.log("Browser closed.");
  }
}

void main();
