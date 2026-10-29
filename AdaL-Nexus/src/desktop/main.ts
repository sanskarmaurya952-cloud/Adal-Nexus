import { app, BrowserWindow, ipcMain, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserStorage } from "./storage.js";
import { TabManager } from "./tabManager.js";
import { AutomationBridge } from "./automationBridge.js";
import type { ViewportBounds } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let storage: BrowserStorage | null = null;
let automationBridge: AutomationBridge | null = null;

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    import("node:http").then(({ default: http }) => {
      const req = http.get(`http://localhost:${port}/`, () => {
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
  });
}

async function createWindow() {
  // Permission handling: explicitly permit media, audio capture, speech recognition, and fullscreen
  const allowedPermissions = new Set([
    "fullscreen",
    "media",
    "audioCapture",
    "speech-recognition",
    "mediaKeySystem",
  ]);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: "AdaL-Nexus",
    backgroundColor: "#ffffff",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f8f8fc",
      symbolColor: "#475569",
      height: 44,
    },
    webPreferences: {
      preload: fs.existsSync(path.join(__dirname, "preload.cjs"))
        ? path.join(__dirname, "preload.cjs")
        : path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  storage = new BrowserStorage();

  tabManager = new TabManager({
    parentWindow: mainWindow,
    storage,
    onTabUpdated: (tab) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("browser:tabUpdated", tab);
      }
    },
    onTabsChanged: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("browser:tabsChanged", data);
      }
    },
    onDownloadStatus: (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("browser:downloadStatus", data);
      }
    },
  });

  // Handle window resizing to keep WebContentsView properly bounded
  mainWindow.on("resize", () => {
    // Renderer will recalculate bounds and invoke updateViewportBounds
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:resized");
    }
  });

  // Create initial tab (Home page)
  tabManager.createTab("adal://home");

  // Determine whether to connect to Vite dev server or load production build
  const isDevPortActive = await checkPort(5173);
  if (isDevPortActive) {
    console.log("[Desktop] Connecting to Vite dev server at http://localhost:5173");
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    const prodHtml = path.resolve(__dirname, "..", "web", "dist", "index.html");
    console.log("[Desktop] Loading packaged UI from", prodHtml);
    await mainWindow.loadFile(prodHtml);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    tabManager = null;
  });
}

// Register IPC handlers
function registerIpcHandlers() {
  ipcMain.handle("browser:getTabs", () => {
    return tabManager ? tabManager.getTabs() : [];
  });

  ipcMain.handle("browser:getActiveTabId", () => {
    return tabManager ? tabManager.getActiveTabId() : null;
  });

  ipcMain.handle("browser:createTab", (_event, url?: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    return tabManager.createTab(url);
  });

  ipcMain.handle("browser:closeTab", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.closeTab(tabId);
  });

  ipcMain.handle("browser:switchTab", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.switchTab(tabId);
  });

  ipcMain.handle("browser:navigate", (_event, tabId: string, urlOrQuery: string, engine?: any) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.navigate(tabId, urlOrQuery, engine);
  });

  ipcMain.handle("browser:goBack", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.goBack(tabId);
  });

  ipcMain.handle("browser:goForward", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.goForward(tabId);
  });

  ipcMain.handle("browser:reload", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.reload(tabId);
  });

  ipcMain.handle("browser:stop", (_event, tabId: string) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.stop(tabId);
  });

  ipcMain.handle("browser:updateViewportBounds", (_event, bounds: ViewportBounds) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.updateViewportBounds(bounds);
  });

  ipcMain.handle("browser:setBrowserVisible", (_event, visible: boolean) => {
    if (!tabManager) throw new Error("TabManager not initialized");
    tabManager.setBrowserVisible(visible);
  });

  // Storage IPC
  ipcMain.handle("storage:getBookmarks", () => {
    return storage ? storage.getBookmarks() : [];
  });

  ipcMain.handle("storage:addBookmark", (_event, bookmark: { url: string; title: string }) => {
    if (!storage) throw new Error("Storage not initialized");
    return storage.addBookmark(bookmark);
  });

  ipcMain.handle("storage:removeBookmark", (_event, id: string) => {
    if (!storage) throw new Error("Storage not initialized");
    return storage.removeBookmark(id);
  });

  ipcMain.handle("storage:getHistory", () => {
    return storage ? storage.getHistory() : [];
  });

  ipcMain.handle("storage:clearHistory", () => {
    if (!storage) throw new Error("Storage not initialized");
    storage.clearHistory();
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();

  if (tabManager) {
    automationBridge = new AutomationBridge({ tabManager });
    try {
      await automationBridge.start();
    } catch (err) {
      console.warn("[Desktop] Failed to start AutomationBridge:", err);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  if (automationBridge) {
    void automationBridge.stop();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
