import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { Controller } from "./agent/controller.js";
import { PolicyEngine } from "./agent/policy.js";
import { createApp } from "./app.js";
import { LLMError, type LLMProvider } from "./llm/types.js";
import { createDefaultRegistry } from "./tools/index.js";

// HTTP tests for the plan -> review -> start flow, using a FAKE LLM (TEST ONLY; no API calls).
const TEST_KEY = "TEST-KEY-not-a-real-key-654321";

let reply: string | Error = "";
let configured = true;
const llm: LLMProvider = {
  name: "fake-llm",
  model: "fake-model",
  get configured() {
    return configured;
  },
  async complete() {
    if (reply instanceof Error) throw reply;
    return reply;
  },
};

const plan = (steps: object[]) => JSON.stringify({ goal: "Test goal", limitations: ["no browsing"], steps });
const noteStep = { id: "n1", title: "note", tool: "system.note", inputJson: '{"text":"hi"}' };
const gatedStep = { id: "c1", title: "gate", tool: "system.checkpoint", inputJson: '{"action":"a"}' };

let server: Server;
let base: string;

before(async () => {
  const registry = createDefaultRegistry();
  const app = createApp({ controller: new Controller(registry, new PolicyEngine(registry)), registry, llm });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());
beforeEach(() => {
  configured = true;
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function waitStatus(status: string) {
  for (let i = 0; i < 300; i++) {
    const { json } = await call("GET", "/api/run");
    if (json.snapshot?.status === status) return json.snapshot;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never reached ${status}`);
}

describe("plan -> review -> start over HTTP", () => {
  it("reports LLM status without exposing any key", async () => {
    const s = await call("GET", "/api/llm/status");
    assert.deepEqual(s.json, { provider: "fake-llm", model: "fake-model", configured: true });
    const h = await call("GET", "/api/health");
    assert.deepEqual(h.json.llm, { provider: "fake-llm", model: "fake-model", configured: true });
    assert.ok(!JSON.stringify([s.json, h.json]).includes(TEST_KEY));
  });

  it("returns a draft but starts NOTHING until the user clicks start", async () => {
    reply = plan([noteStep]);
    const d = await call("POST", "/api/plans", { task: "write a note" });
    assert.equal(d.status, 201);
    assert.equal(d.json.plan.steps[0].tool, "system.note");
    assert.deepEqual(d.json.limitations, ["no browsing"]);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await call("GET", "/api/run")).json.snapshot, null, "no run may exist before Start");

    const started = await call("POST", `/api/plans/${d.json.planId}/start`);
    assert.equal(started.status, 201);
    await waitStatus("completed");

    const again = await call("POST", `/api/plans/${d.json.planId}/start`);
    assert.equal(again.status, 404, "a draft can only be started once");
  });

  it("a planned sensitive step still waits for approval after Start", async () => {
    reply = plan([noteStep, gatedStep]);
    const d = await call("POST", "/api/plans", { task: "gated" });
    assert.deepEqual(d.json.approvalStepIds, ["c1"]);
    const started = await call("POST", `/api/plans/${d.json.planId}/start`);
    assert.equal(started.status, 201);
    const waiting = await waitStatus("waiting_for_approval");
    assert.equal(waiting.currentStepId, "c1");
    assert.equal(waiting.steps[1].output, undefined);
    assert.equal((await call("POST", `/api/runs/${started.json.runId}/steps/c1/reject`)).status, 200);
    await waitStatus("cancelled");
  });

  it("refuses Start while another run is active and keeps the draft", async () => {
    reply = plan([gatedStep]);
    const first = await call("POST", "/api/plans", { task: "one" });
    await call("POST", `/api/plans/${first.json.planId}/start`);
    await waitStatus("waiting_for_approval");

    reply = plan([noteStep]);
    const second = await call("POST", "/api/plans", { task: "two" });
    const blocked = await call("POST", `/api/plans/${second.json.planId}/start`);
    assert.equal(blocked.status, 409);

    const run = (await call("GET", "/api/run")).json.snapshot;
    await call("POST", `/api/runs/${run.runId}/cancel`);
    await waitStatus("cancelled");
    assert.equal((await call("POST", `/api/plans/${second.json.planId}/start`)).status, 201, "draft survived the conflict");
    await waitStatus("completed");
  });

  it("unknown draft id is 404", async () => {
    assert.equal((await call("POST", "/api/plans/nope/start")).status, 404);
  });

  it("rejects model plans with unknown tools (422) and starts nothing", async () => {
    const before = (await call("GET", "/api/run")).json.snapshot?.runId;
    reply = plan([{ id: "x1", title: "browse", tool: "email.send", inputJson: "" }]);
    const d = await call("POST", "/api/plans", { task: "browse" });
    assert.equal(d.status, 422);
    assert.equal(d.json.code, "invalid_plan");
    assert.ok(d.json.details.some((t: string) => t.includes("email.send")));
    assert.equal((await call("GET", "/api/run")).json.snapshot?.runId, before);
  });

  it("returns 422 for malformed model output", async () => {
    reply = "definitely not json";
    const d = await call("POST", "/api/plans", { task: "x" });
    assert.equal(d.status, 422);
    assert.equal(d.json.code, "invalid_response");
  });

  it("returns 503 not_configured when no key is set, without calling the model", async () => {
    configured = false;
    reply = new Error("must not be called");
    const d = await call("POST", "/api/plans", { task: "x" });
    assert.equal(d.status, 503);
    assert.equal(d.json.code, "not_configured");
    assert.match(d.json.error, /GEMINI_API_KEY/);
  });

  it("maps provider failures to clear statuses and codes", async () => {
    const cases: [ConstructorParameters<typeof LLMError>[0], number][] = [
      ["rate_limited", 429],
      ["quota_exhausted", 429],
      ["timeout", 504],
      ["auth", 502],
      ["api_error", 502],
    ];
    for (const [code, status] of cases) {
      reply = new LLMError(code, `friendly ${code}`);
      const d = await call("POST", "/api/plans", { task: "x" });
      assert.equal(d.status, status, code);
      assert.equal(d.json.code, code);
      assert.equal(d.json.error, `friendly ${code}`);
    }
  });

  it("validates the task field", async () => {
    assert.equal((await call("POST", "/api/plans", {})).status, 400);
    assert.equal((await call("POST", "/api/plans", { task: "" })).status, 400);
  });
});
