import { contextBridge, ipcRenderer } from "electron";
import type { Bookmark, BrowserTab, DesktopBrowserAPI, ViewportBounds } from "./types.js";

const api: DesktopBrowserAPI = {
  isDesktop: true,

  getTabs: () => ipcRenderer.invoke("browser:getTabs"),
  getActiveTabId: () => ipcRenderer.invoke("browser:getActiveTabId"),
  createTab: (url?: string) => ipcRenderer.invoke("browser:createTab", url),
  closeTab: (tabId: string) => ipcRenderer.invoke("browser:closeTab", tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke("browser:switchTab", tabId),
  navigate: (tabId: string, urlOrQuery: string) => ipcRenderer.invoke("browser:navigate", tabId, urlOrQuery),
  goBack: (tabId: string) => ipcRenderer.invoke("browser:goBack", tabId),
  goForward: (tabId: string) => ipcRenderer.invoke("browser:goForward", tabId),
  reload: (tabId: string) => ipcRenderer.invoke("browser:reload", tabId),
  stop: (tabId: string) => ipcRenderer.invoke("browser:stop", tabId),
  updateViewportBounds: (bounds: ViewportBounds) => ipcRenderer.invoke("browser:updateViewportBounds", bounds),
  setBrowserVisible: (visible: boolean) => ipcRenderer.invoke("browser:setBrowserVisible", visible),

  getBookmarks: () => ipcRenderer.invoke("storage:getBookmarks"),
  addBookmark: (bookmark: { url: string; title: string }) => ipcRenderer.invoke("storage:addBookmark", bookmark),
  removeBookmark: (id: string) => ipcRenderer.invoke("storage:removeBookmark", id),

  getHistory: () => ipcRenderer.invoke("storage:getHistory"),
  clearHistory: () => ipcRenderer.invoke("storage:clearHistory"),

  onTabUpdated: (callback: (tab: BrowserTab) => void) => {
    const handler = (_event: unknown, tab: BrowserTab) => callback(tab);
    ipcRenderer.on("browser:tabUpdated", handler);
    return () => {
      ipcRenderer.removeListener("browser:tabUpdated", handler);
    };
  },

  onTabsChanged: (callback: (data: { tabs: BrowserTab[]; activeTabId: string | null }) => void) => {
    const handler = (_event: unknown, data: { tabs: BrowserTab[]; activeTabId: string | null }) => callback(data);
    ipcRenderer.on("browser:tabsChanged", handler);
    return () => {
      ipcRenderer.removeListener("browser:tabsChanged", handler);
    };
  },

  onDownloadStatus: (callback: (data: { filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; percent?: number }) => void) => {
    const handler = (_event: unknown, data: { filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted"; percent?: number }) => callback(data);
    ipcRenderer.on("browser:downloadStatus", handler);
    return () => {
      ipcRenderer.removeListener("browser:downloadStatus", handler);
    };
  },
};

contextBridge.exposeInMainWorld("adalBrowser", api);
