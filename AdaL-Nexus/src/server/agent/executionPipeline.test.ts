import assert from "node:assert/strict";
import test, { describe, it, beforeEach } from "node:test";
import { Controller } from "./controller.js";
import { PolicyEngine } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import { parseLocalCommand } from "./localCommandParser.js";
import { taskContext } from "./taskContext.js";
import { createAutonomousBrowserTools } from "../browser/autonomousTools.js";
import { createBrowserTools } from "../browser/tools.js";
import { createResearchTools } from "../research/tools.js";
import { createSheetTools } from "../sheet/tools.js";
import { createDraftTools } from "../tools/draft.js";
import { createSocialTools } from "../social/tools.js";
import { systemCheckpoint, systemNote, systemWait } from "../tools/system.js";
import { UrlGuard } from "../browser/urlSafety.js";
import type { DesktopBrowserDriver } from "../browser/desktopDriver.js";

function createTestMockDriver(): DesktopBrowserDriver {
  return {
    isDesktopActive: async () => true,
    navigate: async (url: string) => ({
      url,
      title: url.includes("youtube") ? "YouTube" : "Web Page",
      tabId: "test_tab_1",
    }),
    inspect: async () => ({
      url: "https://example.com/test",
      title: "Test Page",
      headings: ["Heading 1"],
      elements: [{ index: 1, tag: "a", text: "Link 1", href: "https://example.com/item1" }],
      summary: "Sample test page content.",
      hasCaptcha: false,
      hasLoginForm: false,
      inspectedAt: new Date().toISOString(),
    }),
    observe: async (opts: any) => ({
      tabId: opts?.tabId || "test_tab_1",
      url: "https://www.youtube.com",
      title: "YouTube",
      summary: "YouTube homepage with trending videos",
      elementsCount: 20,
      headings: ["Home", "Subscriptions"],
      hasCaptcha: false,
      hasLoginForm: false,
    }),
    getTabs: async () => ({
      tabs: [{ id: "test_tab_1", url: "https://www.youtube.com", title: "YouTube" }],
      activeTabId: "test_tab_1",
    }),
    newTab: async (url?: string) => ({
      tab: { id: "test_tab_2", url: url || "adal://home", title: "New Tab" },
    }),
    closeTab: async (tabId?: string) => ({
      closedTabId: tabId || "test_tab_1",
    }),
    switchTab: async (tabId: string) => ({
      activeTabId: tabId,
    }),
    goBack: async () => ({ back: true }),
    goForward: async () => ({ forward: true }),
    refresh: async () => ({ reloaded: true }),
    playYouTubeVideo: async (query?: string) => ({
      played: true,
      query,
      pageTitle: `${query} - YouTube`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query || "")}`,
    }),
    pauseMedia: async () => ({
      success: true,
      pausedCount: 1,
      url: "https://www.youtube.com",
    }),
    screenshot: async () => ({
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    }),
    waitFor: async (opts?: any) => ({
      waited: true,
      elapsedMs: 50,
      condition: opts?.selector || "idle",
    }),
  } as unknown as DesktopBrowserDriver;
}

function buildTestRegistry(driver: DesktopBrowserDriver): ToolRegistry {
  const guard = new UrlGuard();
  const registry = new ToolRegistry();
  registry.register(systemNote);
  registry.register(systemWait);
  registry.register(systemCheckpoint);

  for (const t of createAutonomousBrowserTools(driver, guard)) registry.register(t);
  const browserTools = createBrowserTools(driver, guard);
  for (const t of browserTools) registry.register(t);

  const byName = (n: string) => browserTools.find((t) => t.name === n)!;
  for (const t of createResearchTools({ driver, guard, searchTool: byName("browser.search"), openTool: byName("browser.open") })) {
    registry.register(t);
  }
  for (const t of createSheetTools()) registry.register(t);
  for (const t of createDraftTools()) registry.register(t);
  for (const t of createSocialTools({ driver, guard })) registry.register(t);

  return registry;
}

describe("AdaL Nexus Autonomous Agent Execution Engine (Acceptance Matrix A-H)", () => {
  beforeEach(() => {
    taskContext.clear();
  });

  // --------------------------------------------------------------------------
  // Test A — Navigation
  // --------------------------------------------------------------------------
  it("Test A: Navigation — 'YouTube kholo' navigates and returns verified browser state", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const draft = parseLocalCommand("YouTube kholo");
    assert.ok(draft, "Failed to parse local command 'YouTube kholo'");
    assert.equal(draft.plan.steps[0].tool, "browser.open_url");
    assert.equal((draft.plan.steps[0].input as any).url, "https://www.youtube.com");

    const run = controller.start(draft.plan);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "completed");
    const stepOutput = snapshot?.steps[0].output as any;
    assert.match(stepOutput.url, /https:\/\/www\.youtube\.com/);
    assert.equal(stepOutput.title, "YouTube");
  });

  // --------------------------------------------------------------------------
  // Test B — New Tab
  // --------------------------------------------------------------------------
  it("Test B: New tab — 'Naya tab kholo' creates and activates a new real tab", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const draft = parseLocalCommand("Naya tab kholo");
    assert.ok(draft);
    assert.equal(draft.plan.steps[0].tool, "browser.new_tab");

    const run = controller.start(draft.plan);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "completed");
    const stepOutput = snapshot?.steps[0].output as any;
    assert.ok(stepOutput.tab?.id, "New tab did not return tab id");
  });

  // --------------------------------------------------------------------------
  // Test C — Research Workflow
  // --------------------------------------------------------------------------
  it("Test C: Research — 'Machine learning par research karo' produces multi-step evidence-based plan", async () => {
    const draft = parseLocalCommand("Machine learning par research karo");
    assert.ok(draft);
    assert.equal(draft.plan.steps.length, 3);
    assert.equal(draft.plan.steps[0].tool, "research.find_sources");
    assert.equal(draft.plan.steps[1].tool, "research.collect");
    assert.equal(draft.plan.steps[2].tool, "research.consolidate");

    // Verify $ref dataflow
    assert.deepEqual((draft.plan.steps[1].input as any).sources, { $ref: "find.sources" });
    assert.deepEqual((draft.plan.steps[2].input as any).records, { $ref: "collect.records" });

    // Verify context was stored
    assert.equal(taskContext.getLastTopic()?.toLowerCase(), "machine learning");
  });

  // --------------------------------------------------------------------------
  // Test D — Excel Workflow
  // --------------------------------------------------------------------------
  it("Test D: Excel — 'Research ka Excel bana do' asks for topic if missing, or reuses remembered context", async () => {
    // 1. Missing topic without context -> requests clarification
    taskContext.clear();
    const missing = parseLocalCommand("Research ka Excel bana do");
    assert.ok(missing);
    assert.equal(missing.plan.steps[0].tool, "system.note");
    assert.equal((missing.plan.steps[0].input as any).isClarification, true);

    // 2. With context topic remembered -> produces 5-step research to Excel pipeline
    taskContext.setLastTopic("Autonomous AI Agents");
    const withCtx = parseLocalCommand("Research ka Excel bana do");
    assert.ok(withCtx);
    assert.equal(withCtx.plan.steps.length, 5);
    assert.equal(withCtx.plan.steps[0].tool, "research.find_sources");
    assert.equal(withCtx.plan.steps[1].tool, "research.collect");
    assert.equal(withCtx.plan.steps[2].tool, "research.consolidate");
    assert.equal(withCtx.plan.steps[3].tool, "sheet.write");
    assert.equal(withCtx.plan.steps[4].tool, "sheet.verify");

    assert.deepEqual((withCtx.plan.steps[3].input as any).records, { $ref: "consolidate.records" });
    assert.deepEqual((withCtx.plan.steps[4].input as any).filePath, { $ref: "write.filePath" });
  });

  // --------------------------------------------------------------------------
  // Test E — Draft Creation
  // --------------------------------------------------------------------------
  it("Test E: Draft — 'Meri post ka draft taiyar karo' generates editable draft without publishing", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const draft = parseLocalCommand("Meri LinkedIn post ka draft taiyar karo");
    assert.ok(draft);
    assert.equal(draft.plan.steps[0].tool, "draft.create");
    assert.equal((draft.plan.steps[0].input as any).platform, "linkedin");

    const run = controller.start(draft.plan);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "completed");
    const output = snapshot?.steps[0].output as any;

    assert.ok(output.draftId);
    assert.equal(output.platform, "linkedin");
    assert.ok(output.caption.length > 0);
    assert.ok(output.fullContent.length > 0);
    assert.equal(output.isEditable, true);
    assert.equal(output.isPublished, false);
  });

  // --------------------------------------------------------------------------
  // Test F — Cancellation
  // --------------------------------------------------------------------------
  it("Test F: Cancellation — Cancelling a running multi-step task halts execution and prevents subsequent steps", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const multiStepPlan = {
      goal: "Multi-step cancellation test",
      steps: [
        { id: "s1", title: "First quick step", tool: "system.note", input: { text: "starting" } },
        { id: "s2", title: "Slow waiting step", tool: "system.wait", input: { ms: 5000 } },
        { id: "s3", title: "Third step that should never run", tool: "system.note", input: { text: "after wait" } },
      ],
    };

    const run = controller.start(multiStepPlan);
    // Allow step 1 to finish and step 2 to start waiting
    await new Promise((r) => setTimeout(r, 60));

    // Cancel while step 2 is in flight
    controller.cancel(run.runId);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "cancelled");
    const step2 = snapshot?.steps.find((s) => s.id === "s2");
    const step3 = snapshot?.steps.find((s) => s.id === "s3");

    assert.equal(step2?.status, "cancelled");
    assert.equal(step3?.status, "cancelled");
  });

  // --------------------------------------------------------------------------
  // Test G — Approval Gate for Consequential Actions
  // --------------------------------------------------------------------------
  it("Test G: Approval — Consequential action pauses at approval gate and only proceeds when approved", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const planWithGate = {
      goal: "Approval checkpoint test",
      steps: [
        { id: "prep", title: "Prepare content", tool: "system.note", input: { text: "ready" } },
        { id: "publish_gate", title: "Consequential Checkpoint", tool: "system.checkpoint", input: { action: "publish" } },
        { id: "finalize", title: "Final note", tool: "system.note", input: { text: "done" } },
      ],
    };

    const run = controller.start(planWithGate);
    await new Promise((r) => setTimeout(r, 50));

    let snap = controller.current()?.snapshot;
    assert.equal(snap?.status, "waiting_for_approval");
    assert.equal(snap?.currentStepId, "publish_gate");

    // Grant explicit approval
    controller.approve(run.runId, "publish_gate");
    await controller.whenFinished(run.runId);

    snap = controller.current()?.snapshot;
    assert.equal(snap?.status, "completed");
    assert.equal(snap?.steps.find((s) => s.id === "finalize")?.status, "completed");
  });

  // --------------------------------------------------------------------------
  // Test H — Failure Handling & Recovery
  // --------------------------------------------------------------------------
  it("Test H: Failure — Tool error produces actionable failure status and stops subsequent steps without fake success", async () => {
    const driver = createTestMockDriver();
    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const failingPlan = {
      goal: "Error handling test",
      steps: [
        {
          id: "bad_step",
          title: "Verify missing workbook",
          tool: "sheet.verify",
          input: { filePath: "definitely_non_existent_file_12345.xlsx" },
        },
        { id: "next_step", title: "Step after failure", tool: "system.note", input: { text: "unreachable" } },
      ],
    };

    const run = controller.start(failingPlan);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "failed");

    const failedStep = snapshot?.steps.find((s) => s.id === "bad_step");
    const nextStep = snapshot?.steps.find((s) => s.id === "next_step");

    assert.equal(failedStep?.status, "failed");
    assert.ok(failedStep?.reason, "Failed step did not record an actionable failure reason");
    assert.equal(nextStep?.status, "skipped");
  });

  // --------------------------------------------------------------------------
  // Test I — WhatsApp Navigation & Friend Messaging Execution
  // --------------------------------------------------------------------------
  it("Test I: WhatsApp — 'mera wahtsaap par jao aur maine apne dost ko message karne ko kaha' executes navigation to WhatsApp Web and guides user safely", async () => {
    let navigatedUrl = "";
    const driver = createTestMockDriver();
    driver.navigate = async (url: string) => {
      navigatedUrl = url;
      return { url, title: "WhatsApp", tabId: "test_tab_1" };
    };

    const registry = buildTestRegistry(driver);
    const controller = new Controller(registry, new PolicyEngine(registry));

    const draft = parseLocalCommand("mera wahtsaap par jao aur maine apne dost ko message karne ko kaha");
    assert.ok(draft, "Failed to parse WhatsApp user command");

    const run = controller.start(draft.plan);
    await controller.whenFinished(run.runId);

    const snapshot = controller.current()?.snapshot;
    assert.equal(snapshot?.status, "completed");
    assert.equal(navigatedUrl, "https://web.whatsapp.com/");
    const firstStep = snapshot?.steps[0];
    assert.equal(firstStep?.status, "completed");
    assert.equal(firstStep?.tool, "browser.open_url");
  });
});
