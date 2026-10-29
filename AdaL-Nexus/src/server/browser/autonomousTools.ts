import type { Tool, ToolContext, ToolResult } from "../agent/types.js";
import type { DesktopBrowserDriver } from "./desktopDriver.js";
import type { UrlGuard } from "./urlSafety.js";

function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

function ensureActive(ctx: ToolContext): void {
  if (ctx.signal.aborted) throw new Error("cancelled");
}

const short = (u: string) => (u.length > 90 ? `${u.slice(0, 87)}...` : u);

export function createAutonomousBrowserTools(
  driver: DesktopBrowserDriver,
  guard: UrlGuard,
): Tool[] {
  // ---------------------------------------------------------------- browser.navigate
  const navigateTool: Tool = {
    name: "browser.navigate",
    description:
      'Navigates the browser tab (or active WebContentsView) to a URL. Input: {"url": string, "tabId"?: string, "timeoutMs"?: number}. Validates safe URL protocol, enforces timeout, and reports page title and landing URL.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const rawUrl = field(input, "url");
      if (typeof rawUrl !== "string" || !rawUrl.trim()) {
        throw new Error('browser.navigate requires string input.url');
      }

      const verdict = await guard.check(rawUrl);
      if (!verdict.ok) {
        throw new Error(`Navigation blocked by security policy: ${verdict.reason}`);
      }

      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      const timeoutMs = typeof field(input, "timeoutMs") === "number" ? (field(input, "timeoutMs") as number) : 25_000;

      ctx.progress(`Navigating to ${short(verdict.url.href)}`);
      const navResult = await driver.navigate(verdict.url.href, {
        tabId,
        timeoutMs,
        signal: ctx.signal,
      });

      ensureActive(ctx);

      return {
        output: {
          url: navResult.url,
          title: navResult.title,
          tabId: navResult.tabId,
          navigatedAt: new Date().toISOString(),
        },
        note: `Navigated to "${navResult.title || navResult.url}" (${navResult.url}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.inspect
  const inspectTool: Tool = {
    name: "browser.inspect",
    description:
      'Inspects the active page DOM structure, text, and interactive elements. Input: {"tabId"?: string, "maxElements"?: number}. Returns title, URL, visible headings, interactive elements (buttons, inputs, links with index, selector, text), and text content. Detects CAPTCHAs, security blocks, and forms.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      const maxElements = typeof field(input, "maxElements") === "number" ? (field(input, "maxElements") as number) : 50;

      ctx.progress("Inspecting active page elements and content");
      const inspection = await driver.inspect({ tabId, maxElements, signal: ctx.signal });
      ensureActive(ctx);

      if (inspection.hasCaptcha) {
        return {
          verification: "unverified",
          note: "A CAPTCHA or bot verification challenge was detected on the page. Automated agents never bypass security controls. Please solve it manually in the browser window if appropriate.",
          output: inspection,
        };
      }

      return {
        output: {
          url: inspection.url,
          title: inspection.title,
          headings: inspection.headings,
          elementsCount: inspection.elements?.length || 0,
          interactiveElements: (inspection.elements || []).slice(0, maxElements),
          summary: inspection.summary?.slice(0, 3000),
          hasLoginForm: Boolean(inspection.hasLoginForm),
          inspectedAt: inspection.inspectedAt,
        },
        note: `Inspected "${inspection.title}": found ${inspection.elements?.length || 0} interactive elements and ${inspection.headings?.length || 0} headings.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.click
  const clickTool: Tool = {
    name: "browser.click",
    description:
      'Clicks a visible interactive element on the page. Input: {"selector"?: string, "text"?: string, "elementIndex"?: number, "tabId"?: string, "isFormSubmit"?: boolean, "description"?: string}. Sensitive if clicking form submit, purchase, publish, or account modification buttons (triggers user approval).',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const selector = typeof field(input, "selector") === "string" ? (field(input, "selector") as string) : undefined;
      const text = typeof field(input, "text") === "string" ? (field(input, "text") as string) : undefined;
      const elementIndex = typeof field(input, "elementIndex") === "number" ? (field(input, "elementIndex") as number) : undefined;
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      if (!selector && !text && elementIndex === undefined) {
        throw new Error("browser.click requires at least one of selector, text, or elementIndex");
      }

      const label = selector || text || `element #${elementIndex}`;
      ctx.progress(`Clicking ${short(label)}`);

      const result = await driver.click({
        selector,
        text,
        elementIndex,
        tabId,
        signal: ctx.signal,
      });

      ensureActive(ctx);

      return {
        output: {
          clicked: true,
          target: label,
          element: result.element,
          currentUrl: result.currentUrl,
          title: result.title,
          clickedAt: new Date().toISOString(),
        },
        note: `Clicked ${label}. Current page: "${result.title}" (${result.currentUrl}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.type
  const typeTool: Tool = {
    name: "browser.type",
    description:
      'Types text into a form input or search field on the page. Input: {"text": string, "selector"?: string, "elementIndex"?: number, "placeholder"?: string, "pressEnter"?: boolean, "tabId"?: string, "isSensitive"?: boolean}. Focuses the field, inputs text, and optionally presses Enter.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const text = field(input, "text");
      if (typeof text !== "string") {
        throw new Error("browser.type requires string input.text");
      }

      const selector = typeof field(input, "selector") === "string" ? (field(input, "selector") as string) : undefined;
      const elementIndex = typeof field(input, "elementIndex") === "number" ? (field(input, "elementIndex") as number) : undefined;
      const placeholder = typeof field(input, "placeholder") === "string" ? (field(input, "placeholder") as string) : undefined;
      const pressEnter = Boolean(field(input, "pressEnter"));
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      const fieldTarget = selector || placeholder || (elementIndex !== undefined ? `#${elementIndex}` : "focused field");
      ctx.progress(`Typing into ${short(fieldTarget)}: "${short(text)}"${pressEnter ? " (pressing Enter)" : ""}`);

      const result = await driver.type({
        text,
        selector,
        elementIndex,
        placeholder,
        pressEnter,
        tabId,
        signal: ctx.signal,
      });

      ensureActive(ctx);

      return {
        output: {
          typed: true,
          target: fieldTarget,
          charCount: text.length,
          pressedEnter: pressEnter,
          currentUrl: result.currentUrl,
          typedAt: new Date().toISOString(),
        },
        note: `Typed ${text.length} characters into ${fieldTarget}.${pressEnter ? " Pressed Enter." : ""}`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.scroll
  const scrollTool: Tool = {
    name: "browser.scroll",
    description:
      'Scrolls the visible browser viewport. Input: {"direction"?: "up" | "down" | "top" | "bottom", "amount"?: number, "tabId"?: string}. Smoothly scrolls to reveal new content.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const direction = typeof field(input, "direction") === "string" ? (field(input, "direction") as any) : "down";
      const amount = typeof field(input, "amount") === "number" ? (field(input, "amount") as number) : 500;
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      ctx.progress(`Scrolling viewport ${direction}`);
      const result = await driver.scroll({ direction, amount, tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          scrolled: true,
          direction,
          scrollY: result.scrollY,
          maxScroll: result.maxScroll,
          scrolledAt: new Date().toISOString(),
        },
        note: `Scrolled ${direction} (scrollY: ${result.scrollY}px).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.observe
  const observeTool: Tool = {
    name: "browser.observe",
    description:
      'Captures an observation snapshot of the current page state, active URL, title, element count, and summary. Useful for reporting selected results and final observations.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      ctx.progress("Capturing current page observation");
      const observation = await driver.observe({ tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          ...observation,
          observedAt: new Date().toISOString(),
        },
        note: `Observed page "${observation.title}" (${observation.url}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.upload
  const uploadTool: Tool = {
    name: "browser.upload",
    description:
      'Uploads an explicitly user-provided image or file into a file-input (<input type="file">) on the page. Input: {"filePath"?: string, "base64Data"?: string, "fileName"?: string, "selector"?: string, "elementIndex"?: number, "tabId"?: string}. Attaches the file, fires input/change events, and confirms attached files.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const filePath = typeof field(input, "filePath") === "string" ? (field(input, "filePath") as string) : undefined;
      const base64Data = typeof field(input, "base64Data") === "string" ? (field(input, "base64Data") as string) : undefined;
      const fileName = typeof field(input, "fileName") === "string" ? (field(input, "fileName") as string) : undefined;
      const selector = typeof field(input, "selector") === "string" ? (field(input, "selector") as string) : undefined;
      const elementIndex = typeof field(input, "elementIndex") === "number" ? (field(input, "elementIndex") as number) : undefined;
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      if (!filePath && !base64Data) {
        throw new Error("browser.upload requires either input.filePath or input.base64Data");
      }

      const displayName = fileName || (filePath ? filePath.split(/[/\\]/).pop() : "image.png");
      ctx.progress(`Uploading image "${displayName}" to file input`);

      const result = await driver.upload({
        filePath,
        base64Data,
        fileName: displayName,
        selector,
        elementIndex,
        tabId,
        signal: ctx.signal,
      });

      ensureActive(ctx);

      return {
        output: {
          uploaded: true,
          fileName: result.fileName || displayName,
          filesAttached: result.filesAttached || 1,
          currentUrl: result.currentUrl,
          uploadedAt: new Date().toISOString(),
        },
        note: `Successfully attached "${displayName}" to page file input.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.wait
  const waitTool: Tool = {
    name: "browser.wait",
    description:
      'Waits for a visible selector, text, or DOM state change with a bounded timeout. Input: {"selector"?: string, "text"?: string, "timeoutMs"?: number, "tabId"?: string}. Prevents blind timing assumptions.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const selector = typeof field(input, "selector") === "string" ? (field(input, "selector") as string) : undefined;
      const text = typeof field(input, "text") === "string" ? (field(input, "text") as string) : undefined;
      const timeoutMs = typeof field(input, "timeoutMs") === "number" ? (field(input, "timeoutMs") as number) : 10_000;
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      const condition = selector ? `selector "${selector}"` : text ? `text "${text}"` : "page idle";
      ctx.progress(`Waiting for ${condition} (up to ${Math.round(timeoutMs / 1000)}s)`);

      const result = await driver.waitFor({ selector, text, timeoutMs, tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          waited: true,
          condition,
          elapsedMs: result.elapsedMs,
          waitedAt: new Date().toISOString(),
        },
        note: `Condition met for ${condition} in ${result.elapsedMs || 0}ms.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.tabs
  const tabsTool: Tool = {
    name: "browser.tabs",
    description:
      'Lists all open browser tabs and identifies the active tab ID, title, and current URL.',
    async run(_input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      ctx.progress("Listing open browser tabs");
      const tabInfo = await driver.getTabs();
      ensureActive(ctx);

      return {
        output: {
          tabs: tabInfo.tabs,
          activeTabId: tabInfo.activeTabId,
          tabCount: tabInfo.tabs.length,
          inspectedAt: new Date().toISOString(),
        },
        note: `Found ${tabInfo.tabs.length} open tab(s). Active tab: ${tabInfo.activeTabId || "none"}.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.screenshot
  const screenshotTool: Tool = {
    name: "browser.screenshot",
    description:
      'Captures a high-resolution base64 PNG screenshot of the active browser viewport or specific tab. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      ctx.progress("Capturing viewport screenshot");
      const result = await driver.screenshot({ tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          screenshotCaptured: true,
          dataBase64: result.data,
          capturedAt: new Date().toISOString(),
        },
        note: "Captured browser viewport screenshot.",
      };
    },
  };

  // ---------------------------------------------------------------- browser.open_url
  const openUrlTool: Tool = {
    name: "browser.open_url",
    description:
      'Navigates the browser to an official URL or website (e.g. "https://www.youtube.com", "https://www.flipkart.com", "github.com"). Input: {"url": string, "tabId"?: string, "timeoutMs"?: number}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      let rawUrl = (field(input, "url") || field(input, "address")) as string;
      if (typeof rawUrl !== "string" || !rawUrl.trim()) {
        throw new Error('browser.open_url requires string input.url');
      }
      rawUrl = rawUrl.trim();
      if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith("adal://")) {
        rawUrl = `https://${rawUrl}`;
      }
      const verdict = await guard.check(rawUrl);
      if (!verdict.ok) {
        throw new Error(`Navigation blocked by security policy: ${verdict.reason}`);
      }
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      const timeoutMs = typeof field(input, "timeoutMs") === "number" ? (field(input, "timeoutMs") as number) : 25_000;

      ctx.progress(`Opening URL ${short(verdict.url.href)}`);
      const navResult = await driver.navigate(verdict.url.href, { tabId, timeoutMs, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          url: navResult.url,
          title: navResult.title,
          tabId: navResult.tabId,
          navigatedAt: new Date().toISOString(),
        },
        note: `Opened "${navResult.title || navResult.url}" (${navResult.url}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.new_tab
  const newTabTool: Tool = {
    name: "browser.new_tab",
    description:
      'Creates a new browser tab and optionally opens a URL in it. Input: {"url"?: string}. Returns the newly created tab ID.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      let rawUrl = (field(input, "url") || field(input, "address")) as string | undefined;
      if (rawUrl && typeof rawUrl === "string") {
        rawUrl = rawUrl.trim();
        if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith("adal://")) {
          rawUrl = `https://${rawUrl}`;
        }
        const verdict = await guard.check(rawUrl);
        if (!verdict.ok) {
          throw new Error(`Navigation blocked by security policy: ${verdict.reason}`);
        }
        rawUrl = verdict.url.href;
      }

      ctx.progress(`Creating new tab${rawUrl ? ` with ${short(rawUrl)}` : ""}`);
      const result = await driver.newTab(rawUrl, { signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          tab: result.tab,
          tabId: result.tab?.id,
          url: result.tab?.url || rawUrl || "adal://home",
          createdAt: new Date().toISOString(),
        },
        note: `Opened new tab (ID: ${result.tab?.id || "new"}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.switch_tab
  const switchTabTool: Tool = {
    name: "browser.switch_tab",
    description:
      'Switches to a specific browser tab or adjacent tab. Input: {"tabId"?: string, "target"?: "previous" | "next" | "last"}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      let targetTabId = field(input, "tabId") as string | undefined;
      const target = (field(input, "target") as string) || "previous";

      if (!targetTabId) {
        const current = await driver.getTabs();
        const tabs = current.tabs || [];
        const activeId = current.activeTabId;
        if (tabs.length <= 1) {
          return {
            output: { activeTabId: activeId, switched: false },
            note: "Only one tab open; already active.",
          };
        }
        const activeIndex = tabs.findIndex((t: any) => t.id === activeId);
        if (target === "previous") {
          const prevIdx = activeIndex > 0 ? activeIndex - 1 : tabs.length - 1;
          targetTabId = tabs[prevIdx].id;
        } else if (target === "next") {
          const nextIdx = activeIndex < tabs.length - 1 ? activeIndex + 1 : 0;
          targetTabId = tabs[nextIdx].id;
        } else {
          targetTabId = tabs[0].id;
        }
      }

      if (!targetTabId) {
        throw new Error("No browser tab available to switch to.");
      }

      ctx.progress(`Switching to tab ${targetTabId}`);
      const result = await driver.switchTab(targetTabId);
      ensureActive(ctx);

      return {
        output: {
          switched: true,
          activeTabId: result.activeTabId || targetTabId,
          switchedAt: new Date().toISOString(),
        },
        note: `Switched to tab ${result.activeTabId || targetTabId}.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.close_tab
  const closeTabTool: Tool = {
    name: "browser.close_tab",
    description:
      'Closes the specified browser tab or the active tab. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress(`Closing tab ${tabId || "active"}`);
      const result = await driver.closeTab(tabId, { signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          closed: true,
          closedTabId: result.closedTabId,
          activeTabId: result.activeTabId,
          remainingTabsCount: result.tabs?.length,
          closedAt: new Date().toISOString(),
        },
        note: `Closed tab ${result.closedTabId || "active"}.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.back
  const backTool: Tool = {
    name: "browser.back",
    description: 'Navigates back in the current tab history. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress("Navigating back in browser history");
      const result = await driver.goBack(tabId, { signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: { back: true, tabId: result.tabId, url: result.url },
        note: "Navigated back.",
      };
    },
  };

  // ---------------------------------------------------------------- browser.forward
  const forwardTool: Tool = {
    name: "browser.forward",
    description: 'Navigates forward in the current tab history. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress("Navigating forward in browser history");
      const result = await driver.goForward(tabId, { signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: { forward: true, tabId: result.tabId, url: result.url },
        note: "Navigated forward.",
      };
    },
  };

  // ---------------------------------------------------------------- browser.refresh
  const refreshTool: Tool = {
    name: "browser.refresh",
    description: 'Reloads/refreshes the current webpage. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress("Refreshing current webpage");
      const result = await driver.refresh(tabId, { signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: { refreshed: true, tabId: result.tabId, url: result.url },
        note: "Refreshed current page.",
      };
    },
  };

  // ---------------------------------------------------------------- browser.get_tabs
  const getTabsTool: Tool = {
    name: "browser.get_tabs",
    description: 'Retrieves all open browser tabs, titles, and active tab ID.',
    async run(_input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      ctx.progress("Retrieving open browser tabs");
      const result = await driver.getTabs();
      ensureActive(ctx);

      return {
        output: {
          tabs: result.tabs,
          activeTabId: result.activeTabId,
          tabCount: result.tabs.length,
        },
        note: `Found ${result.tabs.length} open tab(s). Active tab: ${result.activeTabId || "none"}.`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.get_current_page
  const getCurrentPageTool: Tool = {
    name: "browser.get_current_page",
    description:
      'Retrieves the current webpage URL, title, headings, and summary from the active or specified browser tab. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress("Inspecting current browser page");
      const obs = await driver.observe({ tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          url: obs.url,
          title: obs.title,
          summary: obs.summary,
          headings: obs.headings || [],
          tabId: obs.tabId || tabId || "active",
          observedAt: new Date().toISOString(),
        },
        note: `Current page: "${obs.title || obs.url}" (${obs.url}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.play_youtube_video
  const playYouTubeVideoTool: Tool = {
    name: "browser.play_youtube_video",
    description:
      'Searches for and plays a YouTube video in the browser. Input: {"query"?: string, "tabId"?: string}. Opens YouTube, finds the video, and attempts playback. Reports autoplay status honestly.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const query = typeof field(input, "query") === "string" ? (field(input, "query") as string) : "";
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;

      ctx.progress(`Playing YouTube video${query ? `: "${short(query)}"` : ""}`);
      const result = await driver.playYouTubeVideo(query, { tabId, signal: ctx.signal });
      ensureActive(ctx);

      if (result.autoplayBlocked) {
        return {
          output: result,
          note: `Opened "${result.pageTitle || query}". Autoplay was blocked by browser policy; please click Play in the video player.`,
          verification: "unverified",
        };
      }

      if (!result.played && result.error) {
        return {
          output: result,
          note: `YouTube navigation reached "${result.pageTitle || query}", but video playback could not be started: ${result.error}`,
          verification: "unverified",
        };
      }

      return {
        output: {
          played: true,
          title: result.pageTitle,
          url: result.url,
          currentTime: result.currentTime,
          duration: result.duration,
          playedAt: new Date().toISOString(),
        },
        note: `Playing "${result.pageTitle || query}" on YouTube (${result.url}).`,
      };
    },
  };

  // ---------------------------------------------------------------- browser.pause_media
  const pauseMediaTool: Tool = {
    name: "browser.pause_media",
    description: 'Pauses active media (video/audio) playback in the browser. Input: {"tabId"?: string}.',
    async run(input, ctx: ToolContext): Promise<ToolResult> {
      ensureActive(ctx);
      const tabId = typeof field(input, "tabId") === "string" ? (field(input, "tabId") as string) : undefined;
      ctx.progress("Pausing active media playback");
      const result = await driver.pauseMedia({ tabId, signal: ctx.signal });
      ensureActive(ctx);

      return {
        output: {
          paused: true,
          pausedCount: result.pausedCount || 0,
          url: result.url,
          pausedAt: new Date().toISOString(),
        },
        note: `Paused ${result.pausedCount || 0} media playback element(s).`,
      };
    },
  };

  return [
    navigateTool,
    openUrlTool,
    newTabTool,
    switchTabTool,
    closeTabTool,
    backTool,
    forwardTool,
    refreshTool,
    getTabsTool,
    getCurrentPageTool,
    playYouTubeVideoTool,
    pauseMediaTool,
    inspectTool,
    clickTool,
    typeTool,
    scrollTool,
    observeTool,
    uploadTool,
    waitTool,
    tabsTool,
    screenshotTool,
  ];
}
