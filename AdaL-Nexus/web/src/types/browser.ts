export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  error?: string;
  isHome: boolean;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
}

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopBrowserAPI {
  isDesktop: boolean;
  getTabs: () => Promise<BrowserTab[]>;
  getActiveTabId: () => Promise<string | null>;
  createTab: (url?: string) => Promise<BrowserTab>;
  closeTab: (tabId: string) => Promise<void>;
  switchTab: (tabId: string) => Promise<void>;
  navigate: (tabId: string, urlOrQuery: string, engine?: "duckduckgo" | "google") => Promise<void>;
  goBack: (tabId: string) => Promise<void>;
  goForward: (tabId: string) => Promise<void>;
  reload: (tabId: string) => Promise<void>;
  stop: (tabId: string) => Promise<void>;
  updateViewportBounds: (bounds: ViewportBounds) => Promise<void>;
  setBrowserVisible: (visible: boolean) => Promise<void>;
  getBookmarks: () => Promise<Bookmark[]>;
  addBookmark: (bookmark: { url: string; title: string }) => Promise<Bookmark>;
  removeBookmark: (id: string) => Promise<void>;
  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<void>;
  onTabUpdated: (callback: (tab: BrowserTab) => void) => () => void;
  onTabsChanged: (callback: (data: { tabs: BrowserTab[]; activeTabId: string | null }) => void) => () => void;
  onDownloadStatus: (callback: (data: { filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; percent?: number }) => void) => () => void;
  onFocusAddressBar?: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    adalBrowser?: DesktopBrowserAPI;
  }
}

export type { RunEvent, RunSnapshot } from "../../../src/server/agent/types";
