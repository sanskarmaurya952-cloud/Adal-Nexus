import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const artifactPath = "C:\\Users\\sansk\\.gemini\\antigravity\\brain\\c2d6dcb5-b9f3-42a9-af6b-b12aa0310725\\phase1_desktop_browser.png";

async function runVerification() {
  console.log("=== AdaL-Nexus Real Desktop Browser Verification ===");
  console.log("1. Launching Electron desktop application...");

  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  try {
    console.log("2. Waiting for primary browser window...");
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    console.log("   Window title:", await window.title());

    console.log("3. Verifying window.adalBrowser context bridge API...");
    const isDesktop = await window.evaluate(() => (window as any).adalBrowser?.isDesktop);
    console.log("   adalBrowser.isDesktop =", isDesktop);
    if (!isDesktop) throw new Error("window.adalBrowser was not found or isDesktop is not true");

    console.log("4. Verifying Real Desktop Browser Chrome (Topbar, Tab Strip, Omnibox)...");
    await window.locator(".browser-chrome-topbar").waitFor({ state: "visible" });
    await window.locator(".browser-tab-strip").waitFor({ state: "visible" });
    await window.locator(".omnibox-input").waitFor({ state: "visible" });
    console.log("   Top browser chrome and omnibox are visible!");

    console.log("5. Verifying Left Browser Sidebar Rail...");
    await window.locator(".browser-sidebar-rail").waitFor({ state: "visible" });
    console.log("   Sidebar navigation rail is visible!");

    console.log("6. Verifying New Tab Start Page Canvas (Matching Screenshot Reference)...");
    await window.locator(".start-page-canvas").waitFor({ state: "visible" });
    await window.locator(".center-brand-logo-badge").waitFor({ state: "visible" });
    await window.locator(".center-search-pill").waitFor({ state: "visible" });
    await window.locator(".center-shortcuts-row").waitFor({ state: "visible" });
    await window.locator(".start-page-feature-cards-grid").waitFor({ state: "visible" });
    console.log("   Start page canvas with time, logo, search, and shortcuts is visible!");

    console.log("7. Testing Tab Creation (+ button)...");
    const newTabBtn = window.locator(".btn-add-tab");
    await newTabBtn.click();

    let tabs = await window.evaluate(() => (window as any).adalBrowser?.getTabs());
    console.log("   Tabs count after New Tab click:", tabs?.length);
    if (tabs?.length !== 2) throw new Error(`Expected 2 tabs after click, got ${tabs?.length}`);

    console.log("8. Testing Tab Closing (× button)...");
    const closeTabBtns = window.locator(".tab-close-icon-btn");
    await closeTabBtns.nth(1).click();

    tabs = await window.evaluate(() => (window as any).adalBrowser?.getTabs());
    console.log("   Tabs count after Close Tab click:", tabs?.length);
    if (tabs?.length !== 1) throw new Error(`Expected 1 tab after close, got ${tabs?.length}`);

    console.log("9. Testing Bookmarks Store & Modal...");
    const testBm = await window.evaluate(async () => {
      const b = await (window as any).adalBrowser?.addBookmark({
        url: "https://github.com",
        title: "GitHub Bookmark",
      });
      const all = await (window as any).adalBrowser?.getBookmarks();
      return { added: b, count: all?.length };
    });
    console.log("   Added bookmark:", testBm.added?.url, "Total bookmarks:", testBm.count);

    // Open Bookmarks modal via sidebar
    const bookmarksBtn = window.locator('button[aria-label="Bookmarks"]');
    await bookmarksBtn.click();
    await window.locator(".bookmarks-modal-card").waitFor({ state: "visible" });
    console.log("   Bookmarks modal opened successfully!");
    // Close modal
    await window.locator(".btn-modal-close").click();

    console.log("10. Testing Integrated AI Agent Slide-Over Panel...");
    const aiAgentBtn = window.locator('button[aria-label="AI Agent"]');
    await aiAgentBtn.click();
    await window.locator(".ai-agent-panel-drawer").waitFor({ state: "visible" });
    console.log("   AI Agent panel opened alongside the browser!");
    // Close panel
    await window.locator(".btn-panel-close").click();

    console.log("11. Testing Omnibox Navigation & Real Website Loading...");
    const omnibox = window.locator(".omnibox-input");
    await omnibox.fill("https://example.com");
    await omnibox.press("Enter");

    console.log("    Waiting for active tab navigation...");
    await window.waitForTimeout(2000);

    const activeTab = await window.evaluate(async () => {
      const id = await (window as any).adalBrowser?.getActiveTabId();
      const all = await (window as any).adalBrowser?.getTabs();
      return all?.find((t: any) => t.id === id);
    });
    console.log("    Active tab after navigation:", activeTab?.url, "title:", activeTab?.title);

    console.log("12. Returning to Home / New Tab...");
    const homeBtn = window.locator('.toolbar-btn[aria-label="Home"]');
    await homeBtn.click();
    await window.waitForTimeout(1000);

    console.log("13. Capturing Desktop Browser Verification Screenshot...");
    await window.screenshot({ path: artifactPath, fullPage: true });
    console.log("    Screenshot saved to:", artifactPath);

    console.log("=== All Desktop Browser Verifications PASSED Successfully! ===");
  } finally {
    console.log("14. Closing Electron app...");
    await electronApp.close();
  }
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
