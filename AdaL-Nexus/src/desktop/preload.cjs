const { contextBridge, ipcRenderer } = require("electron");

const api = {
  isDesktop: true,

  getTabs: () => ipcRenderer.invoke("browser:getTabs"),
  getActiveTabId: () => ipcRenderer.invoke("browser:getActiveTabId"),
  createTab: (url) => ipcRenderer.invoke("browser:createTab", url),
  closeTab: (tabId) => ipcRenderer.invoke("browser:closeTab", tabId),
  switchTab: (tabId) => ipcRenderer.invoke("browser:switchTab", tabId),
  navigate: (tabId, urlOrQuery, engine) => ipcRenderer.invoke("browser:navigate", tabId, urlOrQuery, engine),
  goBack: (tabId) => ipcRenderer.invoke("browser:goBack", tabId),
  goForward: (tabId) => ipcRenderer.invoke("browser:goForward", tabId),
  reload: (tabId) => ipcRenderer.invoke("browser:reload", tabId),
  stop: (tabId) => ipcRenderer.invoke("browser:stop", tabId),
  updateViewportBounds: (bounds) => ipcRenderer.invoke("browser:updateViewportBounds", bounds),
  setBrowserVisible: (visible) => ipcRenderer.invoke("browser:setBrowserVisible", visible),

  getBookmarks: () => ipcRenderer.invoke("storage:getBookmarks"),
  addBookmark: (bookmark) => ipcRenderer.invoke("storage:addBookmark", bookmark),
  removeBookmark: (id) => ipcRenderer.invoke("storage:removeBookmark", id),

  getHistory: () => ipcRenderer.invoke("storage:getHistory"),
  clearHistory: () => ipcRenderer.invoke("storage:clearHistory"),

  onTabUpdated: (callback) => {
    const handler = (_event, tab) => callback(tab);
    ipcRenderer.on("browser:tabUpdated", handler);
    return () => {
      ipcRenderer.removeListener("browser:tabUpdated", handler);
    };
  },

  onTabsChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("browser:tabsChanged", handler);
    return () => {
      ipcRenderer.removeListener("browser:tabsChanged", handler);
    };
  },

  onDownloadStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("browser:downloadStatus", handler);
    return () => {
      ipcRenderer.removeListener("browser:downloadStatus", handler);
    };
  },

  onFocusAddressBar: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("browser:focusAddressBar", handler);
    return () => {
      ipcRenderer.removeListener("browser:focusAddressBar", handler);
    };
  },
};

contextBridge.exposeInMainWorld("adalBrowser", api);
