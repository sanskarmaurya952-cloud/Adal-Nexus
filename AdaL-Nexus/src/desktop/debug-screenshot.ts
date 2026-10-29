import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

async function captureScreen() {
  console.log("=== Capturing Live Screenshot of YouTube Navigation ===");
  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const addressBar = window.locator("input.omnibox-input");
  await addressBar.fill("https://www.youtube.com");
  await addressBar.press("Enter");

  console.log("Filled https://www.youtube.com and pressed Enter. Waiting 4s...");
  await window.waitForTimeout(4000);

  const screenshotPath = path.join(rootDir, "output", "live_youtube_debug.png");
  await window.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Also check tabs
  const tabs = await window.evaluate(() => (window as any).adalBrowser?.getTabs());
  console.log("Tabs:", JSON.stringify(tabs, null, 2));

  // Check what DOM is rendering inside the React window
  const htmlSnippet = await window.evaluate(() => {
    const vp = document.querySelector(".browser-viewport-container");
    return vp ? vp.outerHTML.slice(0, 500) : "no viewport found";
  });
  console.log("React Viewport DOM:", htmlSnippet);

  await electronApp.close();
}

captureScreen().catch(console.error);
