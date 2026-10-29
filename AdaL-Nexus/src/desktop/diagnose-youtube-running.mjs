import fs from "node:fs";

async function diagnose() {
  const bridge = JSON.parse(fs.readFileSync('.desktop-bridge.json', 'utf8'));
  const callBridge = async (action, params = {}, tabId) => {
    const res = await fetch(`http://127.0.0.1:${bridge.port}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bridge.token}`
      },
      body: JSON.stringify({ action, params, tabId })
    });
    return res.json();
  };

  console.log("=== 1. Checking Active Tab before navigation ===");
  const initialTabs = await callBridge('getTabs');
  console.log("Initial state:", JSON.stringify(initialTabs, null, 2));
  const activeId = initialTabs.result.activeTabId;

  console.log("\n=== 2. Navigating to 'https://www.youtube.com' ===");
  const navRes = await callBridge('navigate', { url: 'https://www.youtube.com' }, activeId);
  console.log("Navigate action result:", navRes);

  console.log("\n=== 3. Waiting 5 seconds for page load ===");
  await new Promise(r => setTimeout(r, 5000));

  console.log("\n=== 4. Inspecting Tab state ===");
  const afterTabs = await callBridge('getTabs');
  console.log("Tabs after nav:", JSON.stringify(afterTabs, null, 2));

  console.log("\n=== 5. Inspecting Page Content ===");
  const inspectRes = await callBridge('inspectPage', {}, activeId);
  console.log("Page Inspection URL:", inspectRes.result?.url);
  console.log("Page Inspection Title:", inspectRes.result?.title);
  console.log("Page Summary:", inspectRes.result?.summary);
  console.log("Headings count:", inspectRes.result?.headings?.length);
  if (inspectRes.result?.headings?.length) {
    console.log("Sample headings:", inspectRes.result.headings.slice(0, 5));
  }

  console.log("\n=== 6. Capturing Screenshot ===");
  const shotRes = await callBridge('captureScreenshot', {}, activeId);
  if (shotRes.result?.data) {
    fs.writeFileSync('output/diagnose-youtube.png', Buffer.from(shotRes.result.data, 'base64'));
    console.log("Saved screenshot to output/diagnose-youtube.png");
  }
}

diagnose().catch(console.error);
