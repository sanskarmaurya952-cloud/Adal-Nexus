import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const TARGET_SITES = [
  { name: "Google", url: "https://www.google.com" },
  { name: "YouTube", url: "https://www.youtube.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "ChatGPT", url: "https://chatgpt.com" },
];

async function verifyWebsites() {
  console.log("=== Testing Real Website Compatibility in WebContentsView ===");
  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Ensure browser chrome is visible
    await window.locator(".browser-chrome-topbar").waitFor({ state: "visible" });

    const results: Array<{ name: string; url: string; finalUrl?: string; title?: string; success: boolean }> = [];

    for (const site of TARGET_SITES) {
      console.log(`\nNavigating to ${site.name} (${site.url})...`);
      const tabId = await window.evaluate(() => {
        return (window as any).adalBrowser?.getActiveTabId();
      });

      if (!tabId) throw new Error("No active tab found");

      await window.evaluate(async ({ id, targetUrl }) => {
        await (window as any).adalBrowser?.navigate(id, targetUrl);
      }, { id: tabId, targetUrl: site.url });

      // Poll until loading finishes or timeout (up to 15s)
      let loaded = false;
      let activeTabInfo: any = null;
      for (let i = 0; i < 30; i++) {
        await window.waitForTimeout(500);
        activeTabInfo = await window.evaluate(async (id) => {
          const tabs = await (window as any).adalBrowser?.getTabs();
          return tabs?.find((t: any) => t.id === id);
        }, tabId);

        if (activeTabInfo && !activeTabInfo.loading && activeTabInfo.url !== "adal://home") {
          loaded = true;
          break;
        }
      }

      console.log(`  Loaded: ${loaded ? "YES" : "NO"}`);
      console.log(`  Final URL: ${activeTabInfo?.url}`);
      console.log(`  Page Title: ${activeTabInfo?.title}`);
      console.log(`  Error: ${activeTabInfo?.error || "None"}`);

      results.push({
        name: site.name,
        url: site.url,
        finalUrl: activeTabInfo?.url,
        title: activeTabInfo?.title,
        success: loaded && !activeTabInfo?.error,
      });
    }

    console.log("\n=== Website Compatibility Results Summary ===");
    for (const r of results) {
      console.log(`- ${r.name}: ${r.success ? "PASS" : "FAIL"} (Title: "${r.title}", URL: ${r.finalUrl})`);
    }

    const allPassed = results.every((r) => r.success);
    if (!allPassed) {
      throw new Error("One or more real websites failed to load");
    }
  } finally {
    await electronApp.close();
  }
}

verifyWebsites().catch((err) => {
  console.error("Website compatibility verification failed:", err);
  process.exit(1);
});
