import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import { PolicyEngine } from "../agent/policy.js";
import { ToolRegistry } from "../agent/registry.js";
import type { ToolContext } from "../agent/types.js";
import { createAutonomousBrowserTools } from "./autonomousTools.js";
import { DesktopBrowserDriver } from "./desktopDriver.js";
import { UrlGuard } from "./urlSafety.js";

const dummyCtx: ToolContext = {
  signal: new AbortController().signal,
  progress: () => {},
};

function createMockDriver(overrides: Partial<any> = {}): DesktopBrowserDriver {
  return {
    isDesktopActive: async () => true,
    navigate: async (url: string) => ({ url, title: "Mock Page Title", tabId: "tab_mock" }),
    inspect: async () => ({
      url: "https://example.com/test",
      title: "Mock Page",
      headings: ["Main Heading", "Sub Heading"],
      elements: [
        { index: 1, tag: "input", placeholder: "Search", selector: "input[placeholder='Search']" },
        { index: 2, tag: "button", text: "Submit Order", isSubmit: true, isSensitive: true, selector: "button.submit" },
      ],
      summary: "This is a mock page summary with sample text.",
      hasCaptcha: false,
      hasLoginForm: false,
      inspectedAt: new Date().toISOString(),
    }),
    click: async (opts: any) => ({
      clicked: true,
      element: { tagName: "button", text: opts.text || "btn" },
      currentUrl: "https://example.com/test",
      title: "Mock Page",
    }),
    type: async (opts: any) => ({
      typed: true,
      element: { tagName: "input", valueLength: opts.text.length },
      currentUrl: "https://example.com/test",
    }),
    scroll: async (opts: any) => ({
      scrollY: opts.direction === "down" ? 500 : 0,
      maxScroll: 2000,
    }),
    observe: async () => ({
      tabId: "tab_mock",
      url: "https://example.com/test",
      title: "Observed Title",
      summary: "Observed summary",
      elementsCount: 2,
      headings: ["Main Heading"],
      hasCaptcha: false,
      hasLoginForm: false,
    }),
    upload: async (opts: any) => ({
      uploaded: true,
      fileName: opts.fileName || "upload.png",
      filesAttached: 1,
      currentUrl: "https://example.com/test",
    }),
    waitFor: async (opts: any) => ({
      found: true,
      elapsedMs: 65,
    }),
    getTabs: async () => ({
      tabs: [{ id: "tab_mock", url: "https://example.com/test", title: "Mock Page" }],
      activeTabId: "tab_mock",
    }),
    screenshot: async () => ({
      data: "base64mockimagedata==",
    }),
    newTab: async (url?: string) => ({
      tab: { id: "tab_new_123", url: url || "adal://home", title: "New Tab" },
    }),
    switchTab: async (tabId: string) => ({
      activeTabId: tabId,
    }),
    closeTab: async (tabId?: string) => ({
      closedTabId: tabId || "tab_mock",
      activeTabId: "tab_adjacent",
      tabs: [],
    }),
    goBack: async (tabId?: string) => ({
      back: true,
      tabId: tabId || "tab_mock",
      url: "https://example.com/previous",
    }),
    goForward: async (tabId?: string) => ({
      forward: true,
      tabId: tabId || "tab_mock",
      url: "https://example.com/next",
    }),
    refresh: async (tabId?: string) => ({
      reloaded: true,
      tabId: tabId || "tab_mock",
      url: "https://example.com/test",
    }),
    playYouTubeVideo: async (query?: string) => ({
      played: true,
      pageTitle: query ? `${query} - YouTube` : "YouTube",
      url: "https://www.youtube.com/watch?v=mock123",
      currentTime: 0,
      duration: 240,
    }),
    pauseMedia: async () => ({
      success: true,
      pausedCount: 1,
      url: "https://www.youtube.com/watch?v=mock123",
    }),
    ...overrides,
  } as unknown as DesktopBrowserDriver;
}

describe("Phase 2 Autonomous Browser Tools", () => {
  const guard = new UrlGuard();

  it("browser.navigate: validates URL and calls driver", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const navTool = tools.find((t) => t.name === "browser.navigate")!;

    // Rejects empty
    await assert.rejects(async () => {
      await navTool.run({}, dummyCtx);
    }, /input\.url/);

    // Rejects non-http protocol
    await assert.rejects(async () => {
      await navTool.run({ url: "javascript:alert(1)" }, dummyCtx);
    }, /blocked by security policy/);

    // Rejects private IP
    await assert.rejects(async () => {
      await navTool.run({ url: "http://192.168.1.1/admin" }, dummyCtx);
    }, /blocked by security policy/);

    // Success on valid public URL
    const res = await navTool.run({ url: "https://example.com/startups" }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.url, "https://example.com/startups");
    assert.equal(out.title, "Mock Page Title");
    assert.ok(res.note?.includes("Mock Page Title"));
  });

  it("browser.inspect: extracts page structure and flags CAPTCHAs honestly", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const inspectTool = tools.find((t) => t.name === "browser.inspect")!;

    const res = await inspectTool.run({ maxElements: 10 }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.title, "Mock Page");
    assert.equal(out.headings.length, 2);
    assert.equal(out.interactiveElements.length, 2);
    assert.equal(out.hasLoginForm, false);

    // Test CAPTCHA detection
    const captchaDriver = createMockDriver({
      inspect: async () => ({
        url: "https://example.com/blocked",
        title: "Just a moment...",
        headings: ["Cloudflare Turnstile"],
        elements: [],
        summary: "Please verify you are human",
        hasCaptcha: true,
        hasLoginForm: false,
        inspectedAt: new Date().toISOString(),
      }),
    });
    const captchaTools = createAutonomousBrowserTools(captchaDriver, guard);
    const captchaInspect = captchaTools.find((t) => t.name === "browser.inspect")!;

    const captchaRes = await captchaInspect.run({}, dummyCtx);
    assert.equal(captchaRes.verification, "unverified");
    assert.ok(captchaRes.note?.includes("CAPTCHA or bot verification challenge was detected"));
  });

  it("browser.click: validates target and executes click", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const clickTool = tools.find((t) => t.name === "browser.click")!;

    // Rejects without selector/text/index
    await assert.rejects(async () => {
      await clickTool.run({}, dummyCtx);
    }, /at least one of selector, text, or elementIndex/);

    const res = await clickTool.run({ text: "Next Page" }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.clicked, true);
    assert.equal(out.target, "Next Page");
  });

  it("browser.type: inputs text into field and optionally presses Enter", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const typeTool = tools.find((t) => t.name === "browser.type")!;

    // Rejects missing text
    await assert.rejects(async () => {
      await typeTool.run({ selector: "input" }, dummyCtx);
    }, /input\.text/);

    const res = await typeTool.run(
      { selector: "input[placeholder='Search']", text: "Quantum AI", pressEnter: true },
      dummyCtx,
    );
    const out = res.output as any;
    assert.equal(out.typed, true);
    assert.equal(out.charCount, 10);
    assert.equal(out.pressedEnter, true);
  });

  it("browser.scroll: executes smooth scroll", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const scrollTool = tools.find((t) => t.name === "browser.scroll")!;

    const res = await scrollTool.run({ direction: "down", amount: 600 }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.scrolled, true);
    assert.equal(out.direction, "down");
    assert.equal(out.scrollY, 500);
  });

  it("browser.observe: captures page state summary", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const observeTool = tools.find((t) => t.name === "browser.observe")!;

    const res = await observeTool.run({}, dummyCtx);
    const out = res.output as any;
    assert.equal(out.url, "https://example.com/test");
    assert.equal(out.title, "Observed Title");
    assert.ok(res.note?.includes("Observed Title"));
  });

  it("browser.upload: validates input and attaches image file", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const uploadTool = tools.find((t) => t.name === "browser.upload")!;

    // Rejects when neither filePath nor base64Data is provided
    await assert.rejects(async () => {
      await uploadTool.run({}, dummyCtx);
    }, /input\.filePath or input\.base64Data/);

    // Succeeds with base64 data
    const res = await uploadTool.run(
      { base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAE=", fileName: "test.png" },
      dummyCtx,
    );
    const out = res.output as any;
    assert.equal(out.uploaded, true);
    assert.equal(out.fileName, "test.png");
    assert.equal(out.filesAttached, 1);
    assert.ok(res.note?.includes("test.png"));
  });

  it("browser.wait: waits for condition with bounded timeout", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const waitTool = tools.find((t) => t.name === "browser.wait")!;

    const res = await waitTool.run({ selector: "#target-card", timeoutMs: 5000 }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.waited, true);
    assert.equal(out.elapsedMs, 65);
    assert.ok(res.note?.includes("selector \"#target-card\""));
  });

  it("browser.tabs: lists open tabs and identifies active tab", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const tabsTool = tools.find((t) => t.name === "browser.tabs")!;

    const res = await tabsTool.run({}, dummyCtx);
    const out = res.output as any;
    assert.equal(out.tabCount, 1);
    assert.equal(out.activeTabId, "tab_mock");
    assert.ok(res.note?.includes("tab_mock"));
  });

  it("browser.screenshot: captures base64 viewport image", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const ssTool = tools.find((t) => t.name === "browser.screenshot")!;

    const res = await ssTool.run({}, dummyCtx);
    const out = res.output as any;
    assert.equal(out.screenshotCaptured, true);
    assert.equal(out.dataBase64, "base64mockimagedata==");
  });

  it("enforces cancellation via AbortSignal", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const navTool = tools.find((t) => t.name === "browser.navigate")!;

    const abortCtrl = new AbortController();
    abortCtrl.abort();

    await assert.rejects(async () => {
      await navTool.run({ url: "https://example.com" }, { signal: abortCtrl.signal, progress: () => {} });
    }, /cancelled/);
  });
});

describe("PolicyEngine Sensitive Action Detection", () => {
  const guard = new UrlGuard();
  const mockDriver = createMockDriver();
  const tools = createAutonomousBrowserTools(mockDriver, guard);
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  const policy = new PolicyEngine(registry);

  it("allows safe autonomous browser actions", () => {
    // Navigating to public site
    assert.deepEqual(
      policy.evaluate({
        id: "step1",
        title: "Open YouTube",
        tool: "browser.navigate",
        input: { url: "https://www.youtube.com" },
      }),
      { kind: "allow" },
    );

    // Searching in search bar
    assert.deepEqual(
      policy.evaluate({
        id: "step2",
        title: "Search for Robotics",
        tool: "browser.type",
        input: { placeholder: "Search", text: "Robotics startups", pressEnter: true },
      }),
      { kind: "allow" },
    );

    // Inspecting page
    assert.deepEqual(
      policy.evaluate({
        id: "step3",
        title: "Inspect Results",
        tool: "browser.inspect",
        input: {},
      }),
      { kind: "allow" },
    );

    // Scrolling
    assert.deepEqual(
      policy.evaluate({
        id: "step4",
        title: "Scroll Down",
        tool: "browser.scroll",
        input: { direction: "down" },
      }),
      { kind: "allow" },
    );
  });

  it("requires approval for sensitive actions (form submit, purchase, publish, account settings)", () => {
    // 1. Explicit form submit flag
    const submitDecision = policy.evaluate({
      id: "submit_step",
      title: "Submit application form",
      tool: "browser.click",
      input: { selector: "#submit-btn", isFormSubmit: true },
    });
    assert.equal(submitDecision.kind, "require_approval");
    assert.ok((submitDecision as any).reason.includes("submits a form"));

    // 2. Sensitive keyword: checkout / purchase
    const purchaseDecision = policy.evaluate({
      id: "buy_step",
      title: "Click checkout button",
      tool: "browser.click",
      input: { text: "Checkout now with credit card" },
    });
    assert.equal(purchaseDecision.kind, "require_approval");
    assert.ok((purchaseDecision as any).reason.includes("checkout"));

    // 3. Sensitive keyword: publish content
    const publishDecision = policy.evaluate({
      id: "publish_step",
      title: "Publish post",
      tool: "browser.click",
      input: { text: "Publish now to feed" },
    });
    assert.equal(publishDecision.kind, "require_approval");
    assert.ok((publishDecision as any).reason.includes("publish"));

    // 4. Sensitive keyword: account password / settings
    const passwordDecision = policy.evaluate({
      id: "pwd_step",
      title: "Enter account password",
      tool: "browser.type",
      input: { isSensitive: true, text: "my-secret-password" },
    });
    assert.equal(passwordDecision.kind, "require_approval");
  });

  it("browser.open_url: opens canonicalized URLs safely", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const openTool = tools.find((t) => t.name === "browser.open_url")!;

    const res = await openTool.run({ url: "https://www.youtube.com" }, dummyCtx);
    const out = res.output as any;
    assert.equal(out.url, "https://www.youtube.com/");
    assert.equal(out.title, "Mock Page Title");
  });

  it("browser.new_tab & browser.close_tab: manages browser tabs", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const newTabTool = tools.find((t) => t.name === "browser.new_tab")!;
    const closeTabTool = tools.find((t) => t.name === "browser.close_tab")!;

    const newRes = await newTabTool.run({ url: "https://www.google.com" }, dummyCtx);
    assert.equal((newRes.output as any).tabId, "tab_new_123");

    const closeRes = await closeTabTool.run({ tabId: "tab_new_123" }, dummyCtx);
    assert.equal((closeRes.output as any).closed, true);
    assert.equal((closeRes.output as any).closedTabId, "tab_new_123");
  });

  it("browser.switch_tab, browser.back, browser.forward, browser.refresh: controls tab state", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const switchTool = tools.find((t) => t.name === "browser.switch_tab")!;
    const backTool = tools.find((t) => t.name === "browser.back")!;
    const fwdTool = tools.find((t) => t.name === "browser.forward")!;
    const refreshTool = tools.find((t) => t.name === "browser.refresh")!;

    const switchRes = await switchTool.run({ tabId: "tab_target" }, dummyCtx);
    assert.equal((switchRes.output as any).switched, true);

    const backRes = await backTool.run({}, dummyCtx);
    assert.equal((backRes.output as any).back, true);

    const fwdRes = await fwdTool.run({}, dummyCtx);
    assert.equal((fwdRes.output as any).forward, true);

    const refRes = await refreshTool.run({}, dummyCtx);
    assert.equal((refRes.output as any).refreshed, true);
  });

  it("browser.play_youtube_video & browser.pause_media: controls media playback and reports autoplay policy honestly", async () => {
    const mockDriver = createMockDriver();
    const tools = createAutonomousBrowserTools(mockDriver, guard);
    const ytTool = tools.find((t) => t.name === "browser.play_youtube_video")!;
    const pauseTool = tools.find((t) => t.name === "browser.pause_media")!;

    const ytRes = await ytTool.run({ query: "Arijit Singh" }, dummyCtx);
    assert.equal((ytRes.output as any).played, true);
    assert.match((ytRes.output as any).title, /Arijit Singh/);

    const pauseRes = await pauseTool.run({}, dummyCtx);
    assert.equal((pauseRes.output as any).paused, true);
    assert.equal((pauseRes.output as any).pausedCount, 1);

    // Test honest autoplay blocked reporting
    const blockedDriver = createMockDriver({
      playYouTubeVideo: async () => ({
        played: false,
        autoplayBlocked: true,
        error: "Autoplay blocked by browser policy",
        pageTitle: "Arijit Singh - YouTube",
        url: "https://www.youtube.com/watch?v=mock123",
      }),
    });
    const blockedTools = createAutonomousBrowserTools(blockedDriver, guard);
    const blockedYtTool = blockedTools.find((t) => t.name === "browser.play_youtube_video")!;
    const blockedRes = await blockedYtTool.run({ query: "Arijit Singh" }, dummyCtx);
    assert.equal(blockedRes.verification, "unverified");
    assert.ok(blockedRes.note?.includes("Autoplay was blocked by browser policy"));
  });
});
