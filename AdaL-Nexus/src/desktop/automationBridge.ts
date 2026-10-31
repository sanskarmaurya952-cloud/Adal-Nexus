import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { TabManager } from "./tabManager.js";
import { isNavigationUrlSafe, resolveAddressBarInput } from "./urlPolicy.js";

export interface AutomationBridgeOptions {
  tabManager: TabManager;
  port?: number;
  bridgeFilePath?: string;
}

export interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  text: string;
  ariaLabel?: string;
  placeholder?: string;
  selector: string;
  href?: string;
  isSubmit?: boolean;
  isSensitive?: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface PageInspectionResult {
  url: string;
  title: string;
  headings: string[];
  elements: InteractiveElement[];
  summary: string;
  hasCaptcha: boolean;
  hasLoginForm: boolean;
  inspectedAt: string;
}

// In-page script executed in the context of the WebContentsView to inspect structure
const IN_PAGE_INSPECT_SCRIPT = `(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const getCleanText = (el) => {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  };

  const generateSelector = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
    if (el.getAttribute("aria-label")) {
      return el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(el.getAttribute("aria-label")) + '"]';
    }
    if (el.getAttribute("placeholder")) {
      return el.tagName.toLowerCase() + '[placeholder="' + CSS.escape(el.getAttribute("placeholder")) + '"]';
    }
    // Tag + first meaningful class
    const tag = el.tagName.toLowerCase();
    const className = typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : "";
    if (className && !className.includes(":") && !className.includes("/")) {
      return tag + '.' + CSS.escape(className);
    }
    return tag;
  };

  // 1. Detect CAPTCHAs and Bot Walls
  const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
  const hasCaptcha = 
    bodyText.includes("verify you are human") ||
    bodyText.includes("confirm you are not a robot") ||
    bodyText.includes("recaptcha") ||
    bodyText.includes("cf-turnstile") ||
    document.querySelector('iframe[src*="recaptcha"], iframe[src*="turnstile"], #challenge-running, .cf-turnstile') !== null;

  // 2. Detect Login / Password Forms
  const hasLoginForm = document.querySelector('input[type="password"]') !== null;

  // 3. Headings
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter(isVisible)
    .slice(0, 15)
    .map(getCleanText)
    .filter((h) => h.length > 0 && h.length < 200);

  // 4. Interactive Elements (buttons, inputs, links, select, textarea)
  const candidateNodes = Array.from(
    document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [tabindex='0']")
  ).filter(isVisible).slice(0, 80);

  const elements = [];
  let idx = 0;
  for (const node of candidateNodes) {
    const tag = node.tagName.toLowerCase();
    const text = getCleanText(node).slice(0, 150);
    const ariaLabel = node.getAttribute("aria-label") || undefined;
    const placeholder = node.getAttribute("placeholder") || undefined;
    const type = node.getAttribute("type") || (tag === "button" ? "button" : undefined);
    const href = node.getAttribute("href") || undefined;
    const rect = node.getBoundingClientRect();

    const lowerText = (text + " " + (ariaLabel || "")).toLowerCase();
    const isSubmit = type === "submit" || lowerText.includes("submit") || lowerText.includes("buy now") || lowerText.includes("checkout") || lowerText.includes("confirm order");
    const isSensitive = isSubmit || type === "password" || lowerText.includes("delete") || lowerText.includes("publish") || lowerText.includes("billing") || lowerText.includes("payment");

    elements.push({
      index: ++idx,
      tag,
      type,
      text,
      ariaLabel,
      placeholder,
      selector: generateSelector(node),
      href,
      isSubmit,
      isSensitive,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  // 5. Summary text
  const rawBodyText = (document.body ? document.body.innerText : "").slice(0, 10000);
  const cleanSummary = rawBodyText.replace(/\\s+/g, " ").trim().slice(0, 4000);

  return {
    url: window.location.href,
    title: document.title || "",
    headings,
    elements,
    summary: cleanSummary,
    hasCaptcha,
    hasLoginForm,
    inspectedAt: new Date().toISOString(),
  };
})()`;

export class AutomationBridge {
  private server: http.Server | null = null;
  private port = 0;
  private readonly secretToken: string;
  private readonly tabManager: TabManager;
  private readonly bridgeFilePath: string;

  constructor(options: AutomationBridgeOptions) {
    this.tabManager = options.tabManager;
    this.secretToken = crypto.randomBytes(16).toString("hex");
    let defaultBridgePath = path.resolve(process.cwd(), ".desktop-bridge.json");
    try {
      const userDir = path.join(os.homedir(), ".adal-nexus");
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      defaultBridgePath = path.join(userDir, "desktop-bridge.json");
    } catch {}
    this.bridgeFilePath = options.bridgeFilePath || defaultBridgePath;
    if (options.port) this.port = options.port;
  }

  async start(): Promise<{ port: number; token: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enforce loopback only
        const remoteIp = req.socket.remoteAddress;
        if (remoteIp !== "127.0.0.1" && remoteIp !== "::1" && remoteIp !== "::ffff:127.0.0.1") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden: Localhost access only" }));
          return;
        }

        // Verify Bearer Token
        const authHeader = req.headers.authorization;
        const providedToken = authHeader?.replace(/^Bearer\s+/i, "");
        if (providedToken !== this.secretToken) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing bridge token" }));
          return;
        }

        const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);

        // Health / Status Check
        if (req.method === "GET" && url.pathname === "/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            activeTabId: this.tabManager.getActiveTabId(),
            tabCount: this.tabManager.getTabs().length,
            time: new Date().toISOString(),
          }));
          return;
        }

        // Action Dispatcher
        if (req.method === "POST" && url.pathname === "/action") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 512 * 1024) req.destroy(); // 512KB max
          });
          req.on("end", async () => {
            try {
              const payload = JSON.parse(body);
              const result = await this.handleAction(payload.action, payload.tabId, payload.params || {});
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, result }));
            } catch (err: any) {
              res.writeHead(err.statusCode || 500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
            }
          });
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });

      // Try starting on preferred port, or fall back to any available port
      const targetPort = this.port || 39841;
      this.server.listen(targetPort, "127.0.0.1", () => {
        const addr = this.server?.address();
        this.port = typeof addr === "object" && addr ? addr.port : targetPort;
        this.writeBridgeFile();
        console.log(`[Desktop AutomationBridge] Listening on http://127.0.0.1:${this.port}`);
        resolve({ port: this.port, token: this.secretToken });
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE" && targetPort !== 0) {
          console.warn(`[Desktop AutomationBridge] Port ${targetPort} in use, picking random free port...`);
          this.server?.listen(0, "127.0.0.1");
        } else {
          reject(err);
        }
      });
    });
  }

  private writeBridgeFile(): void {
    const data = {
      port: this.port,
      token: this.secretToken,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    const content = JSON.stringify(data, null, 2);
    const targetPaths = [
      this.bridgeFilePath,
      path.resolve(os.tmpdir(), "adal-nexus-desktop-bridge.json"),
    ];
    for (const p of targetPaths) {
      try {
        fs.writeFileSync(p, content, "utf-8");
      } catch (err) {
        console.warn(`[Desktop AutomationBridge] Could not write bridge file to ${p}:`, err);
      }
    }
  }

  private removeBridgeFile(): void {
    const targetPaths = [
      this.bridgeFilePath,
      path.resolve(os.tmpdir(), "adal-nexus-desktop-bridge.json"),
    ];
    for (const p of targetPaths) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.pid === process.pid) {
            fs.unlinkSync(p);
          }
        }
      } catch {}
    }
  }

  async stop(): Promise<void> {
    this.removeBridgeFile();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }
  }

  // --------------------------------------------------------------------------
  // Core Action Handlers
  // --------------------------------------------------------------------------

  private getInternalTab(tabId?: string) {
    const tabs = (this.tabManager as any).tabs as any[];
    if (!tabs || tabs.length === 0) {
      throw new Error("No browser tabs open");
    }
    const targetId = tabId || this.tabManager.getActiveTabId();
    const tab = tabs.find((t) => t.id === targetId) || tabs[0];
    if (!tab) throw new Error(`Tab not found: ${targetId}`);
    return tab;
  }

  private async handleAction(action: string, tabId: string | undefined, params: any): Promise<any> {
    switch (action) {
      case "getTabs": {
        return {
          tabs: this.tabManager.getTabs(),
          activeTabId: this.tabManager.getActiveTabId(),
        };
      }

      case "createTab": {
        const newTab = this.tabManager.createTab(params.url);
        return { tab: newTab };
      }

      case "switchTab": {
        if (!params.tabId) throw new Error("switchTab requires params.tabId");
        this.tabManager.switchTab(params.tabId);
        return { activeTabId: this.tabManager.getActiveTabId() };
      }

      case "closeTab": {
        const targetId = params?.tabId || tabId || this.tabManager.getActiveTabId();
        if (!targetId) throw new Error("No active tab to close");
        this.tabManager.closeTab(targetId);
        return {
          closedTabId: targetId,
          activeTabId: this.tabManager.getActiveTabId(),
          tabs: this.tabManager.getTabs(),
        };
      }

      case "goBack": {
        const tab = this.getInternalTab(tabId);
        this.tabManager.goBack(tab.id);
        return { tabId: tab.id, url: tab.view.webContents.getURL() };
      }

      case "goForward": {
        const tab = this.getInternalTab(tabId);
        this.tabManager.goForward(tab.id);
        return { tabId: tab.id, url: tab.view.webContents.getURL() };
      }

      case "reload": {
        const tab = this.getInternalTab(tabId);
        this.tabManager.reload(tab.id);
        return { tabId: tab.id, url: tab.view.webContents.getURL() };
      }

      case "playYouTubeVideo": {
        const tab = this.getInternalTab(tabId);
        const query = params?.query ? String(params.query).trim() : "";
        const wc = tab.view.webContents;
        const currentUrl = wc.getURL();

        if (query) {
          const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
          if (!currentUrl.includes("youtube.com/watch") && !currentUrl.includes(encodeURIComponent(query))) {
            this.tabManager.navigate(tab.id, ytSearchUrl);
            await new Promise((r) => setTimeout(r, 2000));
          }
        } else if (!currentUrl.includes("youtube.com")) {
          this.tabManager.navigate(tab.id, "https://www.youtube.com");
          await new Promise((r) => setTimeout(r, 2000));
        }

        const nowUrl = wc.getURL();
        if (nowUrl.includes("youtube.com/results")) {
          const clickVideoScript = `(() => {
            const videoLinks = Array.from(document.querySelectorAll('ytd-video-renderer a#video-title, a.ytd-video-renderer, a[href*="/watch?v="]'))
              .filter(a => a.href && a.href.includes('/watch?v='));
            if (videoLinks.length > 0) {
              const target = videoLinks[0];
              const title = (target.innerText || target.title || '').trim();
              target.click();
              return { clicked: true, title, href: target.href };
            }
            return { clicked: false };
          })()`;

          const clickRes = await wc.executeJavaScript(clickVideoScript).catch(() => ({ clicked: false }));
          if (clickRes.clicked) {
            await new Promise((r) => setTimeout(r, 2200));
          }
        }

        const playScript = `(() => {
          const video = document.querySelector('video');
          const titleEl = document.querySelector('h1.ytd-watch-metadata') || document.querySelector('h1 yt-formatted-string') || document.querySelector('h1');
          const pageTitle = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : document.title;
          
          if (!video) {
            return {
              played: false,
              error: 'No video element found on YouTube page',
              pageTitle,
              url: window.location.href,
            };
          }

          try {
            const p = video.play();
            if (p && typeof p.then === 'function') {
              return p.then(() => ({
                played: true,
                pageTitle,
                currentTime: Math.round(video.currentTime),
                duration: Math.round(video.duration || 0),
                paused: video.paused,
                muted: video.muted,
                url: window.location.href,
              })).catch((err) => ({
                played: false,
                autoplayBlocked: true,
                error: 'Autoplay was blocked by browser policy. Click Play in the video player.',
                pageTitle,
                url: window.location.href,
              }));
            }
            return {
              played: true,
              pageTitle,
              currentTime: Math.round(video.currentTime),
              duration: Math.round(video.duration || 0),
              paused: video.paused,
              url: window.location.href,
            };
          } catch (err) {
            return {
              played: false,
              autoplayBlocked: true,
              error: String(err),
              pageTitle,
              url: window.location.href,
            };
          }
        })()`;

        const playResult = await wc.executeJavaScript(playScript).catch((err: any) => ({
          played: false,
          error: String(err),
          pageTitle: wc.getTitle(),
          url: wc.getURL(),
        }));

        return {
          tabId: tab.id,
          query: query || undefined,
          ...playResult,
        };
      }

      case "pauseMedia": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const pauseScript = `(() => {
          const media = Array.from(document.querySelectorAll('video, audio'));
          let pausedCount = 0;
          for (const m of media) {
            if (!m.paused) {
              m.pause();
              pausedCount++;
            }
          }
          return {
            success: true,
            pausedCount,
            totalMediaFound: media.length,
            url: window.location.href,
          };
        })()`;

        const result = await wc.executeJavaScript(pauseScript).catch(() => ({
          success: false,
          pausedCount: 0,
          url: wc.getURL(),
        }));

        return {
          tabId: tab.id,
          ...result,
        };
      }

      case "navigate": {
        const tab = this.getInternalTab(tabId);
        const rawUrl = params.url;
        if (!rawUrl || typeof rawUrl !== "string") {
          throw new Error("navigate requires string params.url");
        }

        const resolved = resolveAddressBarInput(rawUrl);
        if (!resolved.isValid) {
          throw new Error(`Invalid navigation target: ${resolved.error}`);
        }

        if (!isNavigationUrlSafe(resolved.url)) {
          throw new Error(`Navigation blocked by security policy: ${resolved.url}`);
        }

        const timeoutMs = params.timeoutMs || 25_000;
        const wc = tab.view.webContents;

        // Load the URL and wait for load stop or timeout
        const loadPromise = new Promise<void>((resolve, reject) => {
          let timer: NodeJS.Timeout;

          const onStop = () => {
            clearTimeout(timer);
            wc.removeListener("did-fail-load", onFail);
            resolve();
          };

          const onFail = (_evt: any, errorCode: number, errorDesc: string) => {
            if (errorCode === -3) return; // user abort
            clearTimeout(timer);
            wc.removeListener("did-stop-loading", onStop);
            reject(new Error(`Failed to load page: ${errorDesc} (${errorCode})`));
          };

          timer = setTimeout(() => {
            wc.removeListener("did-stop-loading", onStop);
            wc.removeListener("did-fail-load", onFail);
            resolve(); // Resolve on timeout to allow reading partial content
          }, timeoutMs);

          wc.once("did-stop-loading", onStop);
          wc.once("did-fail-load", onFail);
        });

        this.tabManager.navigate(tab.id, resolved.url);
        await loadPromise;

        // Brief delay for dynamic JS hydrations
        await new Promise((r) => setTimeout(r, 800));

        return {
          url: wc.getURL(),
          title: wc.getTitle(),
          tabId: tab.id,
        };
      }

      case "inspect": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const inspection: PageInspectionResult = await wc.executeJavaScript(IN_PAGE_INSPECT_SCRIPT);
        return inspection;
      }

      case "click": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;

        const selector = params.selector;
        const text = params.text;
        const elementIndex = params.elementIndex;
        const x = params.x;
        const y = params.y;

        const clickScript = `((sel, txt, idx, cx, cy) => {
          let target = null;
          if (idx !== undefined && idx !== null) {
            const candidates = Array.from(document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [tabindex='0']"))
              .filter(el => {
                const s = window.getComputedStyle(el);
                return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
              });
            target = candidates[idx - 1] || null;
          }
          if (!target && sel) {
            target = document.querySelector(sel);
          }
          if (!target && txt) {
            const lower = txt.toLowerCase();
            const all = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']"));
            target = all.find(el => (el.innerText || el.textContent || "").toLowerCase().includes(lower)) || null;
          }
          if (!target && cx !== undefined && cy !== undefined) {
            target = document.elementFromPoint(cx, cy);
          }
          if (!target) return { success: false, error: "Element not found" };

          target.scrollIntoView({ behavior: 'instant', block: 'center' });
          target.focus();
          target.click();

          return {
            success: true,
            tagName: target.tagName.toLowerCase(),
            text: (target.innerText || target.textContent || "").slice(0, 100),
          };
        })(${JSON.stringify(selector || null)}, ${JSON.stringify(text || null)}, ${elementIndex ?? null}, ${x ?? null}, ${y ?? null})`;

        const clickResult = await wc.executeJavaScript(clickScript);
        if (!clickResult.success) {
          throw new Error(`Click failed: ${clickResult.error}`);
        }

        // Brief delay to allow click side-effects to start
        await new Promise((r) => setTimeout(r, 600));

        return {
          clicked: true,
          element: clickResult,
          currentUrl: wc.getURL(),
          title: wc.getTitle(),
        };
      }

      case "type": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const textToType = params.text;
        if (typeof textToType !== "string") {
          throw new Error("type requires string params.text");
        }

        const selector = params.selector;
        const elementIndex = params.elementIndex;
        const placeholder = params.placeholder;
        const pressEnter = Boolean(params.pressEnter);

        const typeScript = `((sel, txt, idx, ph, enter) => {
          let target = null;
          if (idx !== undefined && idx !== null) {
            const inputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
              .filter(el => el.getBoundingClientRect().width > 0);
            target = inputs[idx - 1] || null;
          }
          if (!target && sel) {
            target = document.querySelector(sel);
          }
          if (!target && ph) {
            target = document.querySelector('input[placeholder*="' + CSS.escape(ph) + '"], textarea[placeholder*="' + CSS.escape(ph) + '"]');
          }
          if (!target) {
            // Default to currently focused element, or first visible input
            target = document.activeElement;
            if (!target || target === document.body) {
              target = document.querySelector("input:not([type='hidden']), textarea");
            }
          }
          if (!target) return { success: false, error: "Input field not found" };

          target.scrollIntoView({ behavior: 'instant', block: 'center' });
          target.focus();

          if (target.tagName.toLowerCase() === "input" || target.tagName.toLowerCase() === "textarea") {
            target.value = txt;
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (target.isContentEditable) {
            target.innerText = txt;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }

          if (enter) {
            const enterEvt = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true });
            target.dispatchEvent(enterEvt);
            const form = target.closest("form");
            if (form && typeof form.requestSubmit === "function") {
              form.requestSubmit();
            }
          }

          return {
            success: true,
            tagName: target.tagName.toLowerCase(),
            valueLength: txt.length,
          };
        })(${JSON.stringify(selector || null)}, ${JSON.stringify(textToType)}, ${elementIndex ?? null}, ${JSON.stringify(placeholder || null)}, ${pressEnter})`;

        const typeResult = await wc.executeJavaScript(typeScript);
        if (!typeResult.success) {
          throw new Error(`Type failed: ${typeResult.error}`);
        }

        // If Enter was pressed, wait for navigation or search updates
        if (pressEnter) {
          await new Promise((r) => setTimeout(r, 1200));
        }

        return {
          typed: true,
          element: typeResult,
          currentUrl: wc.getURL(),
        };
      }

      case "scroll": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const direction = params.direction || "down";
        const amount = typeof params.amount === "number" ? params.amount : 500;

        const scrollScript = `((dir, amt) => {
          if (dir === "top") window.scrollTo({ top: 0, behavior: "smooth" });
          else if (dir === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
          else if (dir === "up") window.scrollBy({ top: -amt, behavior: "smooth" });
          else window.scrollBy({ top: amt, behavior: "smooth" });
          return { scrollY: window.scrollY, maxScroll: document.body.scrollHeight };
        })(${JSON.stringify(direction)}, ${amount})`;

        const scrollRes = await wc.executeJavaScript(scrollScript);
        await new Promise((r) => setTimeout(r, 400));
        return scrollRes;
      }

      case "observe": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const inspection: PageInspectionResult = await wc.executeJavaScript(IN_PAGE_INSPECT_SCRIPT);
        return {
          tabId: tab.id,
          url: inspection.url,
          title: inspection.title,
          summary: inspection.summary.slice(0, 500),
          elementsCount: inspection.elements.length,
          headings: inspection.headings,
          hasCaptcha: inspection.hasCaptcha,
          hasLoginForm: inspection.hasLoginForm,
        };
      }

      case "screenshot": {
        const tab = this.getInternalTab(tabId);
        const image = await tab.view.webContents.capturePage();
        return { data: image.toPNG().toString("base64") };
      }

      case "upload": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const selector = params.selector;
        const elementIndex = params.elementIndex;
        let base64Data = params.base64Data;
        let fileName = params.fileName || "upload.png";
        let mimeType = params.mimeType || "image/png";

        // If a local filePath is provided on disk, read it
        if (!base64Data && params.filePath) {
          const resolvedPath = path.resolve(params.filePath);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`File to upload not found: ${params.filePath}`);
          }
          const buf = await fs.promises.readFile(resolvedPath);
          base64Data = buf.toString("base64");
          fileName = path.basename(resolvedPath);
          const ext = path.extname(resolvedPath).toLowerCase();
          if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
          else if (ext === ".webp") mimeType = "image/webp";
          else mimeType = "image/png";
        }

        if (!base64Data) {
          throw new Error("upload action requires either params.base64Data or valid params.filePath");
        }

        const uploadScript = `((sel, idx, b64, name, mime) => {
          let input = null;
          if (idx !== undefined && idx !== null) {
            const fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
            input = fileInputs[idx - 1] || null;
          }
          if (!input && sel) {
            input = document.querySelector(sel);
          }
          if (!input) {
            // Find first visible or hidden file input on page
            input = document.querySelector("input[type='file'][accept*='image']") || document.querySelector("input[type='file']");
          }
          if (!input) {
            return { success: false, error: "No file input element found on the page." };
          }

          try {
            const byteChars = atob(b64);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNums[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNums);
            const blob = new Blob([byteArray], { type: mime });
            const file = new File([blob], name, { type: mime });

            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;

            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));

            return {
              success: true,
              elementTag: input.tagName.toLowerCase(),
              filesAttached: input.files.length,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
            };
          } catch (err) {
            return { success: false, error: err.message || String(err) };
          }
        })(${JSON.stringify(selector)}, ${elementIndex ?? null}, ${JSON.stringify(base64Data)}, ${JSON.stringify(fileName)}, ${JSON.stringify(mimeType)})`;

        const uploadResult = await wc.executeJavaScript(uploadScript);
        if (!uploadResult?.success) {
          throw new Error(uploadResult?.error || "Failed to attach file to upload input");
        }
        await new Promise((r) => setTimeout(r, 600));
        return {
          uploaded: true,
          ...uploadResult,
          currentUrl: wc.getURL(),
        };
      }

      case "waitFor": {
        const tab = this.getInternalTab(tabId);
        const wc = tab.view.webContents;
        const selector = params.selector;
        const text = params.text;
        const timeoutMs = params.timeoutMs || 10_000;
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
          const checkScript = `((sel, txt) => {
            if (sel && document.querySelector(sel)) return true;
            if (txt && document.body && document.body.innerText.includes(txt)) return true;
            return false;
          })(${JSON.stringify(selector)}, ${JSON.stringify(text)})`;

          const found = await wc.executeJavaScript(checkScript);
          if (found) {
            return { found: true, elapsedMs: Date.now() - start };
          }
          await new Promise((r) => setTimeout(r, 400));
        }

        throw new Error(`Timed out waiting for ${selector || text || "condition"} after ${timeoutMs}ms`);
      }

      case "windowScreenshot": {
        const parentWindow = (this.tabManager as any).parentWindow;
        if (!parentWindow || parentWindow.isDestroyed()) {
          throw new Error("Parent window not available");
        }
        const image = await parentWindow.capturePage();
        return { data: image.toPNG().toString("base64") };
      }

      case "getViewDebugInfo": {
        const tab = this.getInternalTab(tabId);
        const parentWindow = (this.tabManager as any).parentWindow;
        const children = parentWindow.contentView.children;
        const isChild = children.includes(tab.view);
        const viewBounds = tab.view.getBounds();
        const storedBounds = (this.tabManager as any).viewportBounds;
        const browserVisible = (this.tabManager as any).browserVisible;
        const wcUrl = tab.view.webContents.getURL();
        const wcTitle = tab.view.webContents.getTitle();
        const wcLoading = tab.view.webContents.isLoading();
        const winBounds = parentWindow.getBounds();
        return {
          tabId: tab.id,
          tabUrl: tab.url,
          tabIsHome: tab.isHome,
          isChild,
          childrenCount: children.length,
          viewBounds,
          storedBounds,
          browserVisible,
          wcUrl,
          wcTitle,
          wcLoading,
          winBounds,
        };
      }

      default:
        throw new Error(`Unknown bridge action: "${action}"`);
    }
  }
}
