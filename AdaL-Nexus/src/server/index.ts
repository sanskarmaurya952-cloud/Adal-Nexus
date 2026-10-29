import { mkdirSync, writeFileSync } from "node:fs";
import type { RunEvent } from "./agent/types.js";
import { createApp } from "./app.js";
import { Controller } from "./agent/controller.js";
import { PolicyEngine } from "./agent/policy.js";
import { PlaywrightDriver } from "./browser/playwrightDriver.js";
import { UrlGuard } from "./browser/urlSafety.js";
import { config } from "./config.js";
import { broadcast, emit } from "./events.js";
import { getProvider } from "./llm/provider.js";
import { createDefaultRegistry } from "./tools/index.js";
import { IntegrationService } from "./social/integrationService.js";
import { SocialStore } from "./social/socialStore.js";

const guard = new UrlGuard();
const browser = new PlaywrightDriver({ channel: config.browserChannel, guard });
const registry = createDefaultRegistry(browser, guard, getProvider());
// Finished runs are also saved to data/runs/<runId>.json (git-ignored) so results can be audited later.
function sinkWithPersistence(e: RunEvent): void {
  broadcast(e);
  if (e.type !== "task.finished") return;
  try {
    mkdirSync("data/runs", { recursive: true });
    writeFileSync(`data/runs/${e.runId}.json`, JSON.stringify(e.snapshot, null, 2));
  } catch {
    /* persistence is best-effort and must never affect a run */
  }
}
const controller = new Controller(registry, new PolicyEngine(registry), sinkWithPersistence);

// Social Media Autopilot store & startup reconciliation (Phase 3A)
const socialStore = new SocialStore();
socialStore.reconcileStartupState().catch((err) => {
  console.warn("Failed to reconcile social startup state:", err);
});
const integrationService = new IntegrationService({ store: socialStore });

const app = createApp({ controller, registry, llm: getProvider(), browser, integrationService });

const server = app.listen(config.port, () => {
  console.log(`AdaL Nexus server listening on http://localhost:${config.port}`);
  emit("system", "server started");
});

function shutdown() {
  server.close();
  void browser.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
