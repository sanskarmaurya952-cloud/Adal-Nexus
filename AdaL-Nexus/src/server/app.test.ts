import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { Controller } from "./agent/controller.js";
import { PolicyEngine } from "./agent/policy.js";
import type { RunSnapshot } from "./agent/types.js";
import { createApp } from "./app.js";
import { getProvider } from "./llm/provider.js";
import { getOutputDir } from "./sheet/tools.js";
import { createDefaultRegistry } from "./tools/index.js";

// HTTP-level tests using the REAL system tools (system.note / system.checkpoint).
// No browser, research or LLM behaviour is involved or implied.

let server: Server;
let base: string;

before(async () => {
  const registry = createDefaultRegistry();
  const controller = new Controller(registry, new PolicyEngine(registry));
  const app = createApp({ controller, registry, llm: getProvider() });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function waitStatus(status: string): Promise<RunSnapshot> {
  for (let i = 0; i < 200; i++) {
    const { json } = await call("GET", "/api/run");
    if (json.snapshot?.status === status) return json.snapshot;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never reached ${status}`);
}

describe("HTTP API", () => {
  it("lists exactly the explicitly registered tools", async () => {
    const { status, json } = await call("GET", "/api/tools");
    assert.equal(status, 200);
    assert.deepEqual(json.map((t: any) => t.name).sort(), [
      "browser.back",
      "browser.click",
      "browser.close_tab",
      "browser.extract",
      "browser.forward",
      "browser.get_current_page",
      "browser.get_tabs",
      "browser.inspect",
      "browser.navigate",
      "browser.new_tab",
      "browser.observe",
      "browser.open",
      "browser.open_url",
      "browser.pause_media",
      "browser.play_youtube_video",
      "browser.refresh",
      "browser.screenshot",
      "browser.scroll",
      "browser.search",
      "browser.switch_tab",
      "browser.tabs",
      "browser.type",
      "browser.upload",
      "browser.wait",
      "draft.create",
      "research.collect",
      "research.consolidate",
      "research.find_sources",
      "sheet.verify",
      "sheet.write",
      "social.compose_post",
      "social.generate_captions",
      "social.publish",
      "social.validate_image",
      "system.checkpoint",
      "system.note",
      "system.wait",
    ]);
    assert.ok(json.filter((t: any) => t.name.startsWith("browser.")).every((t: any) => t.sensitive === false));
  });

  it("rejects a plan with an unregistered tool with 400 and starts nothing", async () => {
    const { status, json } = await call("POST", "/api/runs", {
      goal: "g",
      steps: [{ id: "s1", title: "open", tool: "email.send" }],
    });
    assert.equal(status, 400);
    assert.match(json.error, /not registered/);
    assert.equal((await call("GET", "/api/run")).json.snapshot, null);
  });

  it("approval flow over HTTP: gated step waits, duplicates/stale ids are refused, approve completes", async () => {
    const plan = {
      goal: "http approval test",
      steps: [
        { id: "n1", title: "note", tool: "system.note", input: { text: "hello" } },
        { id: "c1", title: "checkpoint", tool: "system.checkpoint", input: { action: "demo" } },
        { id: "n2", title: "note 2", tool: "system.note", input: { text: "bye" } },
      ],
    };
    const started = await call("POST", "/api/runs", plan);
    assert.equal(started.status, 201);
    const runId = started.json.runId as string;

    const waiting = await waitStatus("waiting_for_approval");
    assert.equal(waiting.currentStepId, "c1");

    assert.equal((await call("POST", "/api/runs", plan)).status, 409); // duplicate start
    assert.equal((await call("POST", `/api/runs/${runId}/steps/n1/approve`)).status, 409); // wrong step
    assert.equal((await call("POST", `/api/runs/stale-id/cancel`)).status, 404); // stale run
    assert.equal((await call("POST", `/api/runs/${runId}/pause`)).status, 409); // not running

    assert.equal((await call("POST", `/api/runs/${runId}/steps/c1/approve`)).status, 200);
    assert.equal((await call("POST", `/api/runs/${runId}/steps/c1/approve`)).status, 409); // duplicate approve

    const done = await waitStatus("completed");
    assert.deepEqual(done.steps.map((s) => s.status), ["completed", "completed", "completed"]);
    assert.deepEqual(done.steps[1].output, { recorded: true, action: "demo" });
  });

  it("rejecting over HTTP leaves the gated step unexecuted", async () => {
    const started = await call("POST", "/api/runs", {
      goal: "http reject test",
      steps: [{ id: "c1", title: "checkpoint", tool: "system.checkpoint" }],
    });
    assert.equal(started.status, 201);
    await waitStatus("waiting_for_approval");
    assert.equal((await call("POST", `/api/runs/${started.json.runId}/steps/c1/reject`)).status, 200);
    const done = await waitStatus("cancelled");
    assert.equal(done.steps[0].status, "skipped");
    assert.equal(done.steps[0].output, undefined);
  });

  it("downloads existing files from output/ with proper headers", async () => {
    const outputDir = getOutputDir();
    const testFile = resolve(outputDir, "test-download-ok.xlsx");
    writeFileSync(testFile, "test-excel-bytes");

    try {
      const res = await fetch(`${base}/api/downloads/test-download-ok.xlsx`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="test-download-ok\.xlsx"/);
      const text = await res.text();
      assert.equal(text, "test-excel-bytes");
    } finally {
      if (existsSync(testFile)) unlinkSync(testFile);
    }
  });

  it("returns 404 for non-existent files in download route", async () => {
    const res = await fetch(`${base}/api/downloads/missing-file.xlsx`);
    assert.equal(res.status, 404);
    const json = (await res.json()) as any;
    assert.match(json.error, /not found/i);
  });

  it("returns 400 and blocks path traversal attempts in download route", async () => {
    const res = await fetch(`${base}/api/downloads/..%2Fpackage.json`);
    assert.equal(res.status, 400);
    const json = (await res.json()) as any;
    assert.match(json.error, /path traversal denied/i);
  });
});
