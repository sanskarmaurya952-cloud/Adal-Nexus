import { _electron as electron } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const artifactDir = "C:\\Users\\sansk\\.gemini\\antigravity\\brain\\c2d6dcb5-b9f3-42a9-af6b-b12aa0310725";

interface TestTarget {
  name: string;
  input: string;
  expectedUrlFragment: string;
  expectedTitleFragment?: string;
  screenshotFilename: string;
}

const TARGETS: TestTarget[] = [
  {
    name: "YouTube Direct Navigation",
    input: "https://www.youtube.com/",
    expectedUrlFragment: "youtube.com",
    expectedTitleFragment: "YouTube",
    screenshotFilename: "live_youtube_webcontents.png",
  },
  {
    name: "Flipkart Direct Navigation",
    input: "https://www.flipkart.com/mobile-phones-store",
    expectedUrlFragment: "flipkart.com",
    expectedTitleFragment: "Flipkart",
    screenshotFilename: "live_flipkart_webcontents.png",
  },
  {
    name: "GitHub Direct Navigation",
    input: "https://github.com/",
    expectedUrlFragment: "github.com",
    expectedTitleFragment: "GitHub",
    screenshotFilename: "live_github_webcontents.png",
  },
  {
    name: "Plain Text Search Query (Google)",
    input: "Java DSA tutorial",
    expectedUrlFragment: "google.com",
    screenshotFilename: "live_search_webcontents.png",
  },
  {
    name: "DuckDuckGo Search Query",
    input: "ddg Java DSA tutorial",
    expectedUrlFragment: "duckduckgo.com/?q=",
    screenshotFilename: "live_ddg_search_webcontents.png",
  },
];

async function verifyRealWebsitesLive() {
  console.log("=============================================================");
  console.log("   LIVE ELECTRON WEBCONTENTSVIEW PARITY VERIFICATION");
  console.log("=============================================================\n");

  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  const report: Array<{
    name: string;
    input: string;
    finalUrl: string;
    title: string;
    status: "PASS" | "FAIL";
    screenshotPath: string;
    notes?: string;
  }> = [];

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(2000);

    const isDesktop = await window.evaluate(() => (window as any).adalBrowser?.isDesktop);
    console.log(`[Runtime Environment] window.adalBrowser.isDesktop: ${isDesktop}`);
    if (!isDesktop) {
      throw new Error("Critical: window.adalBrowser is not exposed or isDesktop is false in Electron window");
    }

    const activeTabId = await window.evaluate(() => (window as any).adalBrowser?.getActiveTabId());
    console.log(`[Runtime Environment] Initial Active Tab ID: ${activeTabId}\n`);

    for (const target of TARGETS) {
      console.log(`>>> Testing Target: ${target.name}`);
      console.log(`    Input: "${target.input}"`);

      // Trigger navigation through IPC
      await window.evaluate(async ({ id, query }) => {
        await (window as any).adalBrowser?.navigate(id, query);
      }, { id: activeTabId, query: target.input });

      // Poll tab state until loaded (up to 20 seconds)
      let activeTab: any = null;
      for (let i = 0; i < 40; i++) {
        await window.waitForTimeout(500);
        const tabs = await window.evaluate(() => (window as any).adalBrowser?.getTabs());
        activeTab = tabs?.find((t: any) => t.id === activeTabId);

        if (activeTab && !activeTab.loading && activeTab.url !== "adal://home") {
          // If URL matches expected fragment, consider loaded
          if (activeTab.url.includes(target.expectedUrlFragment)) {
            break;
          }
        }
      }

      console.log(`    Final URL: ${activeTab?.url}`);
      console.log(`    Page Title: ${activeTab?.title}`);
      console.log(`    Error State: ${activeTab?.error || "None"}`);

      const pass = Boolean(
        activeTab &&
        !activeTab.error &&
        activeTab.url.includes(target.expectedUrlFragment) &&
        (!target.expectedTitleFragment || (activeTab.title && activeTab.title.toLowerCase().includes(target.expectedTitleFragment.toLowerCase())))
      );

      // Capture screenshot via desktop bridge if available, or playwright window screenshot
      let savedPath = "";
      try {
        // Read bridge info
        const bridgeFile = path.join(rootDir, ".desktop-bridge.json");
        if (fs.existsSync(bridgeFile)) {
          const bridge = JSON.parse(fs.readFileSync(bridgeFile, "utf-8"));
          const res = await fetch(`http://127.0.0.1:${bridge.port}/tab/${activeTabId}/screenshot`, {
            headers: { Authorization: `Bearer ${bridge.token}` },
          });
          if (res.ok) {
            const data: any = await res.json();
            if (data?.data) {
              const buffer = Buffer.from(data.data, "base64");
              savedPath = path.join(artifactDir, target.screenshotFilename);
              fs.writeFileSync(savedPath, buffer);
              console.log(`    Captured WebContentsView screenshot: ${savedPath}`);
            }
          }
        }
      } catch (err: any) {
        console.warn(`    Failed to capture via bridge: ${err.message}`);
      }

      if (!savedPath) {
        savedPath = path.join(artifactDir, target.screenshotFilename);
        await window.screenshot({ path: savedPath });
        console.log(`    Captured Window screenshot: ${savedPath}`);
      }

      report.push({
        name: target.name,
        input: target.input,
        finalUrl: activeTab?.url || "unknown",
        title: activeTab?.title || "unknown",
        status: pass ? "PASS" : "FAIL",
        screenshotPath: savedPath,
        notes: activeTab?.error,
      });

      console.log(`    Status: ${pass ? "PASS" : "FAIL"}\n`);
    }

    console.log("=============================================================");
    console.log("                   SUMMARY OF RESULTS");
    console.log("=============================================================");
    for (const r of report) {
      console.log(`[${r.status}] ${r.name}`);
      console.log(`       Input: ${r.input}`);
      console.log(`       URL:   ${r.finalUrl}`);
      console.log(`       Title: ${r.title}`);
    }
    console.log("=============================================================\n");

    const failed = report.filter((r) => r.status === "FAIL");
    if (failed.length > 0) {
      throw new Error(`${failed.length} test target(s) failed parity verification.`);
    }

  } finally {
    await electronApp.close();
  }
}

verifyRealWebsitesLive().catch((err) => {
  console.error("Live parity verification encountered error:", err);
  process.exit(1);
});
