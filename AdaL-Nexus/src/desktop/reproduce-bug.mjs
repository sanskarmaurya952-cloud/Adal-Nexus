import { _electron as electron } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

async function testCases() {
  console.log("=================================================");
  console.log("  Testing YouTube Navigation in Electron Browser ");
  console.log("=================================================");

  const electronApp = await electron.launch({
    args: [path.join(rootDir, "dist-electron", "main.js")],
    cwd: rootDir,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(2000);

  const getActiveViewInfo = async () => {
    return await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const children = win.contentView.children;
      const view = children[0];
      if (!view) return { attached: false, childrenCount: children.length };
      const bounds = view.getBounds();
      const wc = view.webContents;
      return {
        attached: true,
        childrenCount: children.length,
        bounds,
        url: wc.getURL(),
        title: wc.getTitle(),
        isLoading: wc.isLoading(),
      };
    });
  };

  const addressBar = window.locator("input.omnibox-input");

  // CASE 1: https://www.youtube.com
  console.log("\n--- TEST CASE 1: Enter https://www.youtube.com directly ---");
  await addressBar.fill("https://www.youtube.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const info1 = await getActiveViewInfo();
  console.log("Case 1 View Info:", JSON.stringify(info1, null, 2));

  // CASE 2: youtube.com
  console.log("\n--- TEST CASE 2: Enter youtube.com ---");
  await addressBar.fill("youtube.com");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const info2 = await getActiveViewInfo();
  console.log("Case 2 View Info:", JSON.stringify(info2, null, 2));

  // CASE 3: Search query 'Java DSA tutorial'
  console.log("\n--- TEST CASE 3: Enter search query 'Java DSA tutorial' ---");
  await addressBar.fill("Java DSA tutorial");
  await addressBar.press("Enter");
  await window.waitForTimeout(4000);

  const info3 = await getActiveViewInfo();
  console.log("Case 3 View Info:", JSON.stringify(info3, null, 2));

  // Also check if any error cards exist in React
  const errorCards = await window.locator(".browser-error-card").count();
  console.log("\nError cards in React UI count:", errorCards);

  await electronApp.close();
}

testCases().catch(console.error);
