import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Bookmark, HistoryEntry } from "./types.js";

export class BrowserStorage {
  private readonly storageDir: string;
  private readonly bookmarksFile: string;
  private readonly historyFile: string;

  constructor(customStorageDir?: string) {
    if (customStorageDir) {
      this.storageDir = customStorageDir;
    } else {
      // In Electron main process, require('electron').app.getPath("userData")
      try {
        const { app } = require("electron");
        this.storageDir = path.join(app.getPath("userData"), "browser-data");
      } catch {
        this.storageDir = path.resolve(process.cwd(), "data", "browser");
      }
    }

    this.bookmarksFile = path.join(this.storageDir, "bookmarks.json");
    this.historyFile = path.join(this.storageDir, "history.json");
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private readJsonFile<T>(filePath: string, defaultValue: T): T {
    try {
      if (!fs.existsSync(filePath)) {
        return defaultValue;
      }
      const raw = fs.readFileSync(filePath, "utf8").trim();
      if (!raw) return defaultValue;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[BrowserStorage] Error reading ${filePath}. Creating backup and resetting.`, err);
      try {
        if (fs.existsSync(filePath)) {
          const backup = `${filePath}.corrupt.${Date.now()}`;
          fs.renameSync(filePath, backup);
        }
      } catch {}
      return defaultValue;
    }
  }

  private writeJsonFile<T>(filePath: string, data: T): void {
    this.ensureDirectory();
    const tempFile = `${filePath}.tmp.${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tempFile, filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      throw err;
    }
  }

  // --- Bookmarks ---

  getBookmarks(): Bookmark[] {
    const list = this.readJsonFile<Bookmark[]>(this.bookmarksFile, []);
    return Array.isArray(list) ? list : [];
  }

  addBookmark(item: { url: string; title: string }): Bookmark {
    const bookmarks = this.getBookmarks();
    const trimmedUrl = item.url.trim();
    if (!trimmedUrl) {
      throw new Error("Bookmark URL cannot be empty");
    }

    // Check if bookmark for this URL already exists
    const existingIndex = bookmarks.findIndex((b) => b.url === trimmedUrl);
    if (existingIndex !== -1) {
      bookmarks[existingIndex].title = item.title.trim() || bookmarks[existingIndex].title;
      this.writeJsonFile(this.bookmarksFile, bookmarks);
      return bookmarks[existingIndex];
    }

    const newBookmark: Bookmark = {
      id: `bm_${crypto.randomUUID().slice(0, 12)}`,
      url: trimmedUrl,
      title: item.title.trim() || trimmedUrl,
      createdAt: new Date().toISOString(),
    };

    bookmarks.unshift(newBookmark);
    this.writeJsonFile(this.bookmarksFile, bookmarks);
    return newBookmark;
  }

  removeBookmark(id: string): boolean {
    const bookmarks = this.getBookmarks();
    const filtered = bookmarks.filter((b) => b.id !== id && b.url !== id);
    if (filtered.length !== bookmarks.length) {
      this.writeJsonFile(this.bookmarksFile, filtered);
      return true;
    }
    return false;
  }

  // --- Browsing History ---

  getHistory(): HistoryEntry[] {
    const list = this.readJsonFile<HistoryEntry[]>(this.historyFile, []);
    return Array.isArray(list) ? list : [];
  }

  addHistoryEntry(entry: { url: string; title: string }): HistoryEntry | null {
    const trimmedUrl = entry.url.trim();
    // Do not record internal or empty URLs
    if (!trimmedUrl || trimmedUrl.startsWith("adal://") || trimmedUrl.startsWith("about:")) {
      return null;
    }

    const history = this.getHistory();
    const newEntry: HistoryEntry = {
      id: `hist_${crypto.randomUUID().slice(0, 12)}`,
      url: trimmedUrl,
      title: entry.title.trim() || trimmedUrl,
      visitedAt: new Date().toISOString(),
    };

    // Keep up to 1000 history entries
    history.unshift(newEntry);
    if (history.length > 1000) {
      history.length = 1000;
    }

    this.writeJsonFile(this.historyFile, history);
    return newEntry;
  }

  clearHistory(): void {
    this.writeJsonFile(this.historyFile, []);
  }
}
