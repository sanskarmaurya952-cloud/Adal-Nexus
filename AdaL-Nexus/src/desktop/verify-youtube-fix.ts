import { _electron as electron } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

interface TabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  error?: string;
  isHome: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

async function verifyFix() {
  console.log("=============================================================");
  console.log("   AdaL-Nexus Desktop Browser: YouTube Bug Fix Verification");
  console.log("=============================================================\n");

  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const addressBar = window.locator("input.omnibox-input");

  // -------------------------------------------------------------
  // Test 1: Direct navigation to https://www.youtube.com
  // -------------------------------------------------------------
  console.log("[Test 1] Navigating directly to https://www.youtube.com...");
  await addressBar.fill("https://www.youtube.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const t1 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const view = children[0];
    const wc = view ? view.webContents : null;
    const errorCard = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('.browser-error-card'))"
    );
    const bodyText = wc ? await wc.executeJavaScript("document.body ? document.body.innerText.slice(0, 300) : ''") : "";
    const img = wc ? (await wc.capturePage()).toPNG().toString("base64") : null;

    return {
      childrenCount: children.length,
      viewBounds: view ? view.getBounds() : null,
      url: wc ? wc.getURL() : null,
      title: wc ? wc.getTitle() : null,
      hasErrorCard: errorCard,
      bodyText,
      hasScreenshot: Boolean(img),
      imgBase64: img,
    };
  });

  console.log("   URL:", t1.url);
  console.log("   Title:", t1.title);
  console.log("   Bounds:", t1.viewBounds);
  console.log("   Has Error Card in UI:", t1.hasErrorCard);
  console.log("   Body Snippet:", t1.bodyText.replace(/\n+/g, " ").slice(0, 100));

  if (t1.imgBase64) {
    fs.mkdirSync(path.join(rootDir, "output"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "output", "test1_youtube_direct.png"), Buffer.from(t1.imgBase64, "base64"));
    console.log("   Captured screenshot to output/test1_youtube_direct.png");
  }

  if (t1.hasErrorCard) throw new Error("Test 1 Failed: Error card displayed!");
  if (!t1.url?.includes("youtube.com")) throw new Error("Test 1 Failed: URL is not YouTube!");
  console.log("   -> TEST 1 PASSED!\n");

  // -------------------------------------------------------------
  // Test 2: Address bar input 'youtube.com' (without https://)
  // -------------------------------------------------------------
  console.log("[Test 2] Navigating via address bar 'youtube.com'...");
  await addressBar.fill("youtube.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const t2 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const view = children[0];
    const wc = view ? view.webContents : null;
    const errorCard = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('.browser-error-card'))"
    );
    return {
      url: wc ? wc.getURL() : null,
      title: wc ? wc.getTitle() : null,
      hasErrorCard: errorCard,
    };
  });

  console.log("   URL:", t2.url);
  console.log("   Title:", t2.title);
  console.log("   Has Error Card in UI:", t2.hasErrorCard);

  if (t2.hasErrorCard) throw new Error("Test 2 Failed: Error card displayed on 'youtube.com'!");
  if (!t2.url?.includes("youtube.com")) throw new Error("Test 2 Failed: URL is not YouTube!");
  console.log("   -> TEST 2 PASSED!\n");

  // -------------------------------------------------------------
  // Test 3: Search query 'Java DSA tutorial'
  // -------------------------------------------------------------
  console.log("[Test 3] Submitting search query 'Java DSA tutorial'...");
  await addressBar.fill("Java DSA tutorial");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const t3 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const view = children[0];
    const wc = view ? view.webContents : null;
    const errorCard = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('.browser-error-card'))"
    );
    return {
      url: wc ? wc.getURL() : null,
      title: wc ? wc.getTitle() : null,
      hasErrorCard: errorCard,
    };
  });

  console.log("   URL:", t3.url);
  console.log("   Title:", t3.title);
  console.log("   Has Error Card in UI:", t3.hasErrorCard);

  if (t3.hasErrorCard) throw new Error("Test 3 Failed: Error card displayed on Google Search!");
  if (!t3.url?.includes("google.com") && !t3.url?.includes("duckduckgo.com")) throw new Error("Test 3 Failed: URL did not resolve to search engine!");
  console.log("   -> TEST 3 PASSED!\n");

  // -------------------------------------------------------------
  // Test 4: Navigating to GitHub
  // -------------------------------------------------------------
  console.log("[Test 4] Navigating to https://github.com...");
  await addressBar.fill("https://github.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const t4 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const view = children[0];
    const wc = view ? view.webContents : null;
    const errorCard = await win.webContents.executeJavaScript(
      "Boolean(document.querySelector('.browser-error-card'))"
    );
    return {
      url: wc ? wc.getURL() : null,
      title: wc ? wc.getTitle() : null,
      hasErrorCard: errorCard,
      canGoBack: wc ? wc.canGoBack() : false,
    };
  });

  console.log("   URL:", t4.url);
  console.log("   Title:", t4.title);
  console.log("   Has Error Card in UI:", t4.hasErrorCard);
  console.log("   Can Go Back:", t4.canGoBack);

  if (t4.hasErrorCard) throw new Error("Test 4 Failed: Error card displayed on GitHub!");
  if (!t4.url?.includes("github.com")) throw new Error("Test 4 Failed: URL is not GitHub!");
  console.log("   -> TEST 4 PASSED!\n");

  // -------------------------------------------------------------
  // Test 5: Back navigation
  // -------------------------------------------------------------
  console.log("[Test 5] Triggering Back navigation...");
  const backBtn = window.locator('button.toolbar-btn[aria-label="Back"]');
  await backBtn.click();
  await window.waitForTimeout(3000);

  const t5 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const view = children[0];
    const wc = view ? view.webContents : null;
    return {
      url: wc ? wc.getURL() : null,
      canGoForward: wc ? wc.canGoForward() : false,
    };
  });

  console.log("   Navigated Back to URL:", t5.url);
  console.log("   Can Go Forward:", t5.canGoForward);
  if (!t5.canGoForward) throw new Error("Test 5 Failed: CanGoForward should be true after going back!");
  console.log("   -> TEST 5 PASSED!\n");

  // -------------------------------------------------------------
  // Test 6: Multi-tab management
  // -------------------------------------------------------------
  console.log("[Test 6] Creating a new tab and switching between tabs...");
  const newTabBtn = window.locator("button.btn-add-tab");
  await newTabBtn.click();
  await window.waitForTimeout(2000);

  const tabsState = await window.evaluate(() => (window as any).adalBrowser?.getTabs());
  console.log("   Tab count after New Tab:", tabsState.length);

  // Navigate second tab to YouTube
  await addressBar.fill("https://www.youtube.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(3000);

  const t6 = await electronApp.evaluate(async ({ BrowserWindow }: any) => {
    const win = BrowserWindow.getAllWindows()[0];
    const children = win.contentView.children;
    const activeView = children[0];
    return {
      childrenCount: children.length,
      activeUrl: activeView ? activeView.webContents.getURL() : null,
    };
  });

  console.log("   Active tab view count attached to contentView:", t6.childrenCount);
  console.log("   Active tab view URL:", t6.activeUrl);

  if (t6.childrenCount !== 1) throw new Error("Test 6 Failed: Expected exactly 1 active view attached to contentView!");
  if (!t6.activeUrl?.includes("youtube.com")) throw new Error("Test 6 Failed: Expected active tab to be YouTube!");
  console.log("   -> TEST 6 PASSED!\n");

  await electronApp.close();
  console.log("=============================================================");
  console.log("   ALL 6 VERIFICATION TESTS PASSED SUCCESSFULLY!");
  console.log("=============================================================\n");
}

verifyFix().catch((err) => {
  console.error("Verification Error:", err);
  process.exit(1);
});
