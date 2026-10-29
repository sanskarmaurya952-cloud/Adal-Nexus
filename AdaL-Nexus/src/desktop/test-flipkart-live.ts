import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

async function testWebsites() {
  console.log("=== Testing Real Electron WebContentsView Navigation ===");
  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(2000);

    const isDesktop = await window.evaluate(() => (window as any).adalBrowser?.isDesktop);
    console.log("1. adalBrowser.isDesktop =", isDesktop);

    const tabId = await window.evaluate(() => (window as any).adalBrowser?.getActiveTabId());
    console.log("2. Active tab ID =", tabId);

    // Test 1: Flipkart
    console.log("\n--- Testing Flipkart ---");
    const flipkartUrl = "https://www.flipkart.com/mobile-phones-store";
    await window.evaluate(async ({ id, url }) => {
      await (window as any).adalBrowser?.navigate(id, url);
    }, { id: tabId, url: flipkartUrl });

    // Wait for navigation
    for (let i = 0; i < 30; i++) {
      await window.waitForTimeout(500);
      const tab = await window.evaluate(async (id) => {
        const tabs = await (window as any).adalBrowser?.getTabs();
        return tabs?.find((t: any) => t.id === id);
      }, tabId);
      if (tab && !tab.loading && tab.url.includes("flipkart")) {
        console.log(`Flipkart loaded in ${i * 0.5}s: title="${tab.title}", url="${tab.url}"`);
        break;
      }
    }

    // Capture screenshot of Electron window showing Flipkart
    const screenshotPath = path.join(rootDir, "flipkart_electron_render.png");
    await window.screenshot({ path: screenshotPath });
    console.log("Saved Flipkart screenshot to:", screenshotPath);

    // Test 2: YouTube
    console.log("\n--- Testing YouTube ---");
    const ytUrl = "https://www.youtube.com";
    await window.evaluate(async ({ id, url }) => {
      await (window as any).adalBrowser?.navigate(id, url);
    }, { id: tabId, url: ytUrl });

    for (let i = 0; i < 30; i++) {
      await window.waitForTimeout(500);
      const tab = await window.evaluate(async (id) => {
        const tabs = await (window as any).adalBrowser?.getTabs();
        return tabs?.find((t: any) => t.id === id);
      }, tabId);
      if (tab && !tab.loading && tab.url.includes("youtube")) {
        console.log(`YouTube loaded in ${i * 0.5}s: title="${tab.title}", url="${tab.url}"`);
        break;
      }
    }

    const ytScreenshotPath = path.join(rootDir, "youtube_electron_render.png");
    await window.screenshot({ path: ytScreenshotPath });
    console.log("Saved YouTube screenshot to:", ytScreenshotPath);

  } finally {
    await electronApp.close();
  }
}

testWebsites().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
