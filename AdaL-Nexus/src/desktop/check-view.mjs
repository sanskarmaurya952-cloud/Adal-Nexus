import fs from "node:fs";

async function runTest() {
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

  console.log("=== Initial View Info ===");
  const init = await callBridge('getViewDebugInfo');
  console.log(JSON.stringify(init.result, null, 2));

  console.log("\n=== Navigating to 'https://www.youtube.com' ===");
  await callBridge('navigate', { url: 'https://www.youtube.com' });
  await new Promise(r => setTimeout(r, 4000));

  console.log("\n=== View Info After Navigating to YouTube ===");
  const afterNav = await callBridge('getViewDebugInfo');
  console.log(JSON.stringify(afterNav.result, null, 2));

  console.log("\n=== Navigating to 'youtube.com' ===");
  await callBridge('navigate', { url: 'youtube.com' });
  await new Promise(r => setTimeout(r, 4000));

  console.log("\n=== View Info After Navigating to youtube.com ===");
  const afterShort = await callBridge('getViewDebugInfo');
  console.log(JSON.stringify(afterShort.result, null, 2));

  console.log("\n=== Navigating to search 'Java DSA tutorial' ===");
  await callBridge('navigate', { url: 'Java DSA tutorial' });
  await new Promise(r => setTimeout(r, 4000));

  console.log("\n=== View Info After Navigating to Java DSA tutorial ===");
  const afterSearch = await callBridge('getViewDebugInfo');
  console.log(JSON.stringify(afterSearch.result, null, 2));
}

runTest().catch(console.error);
