import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller } from "../agent/controller.js";
import { PolicyEngine } from "../agent/policy.js";
import { createDefaultRegistry } from "../tools/index.js";
import { LLMError, type CompleteOptions, type LLMProvider } from "../llm/types.js";
import { Planner, PlannerError, buildResponseSchema, buildSystemPrompt } from "./planner.js";

// =====================================================================================
// FAKE LLM — TEST ONLY. Returns canned strings; no network, no Gemini SDK, no API calls.
// =====================================================================================
class FakeLLM implements LLMProvider {
  readonly name = "fake-llm";
  readonly model = "fake-model";
  calls: { prompt: string; opts?: CompleteOptions }[] = [];
  constructor(
    private reply: string | Error,
    readonly configured = true,
  ) {}
  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    this.calls.push({ prompt, opts });
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

const json = (o: unknown) => JSON.stringify(o);
const validReply = () =>
  json({
    goal: "Record two notes",
    limitations: [],
    steps: [
      { id: "n1", title: "First note", tool: "system.note", inputJson: '{"text":"hello"}' },
      { id: "w1", title: "Short wait", tool: "system.wait", inputJson: '{"ms":100}' },
    ],
  });

function setup(reply: string | Error, configured = true) {
  const registry = createDefaultRegistry();
  const policy = new PolicyEngine(registry);
  const llm = new FakeLLM(reply, configured);
  return { registry, policy, llm, planner: new Planner(llm, registry, policy) };
}

async function rejects(p: Promise<unknown>, code: PlannerError["code"]): Promise<PlannerError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof PlannerError, `expected PlannerError, got ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`expected rejection with ${code}`);
}

describe("Planner: valid plans", () => {
  it("turns a well-formed model reply into a validated draft and executes nothing", async () => {
    const { planner, llm } = setup(validReply());
    const d = await planner.draft("make two notes");
    assert.equal(d.plan.goal, "Record two notes");
    assert.deepEqual(d.plan.steps.map((s) => s.tool), ["system.note", "system.wait"]);
    assert.deepEqual(d.plan.steps[0].input, { text: "hello" });
    assert.deepEqual(d.approvalStepIds, []);
    assert.equal(d.provider, "fake-llm");
    assert.equal(llm.calls.length, 1);
    assert.equal(planner.get(d.planId)?.planId, d.planId);
  });

  it("sends only registered tools to the model (prompt and schema enum)", async () => {
    const { planner, llm, registry } = setup(validReply());
    await planner.draft("anything");
    const names = registry.list().map((t) => t.name);
    const opts = llm.calls[0].opts!;
    const schema = opts.jsonSchema as any;
    assert.deepEqual(schema.properties.steps.items.properties.tool.enum, names);
    for (const n of names) assert.ok(opts.system!.includes(n));
    assert.ok(!opts.system!.includes("email.send"));
    assert.match(llm.calls[0].prompt, /<task>\nanything\n<\/task>/);
  });

  it("accepts JSON wrapped in a markdown code fence", async () => {
    const { planner } = setup("```json\n" + validReply() + "\n```");
    const d = await planner.draft("x");
    assert.equal(d.plan.steps.length, 2);
  });

  it("keeps limitations reported by the model", async () => {
    const reply = json({
      goal: "g",
      limitations: ["Cannot browse the web", "  "],
      steps: [{ id: "n1", title: "t", tool: "system.note", inputJson: '{"text":"x"}' }],
    });
    const { planner } = setup(reply);
    assert.deepEqual((await planner.draft("x")).limitations, ["Cannot browse the web"]);
  });
});

describe("Planner: untrusted model output", () => {
  it("rejects malformed JSON", async () => {
    const { planner } = setup("not json at all {");
    await rejects(planner.draft("x"), "invalid_response");
  });

  it("rejects JSON that is not an object", async () => {
    const { planner } = setup("[1,2,3]");
    await rejects(planner.draft("x"), "invalid_response");
  });

  it("rejects an unknown tool, naming it, and stores no draft", async () => {
    const reply = json({
      goal: "g",
      limitations: [],
      steps: [
        { id: "n1", title: "ok", tool: "system.note", inputJson: '{"text":"x"}' },
        { id: "b1", title: "open site", tool: "email.send", inputJson: '{"to":"a@example.com"}' },
      ],
    });
    const { planner } = setup(reply);
    const err = await rejects(planner.draft("x"), "invalid_plan");
    assert.ok(err.details!.some((d) => d.includes("email.send") && d.includes("not registered")));
  });

  it("rejects structurally invalid plans with all problems listed", async () => {
    const reply = json({
      goal: "",
      steps: [
        { id: "A B", title: "", tool: "system.note", inputJson: "{bad json" },
        { id: "dup", title: "t", tool: "system.note", inputJson: "[1]" },
        { id: "dup", title: "t", tool: "system.note", inputJson: "" },
      ],
    });
    const { planner } = setup(reply);
    const err = await rejects(planner.draft("x"), "invalid_plan");
    const text = err.details!.join(" | ");
    assert.match(text, /goal/);
    assert.match(text, /id must match/);
    assert.match(text, /title/);
    assert.match(text, /not valid JSON/);
    assert.match(text, /JSON object/);
    assert.match(text, /duplicate id/);
  });

  it("rejects empty and oversized step lists", async () => {
    await rejects(setup(json({ goal: "g", limitations: [], steps: [] })).planner.draft("x"), "invalid_plan");
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: "t", tool: "system.note", inputJson: '{"text":"x"}' }));
    await rejects(setup(json({ goal: "g", limitations: [], steps: many })).planner.draft("x"), "invalid_plan");
  });

  it("validates the task before calling the model", async () => {
    const { planner, llm } = setup(validReply());
    await rejects(planner.draft(""), "invalid_task");
    await rejects(planner.draft("   "), "invalid_task");
    await rejects(planner.draft(42), "invalid_task");
    await rejects(planner.draft("x".repeat(2001)), "invalid_task");
    assert.equal(llm.calls.length, 0);
  });
});

describe("Planner: LLM and configuration failures", () => {
  it("reports a missing key without calling the provider", async () => {
    const { planner, llm } = setup(validReply(), false);
    const err = await rejects(planner.draft("x"), "not_configured");
    assert.match(err.message, /GEMINI_API_KEY/);
    assert.equal(llm.calls.length, 0);
  });

  for (const code of ["rate_limited", "quota_exhausted", "timeout", "auth", "api_error", "invalid_response"] as const) {
    it(`passes through the ${code} error with its user-facing message`, async () => {
      const { planner } = setup(new LLMError(code, `friendly ${code} message`));
      const err = await rejects(planner.draft("x"), code);
      assert.equal(err.message, `friendly ${code} message`);
    });
  }

  it("hides unexpected provider exceptions behind a generic message", async () => {
    const { planner } = setup(new Error("secret internal detail sk-12345"));
    const err = await rejects(planner.draft("x"), "api_error");
    assert.ok(!err.message.includes("sk-12345"));
  });

  it("refuses a second plan request while one is in flight (no duplicate paid calls)", async () => {
    let release!: (v: string) => void;
    const slow: LLMProvider = {
      name: "slow",
      configured: true,
      complete: () => new Promise<string>((r) => (release = r)),
    };
    const registry = createDefaultRegistry();
    const planner = new Planner(slow, registry, new PolicyEngine(registry));
    const first = planner.draft("one");
    await rejects(planner.draft("two"), "busy");
    release(validReply());
    await first;
    // after completion a new request is accepted again
    const second = planner.draft("three");
    release(validReply());
    await second;
  });
});

describe("Planner: approval policy is preserved", () => {
  const gatedReply = (extra: object = {}) =>
    json({
      goal: "g",
      limitations: [],
      steps: [
        { id: "n1", title: "note", tool: "system.note", inputJson: '{"text":"x"}' },
        {
          id: "c1",
          title: "checkpoint",
          tool: "system.checkpoint",
          inputJson: '{"action":"demo"}',
          // The model tries to disable approval and set a huge timeout; both must be ignored.
          requiresApproval: false,
          approved: true,
          skipApproval: true,
          timeoutMs: 999999,
          ...extra,
        },
      ],
    });

  it("marks sensitive steps as needing approval and strips model-supplied control flags", async () => {
    const { planner } = setup(gatedReply());
    const d = await planner.draft("x");
    assert.deepEqual(d.approvalStepIds, ["c1"]);
    const step = d.plan.steps[1] as unknown as Record<string, unknown>;
    assert.equal(step.requiresApproval, undefined);
    assert.equal(step.approved, undefined);
    assert.equal(step.skipApproval, undefined);
    assert.equal(step.timeoutMs, undefined);
  });

  it("a model-planned sensitive step still blocks at the controller until the user approves", async () => {
    const { planner, registry, policy } = setup(gatedReply());
    const d = await planner.draft("x");
    let executed = 0;
    const real = registry.get("system.checkpoint")!;
    const original = real.run.bind(real);
    real.run = async (input, ctx) => {
      executed++;
      return original(input, ctx);
    };

    const controller = new Controller(registry, policy);
    const run = controller.start(d.plan);
    for (let i = 0; i < 200 && controller.current()!.snapshot.status !== "waiting_for_approval"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(controller.current()!.snapshot.status, "waiting_for_approval");
    assert.equal(executed, 0, "sensitive tool must not run before approval");

    controller.reject(run.runId, "c1");
    await controller.whenFinished(run.runId);
    assert.equal(executed, 0, "sensitive tool must not run after rejection");
    assert.equal(controller.current()!.snapshot.status, "cancelled");
  });

  it("the controller still refuses a draft whose tool was removed after planning", async () => {
    const { planner, registry, policy } = setup(validReply());
    const d = await planner.draft("x");
    registry.unregister("system.wait");
    const controller = new Controller(registry, policy);
    assert.throws(() => controller.start(d.plan), /not registered/);
  });
});

describe("prompt builders", () => {
  it("lists tools and flags sensitive ones; schema enum equals the given names", () => {
    const prompt = buildSystemPrompt([
      { name: "a.one", description: "does one", sensitive: false },
      { name: "b.two", description: "does two", sensitive: true },
    ]);
    assert.match(prompt, /- a\.one: does one/);
    assert.match(prompt, /- b\.two \[sensitive: needs user approval\]: does two/);
    const schema = buildResponseSchema(["a.one", "b.two"]) as any;
    assert.deepEqual(schema.properties.steps.items.properties.tool.enum, ["a.one", "b.two"]);
  });
});
