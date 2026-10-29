import { ToolRegistry } from "../agent/registry.js";
import { PlaywrightDriver } from "../browser/playwrightDriver.js";
import { DesktopBrowserDriver } from "../browser/desktopDriver.js";
import { createAutonomousBrowserTools } from "../browser/autonomousTools.js";
import { createBrowserTools } from "../browser/tools.js";
import type { BrowserDriver } from "../browser/types.js";
import { UrlGuard } from "../browser/urlSafety.js";
import { config } from "../config.js";
import { createResearchTools } from "../research/tools.js";
import { createSheetTools } from "../sheet/tools.js";
import { createSocialTools } from "../social/tools.js";
import { createDraftTools } from "./draft.js";
import type { LLMProvider } from "../llm/types.js";
import { systemCheckpoint, systemNote, systemWait } from "./system.js";

/**
 * Only tools that are actually implemented are registered, explicitly, by name.
 * The browser is created lazily: nothing launches until a browser tool runs.
 */
export function createDefaultRegistry(
  browser?: BrowserDriver,
  guard: UrlGuard = new UrlGuard(),
  llm?: LLMProvider,
): ToolRegistry {
  const desktopDriver =
    browser instanceof DesktopBrowserDriver
      ? browser
      : new DesktopBrowserDriver({
          channel: config.browserChannel,
          guard,
          fallbackDriver: browser,
        });

  const registry = new ToolRegistry();
  registry.register(systemNote);
  registry.register(systemWait);
  registry.register(systemCheckpoint);

  // Phase 2 Autonomous Browser Control Tools
  const autonomousTools = createAutonomousBrowserTools(desktopDriver, guard);
  for (const tool of autonomousTools) registry.register(tool);

  // Existing Browser Tools (preserved for research and compatibility)
  const browserTools = createBrowserTools(desktopDriver, guard);
  for (const tool of browserTools) registry.register(tool);

  const byName = (n: string) => browserTools.find((t) => t.name === n)!;
  for (const tool of createResearchTools({ driver: desktopDriver, guard, searchTool: byName("browser.search"), openTool: byName("browser.open") })) {
    registry.register(tool);
  }
  for (const tool of createSheetTools()) {
    registry.register(tool);
  }
  for (const tool of createSocialTools({ driver: desktopDriver, guard })) {
    registry.register(tool);
  }
  for (const tool of createDraftTools(llm)) {
    registry.register(tool);
  }
  return registry;
}
