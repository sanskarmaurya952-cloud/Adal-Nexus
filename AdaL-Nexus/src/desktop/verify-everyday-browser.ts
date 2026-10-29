import { _electron as electron } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

async function runAudit() {
  console.log("================================================================================");
  console.log("   AdaL-Nexus: Real Everyday Desktop Browser Verification Suite");
  console.log("================================================================================\n");

  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1500);

  const addressBar = window.locator("input.omnibox-input");

  // Helper to query Electron state
  const getElectronState = async () => {
    return await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0];
      const children = win.contentView.children;
      const activeView = children[0] || null;
      const wc = activeView ? activeView.webContents : null;

      return {
        childrenCount: children.length,
        viewBounds: activeView ? activeView.getBounds() : null,
        url: wc ? wc.getURL() : null,
        title: wc ? wc.getTitle() : null,
        canGoBack: wc ? wc.canGoBack() : false,
        canGoForward: wc ? wc.canGoForward() : false,
        isLoading: wc ? wc.isLoading() : false,
      };
    });
  };

  // Helper to evaluate in active WebContentsView
  const execInWebContents = async (script: string) => {
    return await electronApp.evaluate(async ({ BrowserWindow }: any, scr: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children[0];
      if (!view) return null;
      return await view.webContents.executeJavaScript(scr);
    }, script);
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: Direct HTTPS URL Navigation (GitHub)
    // --------------------------------------------------------------------------
    console.log("[Test 1] Direct HTTPS URL Navigation ('https://github.com')...");
    await addressBar.fill("https://github.com");
    await addressBar.press("Enter");
    await window.waitForTimeout(4000);

    const s1 = await getElectronState();
    console.log(`   URL: ${s1.url}`);
    console.log(`   Title: ${s1.title}`);
    console.log(`   Bounds: ${JSON.stringify(s1.viewBounds)}`);
    assert.ok(s1.url?.includes("github.com"), "Expected URL to be on github.com");
    assert.ok(s1.childrenCount === 1, "Expected exactly 1 WebContentsView attached");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 2: Shortcut Without Scheme ('youtube.com')
    // --------------------------------------------------------------------------
    console.log("[Test 2] Shortcut Without Scheme ('youtube.com')...");
    await addressBar.fill("youtube.com");
    await addressBar.press("Enter");
    await window.waitForTimeout(4000);

    const s2 = await getElectronState();
    console.log(`   URL: ${s2.url}`);
    console.log(`   Title: ${s2.title}`);
    assert.ok(s2.url?.includes("youtube.com"), "Expected URL to be on youtube.com");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 3: Everyday Website Query / Search Engine Resolution ('Python tutorial')
    // --------------------------------------------------------------------------
    console.log("[Test 3] Plain Text Search Query ('Python tutorial')...");
    await addressBar.fill("Python tutorial");
    await addressBar.press("Enter");
    await window.waitForTimeout(4000);

    const s3 = await getElectronState();
    console.log(`   URL: ${s3.url}`);
    console.log(`   Title: ${s3.title}`);
    assert.ok(s3.url?.includes("google.com") || s3.url?.includes("duckduckgo.com"), "Expected search engine URL");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 4: General Domain Navigation ('httpbin.org')
    // --------------------------------------------------------------------------
    console.log("[Test 4] Domain Without Scheme ('httpbin.org')...");
    await addressBar.fill("httpbin.org");
    await addressBar.press("Enter");
    await window.waitForTimeout(4000);

    const s4 = await getElectronState();
    console.log(`   URL: ${s4.url}`);
    console.log(`   Title: ${s4.title}`);
    assert.ok(s4.url?.includes("httpbin.org"), "Expected URL to be on httpbin.org");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 5: Website Form Interaction (httpbin.org/forms/post)
    // --------------------------------------------------------------------------
    console.log("[Test 5] Form Input & Submission Interaction ('httpbin.org/forms/post')...");
    await addressBar.fill("https://httpbin.org/forms/post");
    await addressBar.press("Enter");
    await window.waitForTimeout(3500);

    // Type into the form input using the active page's DOM
    const formFilled = await execInWebContents(`
      (() => {
        const nameInput = document.querySelector('input[name="custname"]');
        if (!nameInput) return false;
        nameInput.value = 'AdaL Nexus Browser Test';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    console.log(`   Form field filled: ${formFilled}`);
    assert.equal(formFilled, true, "Expected customer name field to be filled");

    // Submit the form
    await execInWebContents(`document.querySelector('form').submit()`);
    await window.waitForTimeout(3500);

    const s5 = await getElectronState();
    console.log(`   Post-submit URL: ${s5.url}`);
    assert.ok(s5.url?.includes("/post"), "Expected submission URL to be httpbin.org/post");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 6: History Navigation (Back & Forward)
    // --------------------------------------------------------------------------
    console.log("[Test 6] History Navigation (Back & Forward)...");
    const backBtn = window.locator("button[aria-label='Back']");
    const forwardBtn = window.locator("button[aria-label='Forward']");

    console.log("   Clicking Back button...");
    await backBtn.click();
    await window.waitForTimeout(3000);

    const s6Back = await getElectronState();
    console.log(`   URL after Back: ${s6Back.url}`);
    assert.ok(s6Back.url?.includes("httpbin.org"), "Expected to return to previous page in history");

    console.log("   Clicking Forward button...");
    await forwardBtn.click();
    await window.waitForTimeout(3000);

    const s6Fwd = await getElectronState();
    console.log(`   URL after Forward: ${s6Fwd.url}`);
    assert.ok(s6Fwd.url?.includes("/post"), "Expected to go forward to post submission page");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 7: Multi-Tab Creation, Isolation & Switching
    // --------------------------------------------------------------------------
    console.log("[Test 7] Multi-Tab Creation, Isolation & Switching...");
    const newTabBtn = window.locator("button[aria-label='New Tab']");

    // Create Tab 2
    await newTabBtn.click();
    await window.waitForTimeout(1500);
    await addressBar.fill("https://github.com");
    await addressBar.press("Enter");
    await window.waitForTimeout(3500);

    // Create Tab 3
    await newTabBtn.click();
    await window.waitForTimeout(1500);
    await addressBar.fill("https://www.youtube.com");
    await addressBar.press("Enter");
    await window.waitForTimeout(3500);

    // Verify Tab 3 is active
    const s7Tab3 = await getElectronState();
    console.log(`   Active Tab 3 URL: ${s7Tab3.url}`);
    assert.ok(s7Tab3.url?.includes("youtube.com"), "Expected Tab 3 to be on YouTube");
    assert.equal(s7Tab3.childrenCount, 1, "Only active tab view should be attached");

    // Switch back to Tab 1
    const tabsList = window.locator(".browser-tab-pill");
    const tabCount = await tabsList.count();
    console.log(`   Open tab count in UI: ${tabCount}`);
    assert.ok(tabCount >= 3, "Expected at least 3 tabs");

    await tabsList.nth(0).click();
    await window.waitForTimeout(2000);

    const s7Tab1 = await getElectronState();
    console.log(`   Switched to Tab 1 URL: ${s7Tab1.url}`);
    assert.ok(s7Tab1.url?.includes("httpbin.org"), "Expected Tab 1 to be on httpbin.org");
    assert.equal(s7Tab1.childrenCount, 1, "Only Tab 1 view should be attached");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 8: Bookmarks & History Persistence
    // --------------------------------------------------------------------------
    console.log("[Test 8] Bookmarks & History Persistence...");
    const starBtn = window.locator("button[aria-label='Bookmark']");
    await starBtn.click();
    await window.waitForTimeout(1000);

    const defaultDir = path.join(process.env.APPDATA || "", "AdaL-Nexus", "browser-data");
    const localDir = path.resolve(rootDir, "data", "browser");
    const bmPath = fs.existsSync(path.join(defaultDir, "bookmarks.json"))
      ? path.join(defaultDir, "bookmarks.json")
      : path.join(localDir, "bookmarks.json");

    const hasBookmark = fs.existsSync(bmPath) && JSON.parse(fs.readFileSync(bmPath, "utf8")).length > 0;
    console.log(`   Bookmarks file (${bmPath}) has saved entries: ${hasBookmark}`);
    assert.equal(hasBookmark, true, "Expected bookmark to be written to storage");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 9: Native HWND Overlay Management (Modal opens -> view detaches -> closes -> re-attaches)
    // --------------------------------------------------------------------------
    console.log("[Test 9] Native View Modal Layering (HWND hiding on modal open)...");
    const settingsBtn = window.locator(".sidebar-nav-btn[aria-label='Settings']");
    await settingsBtn.click();
    await window.waitForTimeout(1000);

    const s9ModalOpen = await getElectronState();
    console.log(`   Attached view count while modal open: ${s9ModalOpen.childrenCount}`);
    assert.equal(s9ModalOpen.childrenCount, 0, "Native view must be detached while modal is open");

    // Close modal
    const closeBtn = window.locator(".btn-modal-close");
    await closeBtn.click();
    await window.waitForTimeout(1000);

    const s9ModalClosed = await getElectronState();
    console.log(`   Attached view count after modal closed: ${s9ModalClosed.childrenCount}`);
    assert.equal(s9ModalClosed.childrenCount, 1, "Native view must be re-attached after modal closes");
    console.log("   -> PASS!\n");

    // --------------------------------------------------------------------------
    // Test 10: Window Resize Viewport Adaptation
    // --------------------------------------------------------------------------
    console.log("[Test 10] Window Resizing & Viewport Bounds Adaptation...");
    const initialBounds = (await getElectronState()).viewBounds;
    console.log(`   Initial Viewport Bounds: ${JSON.stringify(initialBounds)}`);

    await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1200, 800);
    });
    await window.waitForTimeout(1500);

    const resizedBounds = (await getElectronState()).viewBounds;
    console.log(`   Resized Viewport Bounds: ${JSON.stringify(resizedBounds)}`);
    assert.notDeepEqual(initialBounds, resizedBounds, "Viewport bounds must adapt to window resizing");
    console.log("   -> PASS!\n");

    console.log("================================================================================");
    console.log("   ALL 10 EVERYDAY BROWSER VERIFICATION TESTS PASSED SUCCESSFULLY!");
    console.log("================================================================================");
  } finally {
    await electronApp.close();
  }
}

runAudit().catch((err) => {
  console.error("\n[AUDIT FAILED]:", err);
  process.exit(1);
});
