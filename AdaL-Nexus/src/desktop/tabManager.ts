import { WebContentsView, BrowserWindow, type HandlerDetails, type WindowOpenHandlerResponse } from "electron";
import crypto from "node:crypto";
import type { BrowserStorage } from "./storage.js";
import type { BrowserTab, ViewportBounds } from "./types.js";
import { resolveAddressBarInput, isNavigationUrlSafe, type SearchEngine } from "./urlPolicy.js";

export interface TabManagerOptions {
  parentWindow: BrowserWindow;
  storage: BrowserStorage;
  onTabUpdated: (tab: BrowserTab) => void;
  onTabsChanged: (data: { tabs: BrowserTab[]; activeTabId: string | null }) => void;
  onDownloadStatus: (data: { filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; percent?: number }) => void;
}

interface InternalTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  error?: string;
  isHome: boolean;
  view: WebContentsView;
}

export class TabManager {
  private readonly parentWindow: BrowserWindow;
  private readonly storage: BrowserStorage;
  private readonly onTabUpdated: (tab: BrowserTab) => void;
  private readonly onTabsChanged: (data: { tabs: BrowserTab[]; activeTabId: string | null }) => void;
  private readonly onDownloadStatus: (data: { filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; percent?: number }) => void;

  private tabs: InternalTab[] = [];
  private activeTabId: string | null = null;
  private viewportBounds: ViewportBounds = { x: 0, y: 120, width: 1200, height: 700 };
  private browserVisible = true;

  constructor(options: TabManagerOptions) {
    this.parentWindow = options.parentWindow;
    this.storage = options.storage;
    this.onTabUpdated = options.onTabUpdated;
    this.onTabsChanged = options.onTabsChanged;
    this.onDownloadStatus = options.onDownloadStatus;

    // Attach global download handling once for the window session
    try {
      const sess = this.parentWindow.webContents.session;
      sess.on("will-download", (_event, item) => {
        const filename = item.getFilename();
        this.onDownloadStatus({ filename, state: "progressing", percent: 0 });

        item.on("updated", (_evt, state) => {
          if (state === "progressing") {
            const total = item.getTotalBytes();
            const received = item.getReceivedBytes();
            const percent = total > 0 ? Math.round((received / total) * 100) : undefined;
            this.onDownloadStatus({ filename, state: "progressing", percent });
          } else if (state === "interrupted") {
            this.onDownloadStatus({ filename, state: "interrupted" });
          }
        });

        item.once("done", (_evt, state) => {
          if (state === "completed") {
            this.onDownloadStatus({ filename, state: "completed", percent: 100 });
          } else if (state === "cancelled") {
            this.onDownloadStatus({ filename, state: "cancelled" });
          } else {
            this.onDownloadStatus({ filename, state: "interrupted" });
          }
        });
      });
    } catch {}
  }

  getTabs(): BrowserTab[] {
    return this.tabs.map((t) => this.toPublicTab(t));
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  private toPublicTab(t: InternalTab): BrowserTab {
    return {
      id: t.id,
      url: t.url,
      title: t.title,
      loading: t.loading,
      canGoBack: t.canGoBack,
      canGoForward: t.canGoForward,
      favicon: t.favicon,
      error: t.error,
      isHome: t.isHome,
    };
  }

  private notifyTabUpdated(t: InternalTab): void {
    this.onTabUpdated(this.toPublicTab(t));
  }

  private notifyTabsChanged(): void {
    this.onTabsChanged({
      tabs: this.getTabs(),
      activeTabId: this.activeTabId,
    });
  }

  createTab(initialUrl?: string): BrowserTab {
    const id = `tab_${crypto.randomUUID().slice(0, 8)}`;
    const isHome = !initialUrl || initialUrl === "adal://home" || initialUrl === "adal://newtab";
    const url = isHome ? "adal://home" : initialUrl;

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });

    const tab: InternalTab = {
      id,
      url,
      title: isHome ? "New Tab" : "Loading...",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      isHome,
      view,
    };

    // Attach webContents event listeners
    const wc = view.webContents;

    // Set clean desktop browser User-Agent without Electron tokens to prevent search engine bot blocks
    try {
      const defaultUA = wc.getUserAgent();
      const cleanUA = defaultUA.replace(/Electron\/\S+\s*/i, "").replace(/adal-nexus\/\S+\s*/i, "");
      wc.setUserAgent(cleanUA);
    } catch {}

    // Global keyboard accelerators when focus is inside the website
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;

      const isMac = process.platform === "darwin";
      const cmdOrCtrl = isMac ? input.meta : input.control;

      // Ctrl+T: New tab
      if (cmdOrCtrl && !input.shift && input.key.toLowerCase() === "t") {
        event.preventDefault();
        this.createTab();
        return;
      }

      // Ctrl+W: Close current tab
      if (cmdOrCtrl && !input.shift && input.key.toLowerCase() === "w") {
        event.preventDefault();
        this.closeTab(tab.id);
        return;
      }

      // Ctrl+R or F5: Reload active page
      if ((cmdOrCtrl && !input.shift && input.key.toLowerCase() === "r") || input.key === "F5") {
        event.preventDefault();
        this.reload(tab.id);
        return;
      }

      // Ctrl+Shift+R or Ctrl+F5: Hard reload
      if ((cmdOrCtrl && input.shift && input.key.toLowerCase() === "r") || (cmdOrCtrl && input.key === "F5")) {
        event.preventDefault();
        wc.reloadIgnoringCache();
        return;
      }

      // Alt+Left: Back
      if (input.alt && input.key === "ArrowLeft") {
        event.preventDefault();
        this.goBack(tab.id);
        return;
      }

      // Alt+Right: Forward
      if (input.alt && input.key === "ArrowRight") {
        event.preventDefault();
        this.goForward(tab.id);
        return;
      }

      // Ctrl+L: Focus address bar
      if (cmdOrCtrl && !input.shift && input.key.toLowerCase() === "l") {
        event.preventDefault();
        this.parentWindow.webContents.send("browser:focusAddressBar");
        return;
      }
    });

    wc.on("did-start-navigation", (_event, navUrl, isInPlace, isMainFrame) => {
      if (isMainFrame) {
        tab.loading = true;
        tab.error = undefined;
        this.notifyTabUpdated(tab);
      }
    });

    wc.on("did-start-loading", () => {
      tab.loading = true;
      tab.error = undefined;
      this.notifyTabUpdated(tab);
    });

    wc.on("did-stop-loading", () => {
      tab.loading = false;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      this.notifyTabUpdated(tab);
    });

    wc.on("did-finish-load", () => {
      tab.loading = false;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      this.notifyTabUpdated(tab);
    });

    wc.on("page-title-updated", (_event, title) => {
      if (!tab.isHome) {
        tab.title = title || tab.url;
        this.notifyTabUpdated(tab);
      }
    });

    wc.on("page-favicon-updated", (_event, favicons) => {
      if (favicons && favicons.length > 0) {
        tab.favicon = favicons[0];
        this.notifyTabUpdated(tab);
      }
    });

    wc.on("did-navigate", (_event, navUrl) => {
      tab.url = navUrl;
      tab.isHome = false;
      tab.title = wc.getTitle() || navUrl;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      tab.error = undefined;
      this.storage.addHistoryEntry({ url: navUrl, title: tab.title });
      this.notifyTabUpdated(tab);
    });

    wc.on("did-navigate-in-page", (_event, navUrl) => {
      tab.url = navUrl;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      this.notifyTabUpdated(tab);
    });

    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      // Ignore aborts caused by user navigation
      if (errorCode === -3) return;
      tab.loading = false;
      tab.error = `${errorDescription} (${errorCode})`;
      tab.title = "Failed to load page";
      try {
        this.parentWindow.contentView.removeChildView(tab.view);
      } catch {}
      this.notifyTabUpdated(tab);
    });

    // Handle target="_blank" and popups: open as a controlled tab in the browser
    wc.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
      if (isNavigationUrlSafe(details.url)) {
        this.createTab(details.url);
      }
      return { action: "deny" };
    });

    // Permission handling: allow safe browser media, audio capture, speech recognition, and fullscreen
    const allowedPermissions = new Set([
      "fullscreen",
      "media",
      "audioCapture",
      "speech-recognition",
      "mediaKeySystem",
    ]);
    wc.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(allowedPermissions.has(permission));
    });
    wc.session.setPermissionCheckHandler((_webContents, permission) => {
      return allowedPermissions.has(permission);
    });

    this.tabs.push(tab);

    // If initial URL is a real website, start loading
    if (!isHome && isNavigationUrlSafe(url)) {
      wc.loadURL(url).catch((err) => {
        if (!err.message?.includes("ERR_ABORTED") && !err.message?.includes("-3")) {
          tab.error = err.message;
          this.notifyTabUpdated(tab);
        }
      });
    }

    this.switchTab(tab.id);
    return this.toPublicTab(tab);
  }

  switchTab(tabId: string): void {
    const targetTab = this.tabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    // Ensure all other views are removed from parent window to prevent lingering overlays
    for (const t of this.tabs) {
      if (t.id !== tabId && this.parentWindow.contentView.children.includes(t.view)) {
        try {
          this.parentWindow.contentView.removeChildView(t.view);
        } catch {}
      }
    }

    this.activeTabId = tabId;

    // Synchronize navigation history state from active webContents
    if (!targetTab.isHome) {
      targetTab.canGoBack = targetTab.view.webContents.canGoBack();
      targetTab.canGoForward = targetTab.view.webContents.canGoForward();
    }

    // Attach active tab's view if browser is visible and not home or in error state
    if (this.browserVisible && !targetTab.isHome && !targetTab.error) {
      try {
        if (!this.parentWindow.contentView.children.includes(targetTab.view)) {
          this.parentWindow.contentView.addChildView(targetTab.view);
        }
      } catch {}
      try {
        targetTab.view.setBounds(this.viewportBounds);
      } catch {}
      try {
        targetTab.view.webContents.focus();
      } catch {}
    }

    this.notifyTabsChanged();
    this.notifyTabUpdated(targetTab);
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];

    // Detach and clean up WebContentsView
    try {
      tab.view.webContents.stop();
      this.parentWindow.contentView.removeChildView(tab.view);
      (tab.view.webContents as any).destroy?.();
    } catch {}

    this.tabs.splice(index, 1);

    // If closed tab was active, switch to adjacent or create home tab
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextIndex = Math.min(index, this.tabs.length - 1);
        this.switchTab(this.tabs[nextIndex].id);
      } else {
        // No tabs left, create default home tab
        this.activeTabId = null;
        this.createTab();
      }
    } else {
      this.notifyTabsChanged();
    }
  }

  navigate(tabId: string, urlOrQuery: string, engine?: SearchEngine): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const resolved = resolveAddressBarInput(urlOrQuery, engine);

    if (!resolved.isValid) {
      tab.error = resolved.error || "Invalid URL";
      try {
        this.parentWindow.contentView.removeChildView(tab.view);
      } catch {}
      this.notifyTabUpdated(tab);
      return;
    }

    if (resolved.url === "adal://home" || resolved.url === "adal://newtab") {
      tab.isHome = true;
      tab.url = "adal://home";
      tab.title = "New Tab";
      tab.error = undefined;
      // Detach view so React start page shows
      try {
        this.parentWindow.contentView.removeChildView(tab.view);
      } catch {}
      this.notifyTabUpdated(tab);
      return;
    }

    tab.isHome = false;
    tab.url = resolved.url;
    tab.title = resolved.isSearch ? `Search: ${urlOrQuery}` : resolved.url;
    tab.error = undefined;

    // Ensure tab is switched to active and view is attached and sized
    if (this.activeTabId !== tab.id) {
      this.switchTab(tab.id);
    } else if (this.browserVisible) {
      try {
        if (!this.parentWindow.contentView.children.includes(tab.view)) {
          this.parentWindow.contentView.addChildView(tab.view);
        }
      } catch {}
      try {
        tab.view.setBounds(this.viewportBounds);
      } catch {}
      try {
        tab.view.webContents.focus();
      } catch {}
    }

    tab.view.webContents.loadURL(resolved.url).catch((err) => {
      // Chromium aborts previous or redirected loads with ERR_ABORTED (-3).
      // This is expected during HTTP redirects (e.g. youtube.com -> www.youtube.com).
      // Only set error for actual fatal errors.
      if (!err.message?.includes("ERR_ABORTED") && !err.message?.includes("-3")) {
        tab.error = err.message;
        try {
          this.parentWindow.contentView.removeChildView(tab.view);
        } catch {}
        this.notifyTabUpdated(tab);
      }
    });

    this.notifyTabUpdated(tab);
  }

  goBack(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isHome && tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }

  goForward(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isHome && tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }

  reload(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isHome) {
      tab.error = undefined;
      if (this.browserVisible && this.activeTabId === tab.id) {
        try {
          if (!this.parentWindow.contentView.children.includes(tab.view)) {
            this.parentWindow.contentView.addChildView(tab.view);
            tab.view.setBounds(this.viewportBounds);
          }
        } catch {}
      }
      tab.view.webContents.reload();
      this.notifyTabUpdated(tab);
    }
  }

  stop(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && !tab.isHome) {
      tab.view.webContents.stop();
      tab.loading = false;
      this.notifyTabUpdated(tab);
    }
  }

  updateViewportBounds(bounds: ViewportBounds): void {
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.viewportBounds = bounds;
    const active = this.tabs.find((t) => t.id === this.activeTabId);
    if (active && this.browserVisible && !active.isHome && !active.error) {
      try {
        if (!this.parentWindow.contentView.children.includes(active.view)) {
          this.parentWindow.contentView.addChildView(active.view);
        }
      } catch {}
      try {
        active.view.setBounds(bounds);
      } catch {}
    }
  }

  setBrowserVisible(visible: boolean): void {
    this.browserVisible = visible;
    const active = this.tabs.find((t) => t.id === this.activeTabId);
    if (!active) return;

    if (visible && !active.isHome && !active.error) {
      try {
        if (!this.parentWindow.contentView.children.includes(active.view)) {
          this.parentWindow.contentView.addChildView(active.view);
        }
      } catch {}
      try {
        active.view.setBounds(this.viewportBounds);
      } catch {}
      try {
        active.view.webContents.focus();
      } catch {}
    } else {
      try {
        this.parentWindow.contentView.removeChildView(active.view);
      } catch {}
    }
  }
}
