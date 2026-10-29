import fs from "node:fs";

async function testScreenshots() {
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

  const tabsRes = await callBridge('getTabs');
  const activeId = tabsRes.result.activeTabId;
  console.log("Active Tab ID:", activeId);

  console.log("Navigating to https://www.youtube.com...");
  await callBridge('navigate', { url: 'https://www.youtube.com' }, activeId);
  await new Promise(r => setTimeout(r, 4000));

  console.log("Taking child view screenshot...");
  const childShot = await callBridge('screenshot', {}, activeId);
  if (childShot.result?.data) {
    fs.writeFileSync('output/child_view_youtube.png', Buffer.from(childShot.result.data, 'base64'));
    console.log("Saved child_view_youtube.png, size:", childShot.result.data.length);
  } else {
    console.log("Child shot failed:", childShot);
  }

  console.log("Taking window screenshot...");
  const winShot = await callBridge('windowScreenshot', {});
  if (winShot.result?.data) {
    fs.writeFileSync('output/window_youtube.png', Buffer.from(winShot.result.data, 'base64'));
    console.log("Saved window_youtube.png, size:", winShot.result.data.length);
  } else {
    console.log("Window shot failed:", winShot);
  }
}

testScreenshots().catch(console.error);
