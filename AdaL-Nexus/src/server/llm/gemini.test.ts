import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@google/genai";
import { GeminiProvider, type GeminiModelsApi } from "./gemini.js";
import { getProvider } from "./provider.js";
import { LLMError } from "./types.js";

// =====================================================================================
// MOCK GEMINI CLIENT — TEST ONLY. Implements the tiny `models.generateContent` surface.
// No network access and no API calls are made by this file.
// =====================================================================================
const TEST_KEY = "TEST-KEY-not-a-real-key-123456";

function mock(impl: GeminiModelsApi["generateContent"]) {
  const calls: Parameters<GeminiModelsApi["generateContent"]>[0][] = [];
  const models: GeminiModelsApi = {
    generateContent: async (p) => {
      calls.push(p);
      return impl(p);
    },
  };
  return { models, calls };
}

const provider = (models: GeminiModelsApi, defaultTimeoutMs?: number) =>
  new GeminiProvider({ apiKey: TEST_KEY, model: "test-model", models, defaultTimeoutMs });

async function failure(p: Promise<unknown>): Promise<LLMError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof LLMError, `expected LLMError, got ${String(e)}`);
    return e;
  }
  assert.fail("expected rejection");
}

const apiError = (status: number, message: string) => new ApiError({ status, message });

describe("GeminiProvider (mocked SDK)", () => {
  it("returns the model text and sends model, system prompt, JSON mode and schema", async () => {
    const m = mock(async () => ({ text: '{"ok":true}' }));
    const schema = { type: "object" };
    const out = await provider(m.models).complete("hello", { system: "be brief", jsonSchema: schema });
    assert.equal(out, '{"ok":true}');
    const call = m.calls[0];
    assert.equal(call.model, "test-model");
    assert.equal(call.contents, "hello");
    assert.equal(call.config!.systemInstruction, "be brief");
    assert.equal(call.config!.responseMimeType, "application/json");
    assert.equal(call.config!.responseJsonSchema, schema);
    assert.ok(call.config!.abortSignal instanceof AbortSignal);
  });

  it("does not request JSON mode when no schema is given", async () => {
    const m = mock(async () => ({ text: "plain" }));
    await provider(m.models).complete("hi");
    assert.equal(m.calls[0].config!.responseMimeType, undefined);
    assert.equal(m.calls[0].config!.systemInstruction, undefined);
  });

  it("treats an empty or missing response as invalid_response", async () => {
    for (const text of [undefined, "", "   "]) {
      const e = await failure(provider(mock(async () => ({ text })).models).complete("x"));
      assert.equal(e.code, "invalid_response");
    }
  });

  it("maps HTTP 429 to rate_limited, or quota_exhausted when the message says quota", async () => {
    let e = await failure(provider(mock(async () => { throw apiError(429, "Too many requests"); }).models).complete("x"));
    assert.equal(e.code, "rate_limited");
    e = await failure(provider(mock(async () => { throw apiError(429, "You exceeded your current quota (per day)"); }).models).complete("x"));
    assert.equal(e.code, "quota_exhausted");
    assert.match(e.message, /GEMINI_MODEL/);
  });

  it("maps 401/403/invalid-key 400 to auth, 404 and 5xx to api_error", async () => {
    for (const [status, msg] of [[401, "x"], [403, "x"], [400, "API key not valid. Please pass a valid API key."]] as const) {
      const e = await failure(provider(mock(async () => { throw apiError(status, msg); }).models).complete("x"));
      assert.equal(e.code, "auth", `status ${status}`);
    }
    let e = await failure(provider(mock(async () => { throw apiError(404, "model not found"); }).models).complete("x"));
    assert.equal(e.code, "api_error");
    assert.match(e.message, /GEMINI_MODEL/);
    e = await failure(provider(mock(async () => { throw apiError(503, "overloaded"); }).models).complete("x"));
    assert.equal(e.code, "api_error");
    assert.match(e.message, /503/);
  });

  it("maps unknown failures to a generic api_error", async () => {
    const e = await failure(provider(mock(async () => { throw new Error("socket hang up"); }).models).complete("x"));
    assert.equal(e.code, "api_error");
    assert.ok(!e.message.includes("socket"));
  });

  it("times out even if the SDK never resolves and ignores the abort signal", async () => {
    const m = mock(() => new Promise(() => {}));
    const started = Date.now();
    const e = await failure(provider(m.models).complete("x", { timeoutMs: 40 }));
    assert.equal(e.code, "timeout");
    assert.ok(Date.now() - started < 1500);
    assert.equal((m.calls[0].config!.abortSignal as AbortSignal).aborted, true);
  });

  it("never leaks the API key or raw provider text in the error returned to callers", async () => {
    const leaky = new Error(`request to https://x/?key=${TEST_KEY} failed: Authorization: Bearer ${TEST_KEY}`) as Error & { status: number };
    leaky.status = 500;
    const e = await failure(provider(mock(async () => { throw leaky; }).models).complete("x"));
    assert.ok(!JSON.stringify({ message: e.message, code: e.code, stack: undefined }).includes(TEST_KEY));
  });

  it("does not print the key or raw message to the console on failure", async () => {
    const logged: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      await failure(provider(mock(async () => { throw apiError(500, `boom ${TEST_KEY}`); }).models).complete("x"));
    } finally {
      console.warn = orig;
    }
    assert.ok(logged.length > 0);
    assert.ok(!logged.join("\n").includes(TEST_KEY));
    assert.ok(!logged.join("\n").includes("boom"));
  });
});

describe("getProvider configuration", () => {
  const base = { llmProvider: "gemini", geminiApiKey: "", geminiModel: "m-1" };

  it("is unconfigured (but valid) when GEMINI_API_KEY is absent", async () => {
    const p = getProvider(base);
    assert.equal(p.configured, false);
    assert.equal(p.name, "gemini");
    assert.equal(p.model, "m-1");
    const e = await failure(p.complete("x"));
    assert.equal(e.code, "not_configured");
    assert.match(e.message, /GEMINI_API_KEY/);
  });

  it("builds a configured Gemini provider when a key is present, without exposing it", () => {
    const p = getProvider({ ...base, geminiApiKey: TEST_KEY });
    assert.equal(p.configured, true);
    assert.equal(p.model, "m-1");
    // The provider object itself holds no `apiKey` field (the key is only handed to the SDK client).
    assert.ok(!Object.keys(p).includes("apiKey"));
  });

  it('supports LLM_PROVIDER="none" and falls back for unknown names', () => {
    assert.equal(getProvider({ ...base, llmProvider: "none" }).configured, false);
    const orig = console.warn;
    console.warn = () => {};
    try {
      const p = getProvider({ ...base, llmProvider: "mystery", geminiApiKey: TEST_KEY });
      assert.equal(p.configured, false);
      assert.equal(p.name, "none");
    } finally {
      console.warn = orig;
    }
  });
});
