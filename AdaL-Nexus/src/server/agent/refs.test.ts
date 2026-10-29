import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, ControllerError } from "./controller.js";
import { PolicyEngine } from "./policy.js";
import { RefError, checkPlanRefs, findRefs, parseRef, resolveRefs } from "./refs.js";
import { ToolRegistry } from "./registry.js";
import type { RunEvent, Tool } from "./types.js";

// FAKE FIXTURES, TEST ONLY: tiny tools that produce / echo structured data to exercise step data flow.
const producer = (name: string, output: unknown, extra: Partial<Tool> = {}): Tool => ({
  name,
  description: "FAKE FIXTURE (tests only)",
  async run() {
    return { output };
  },
  ...extra,
});
function echo(name: string, seen: unknown[]): Tool {
  return {
    name,
    description: "FAKE FIXTURE (tests only)",
    async run(input) {
      seen.push(input);
      return { output: { echoed: input } };
    },
  };
}
const ref = (r: string) => ({ $ref: r });
const step = (id: string, tool: string, input?: unknown, extra: object = {}) => ({ id, title: id, tool, input, ...extra });
function setup(...tools: Tool[]) {
  const registry = new ToolRegistry();
  tools.forEach((t) => registry.register(t));
  const events: RunEvent[] = [];
  return { registry, events, c: new Controller(registry, new PolicyEngine(registry), (e) => events.push(e)) };
}
const invalid = (fn: () => unknown, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof ControllerError && e.code === "invalid" && re.test(e.message));

describe("reference syntax and plan-time validation", () => {
  it("parses well-formed refs and rejects malformed or dangerous ones", () => {
    assert.deepEqual(parseRef("find.sources.0.url"), { stepId: "find", path: ["sources", "0", "url"] });
    for (const bad of ["find", "a..b", "a.b c", "a.__proto__", "a.constructor.x", "a.prototype", "a/b.c", "a.b[0]"]) {
      assert.equal(typeof parseRef(bad), "string", bad);
    }
  });

  it("finds refs nested in objects and arrays; rejects $ref objects with extra keys or non-strings", () => {
    const { uses, errors } = findRefs({ a: ref("s1.x"), list: [1, { deep: ref("s2.y.0") }], plain: "s3.z" });
    assert.deepEqual(uses.map((u) => u.stepId), ["s1", "s2"]);
    assert.equal(errors.length, 0);
    assert.ok(findRefs({ $ref: "s1.x", extra: 1 }).errors.length > 0);
    assert.ok(findRefs({ $ref: 5 }).errors.length > 0);
  });

  it("checkPlanRefs flags unknown, self and forward references", () => {
    const steps = [
      { id: "a", input: ref("b.x") },
      { id: "b", input: ref("b.x") },
      { id: "c", input: ref("zzz.x") },
      { id: "d", input: ref("a.x") },
    ];
    const problems = checkPlanRefs(steps).join(" | ");
    assert.match(problems, /step "a".*"b" is not earlier/);
    assert.match(problems, /step "b".*"b" is not earlier/);
    assert.match(problems, /step "c".*unknown step "zzz"/);
    assert.ok(!/step "d"/.test(problems));
  });

  it("the controller rejects invalid references before running anything", () => {
    const seen: unknown[] = [];
    const { c } = setup(producer("fake.p", {}), echo("fake.e", seen));
    invalid(() => c.start({ goal: "g", steps: [step("a", "fake.e", ref("b.x")), step("b", "fake.p")] }), /EARLIER/);
    invalid(() => c.start({ goal: "g", steps: [step("a", "fake.e", ref("nope.x"))] }), /unknown step/);
    invalid(() => c.start({ goal: "g", steps: [step("a", "fake.p"), step("b", "fake.e", ref("a.__proto__"))] }), /forbidden/);
    assert.equal(seen.length, 0);
    assert.equal(c.current(), null);
  });
});

describe("runtime resolution", () => {
  it("passes a structured output from an earlier step to a later step", async () => {
    const seen: unknown[] = [];
    const { c } = setup(producer("fake.p", { sources: [{ url: "https://a.example.com/" }, { url: "https://b.example.com/" }], n: 2 }), echo("fake.e", seen));
    const run = c.start({
      goal: "g",
      steps: [step("p", "fake.p"), step("e", "fake.e", { first: ref("p.sources.0.url"), all: ref("p.sources"), n: ref("p.n"), keep: "literal" })],
    });
    await c.whenFinished(run.runId);
    assert.equal(c.current()!.snapshot.status, "completed");
    assert.deepEqual(seen[0], {
      first: "https://a.example.com/",
      all: [{ url: "https://a.example.com/" }, { url: "https://b.example.com/" }],
      n: 2,
      keep: "literal",
    });
    // The snapshot keeps the unresolved reference, not a copy of the data.
    assert.deepEqual(c.current()!.snapshot.steps[1].input, { first: ref("p.sources.0.url"), all: ref("p.sources"), n: ref("p.n"), keep: "literal" });
  });

  it("fails the step (never silently skips) when the referenced path is missing", async () => {
    const seen: unknown[] = [];
    const { c } = setup(producer("fake.p", { sources: [] }), echo("fake.e", seen), echo("fake.after", seen));
    const run = c.start({ goal: "g", steps: [step("p", "fake.p"), step("e", "fake.e", ref("p.sources.0.url")), step("z", "fake.after")] });
    await c.whenFinished(run.runId);
    const s = c.current()!.snapshot;
    assert.equal(s.status, "failed");
    assert.deepEqual(s.steps.map((x) => x.status), ["completed", "failed", "skipped"]);
    assert.match(s.steps[1].reason!, /input reference error.*index "0" not found/);
    assert.equal(seen.length, 0, "the tool must not run with an unresolved input");
  });

  it("fails when the referenced step produced no output", async () => {
    const seen: unknown[] = [];
    const noOutput: Tool = { name: "fake.none", description: "FAKE FIXTURE (tests only)", async run() { return {}; } };
    const { c } = setup(noOutput, echo("fake.e", seen));
    const run = c.start({ goal: "g", steps: [step("p", "fake.none"), step("e", "fake.e", ref("p.x"))] });
    await c.whenFinished(run.runId);
    assert.match(c.current()!.snapshot.steps[1].reason!, /produced no output/);
    assert.equal(seen.length, 0);
  });

  it("does not resolve from a failed step", async () => {
    const seen: unknown[] = [];
    const bad: Tool = { name: "fake.bad", description: "FAKE FIXTURE (tests only)", async run() { throw new Error("boom"); } };
    const { c } = setup(bad, echo("fake.e", seen));
    const run = c.start({ goal: "g", steps: [step("p", "fake.bad"), step("e", "fake.e", ref("p.x"))] });
    await c.whenFinished(run.runId);
    assert.deepEqual(c.current()!.snapshot.steps.map((x) => x.status), ["failed", "skipped"]);
    assert.equal(seen.length, 0);
  });

  it("uses output from an unverified step but the run still ends unverified", async () => {
    const seen: unknown[] = [];
    const unver: Tool = { name: "fake.u", description: "FAKE FIXTURE (tests only)", async run() { return { output: { v: 7 }, verification: "unverified", note: "partial" }; } };
    const { c } = setup(unver, echo("fake.e", seen));
    const run = c.start({ goal: "g", steps: [step("u", "fake.u"), step("e", "fake.e", ref("u.v"))] });
    await c.whenFinished(run.runId);
    assert.deepEqual(seen[0], 7);
    assert.equal(c.current()!.snapshot.status, "unverified");
  });

  it("hands tools a deep clone: mutating it cannot change the earlier output", async () => {
    const mutator: Tool = {
      name: "fake.mut",
      description: "FAKE FIXTURE (tests only)",
      async run(input) {
        (input as { list: number[] }).list.push(999);
        return { output: "mutated" };
      },
    };
    const { c } = setup(producer("fake.p", { list: [1, 2] }), mutator);
    const run = c.start({ goal: "g", steps: [step("p", "fake.p"), step("m", "fake.mut", { list: ref("p.list") })] });
    await c.whenFinished(run.runId);
    assert.deepEqual(c.current()!.snapshot.steps[0].output, { list: [1, 2] });
  });

  it("refuses oversized resolved inputs and prototype-style paths", () => {
    const big = new Map([["p", { s: "x".repeat(600_000) }]]);
    assert.throws(() => resolveRefs({ v: ref("p.s") }, big), (e) => e instanceof RefError && /larger than/.test(e.message));
    const m = new Map([["p", { a: 1 }]]);
    assert.throws(() => resolveRefs(ref("p.toString"), m), RefError);
    assert.throws(() => resolveRefs(ref("p.__proto__"), m), RefError);
  });
});

describe("references do not bypass policy, approvals or events", () => {
  it("a step receiving referenced data still stops at the approval gate and runs only after approval", async () => {
    let ran = 0;
    const gated: Tool = {
      name: "fake.send",
      description: "FAKE FIXTURE (tests only)",
      sensitive: true,
      async run() {
        ran++;
        return { output: "sent" };
      },
    };
    const { c } = setup(producer("fake.p", { v: 1 }), gated);
    const run = c.start({ goal: "g", steps: [step("p", "fake.p"), step("s", "fake.send", { v: ref("p.v") })] });
    for (let i = 0; i < 200 && c.current()!.snapshot.status !== "waiting_for_approval"; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(c.current()!.snapshot.status, "waiting_for_approval");
    assert.equal(ran, 0);
    c.reject(run.runId, "s");
    await c.whenFinished(run.runId);
    assert.equal(ran, 0);
  });

  it("cancellation still works while later steps depend on a running step", async () => {
    let started = false;
    const slow: Tool = {
      name: "fake.slow",
      description: "FAKE FIXTURE (tests only)",
      async run(_i, ctx) {
        started = true;
        await new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))));
        return { output: { v: 1 } };
      },
    };
    const seen: unknown[] = [];
    const { c } = setup(slow, echo("fake.e", seen));
    const run = c.start({ goal: "g", steps: [step("s", "fake.slow"), step("e", "fake.e", ref("s.v"))] });
    for (let i = 0; i < 200 && !started; i++) await new Promise((r) => setTimeout(r, 5));
    c.cancel(run.runId);
    await c.whenFinished(run.runId);
    assert.deepEqual(c.current()!.snapshot.steps.map((x) => x.status), ["cancelled", "cancelled"]);
    assert.equal(seen.length, 0);
  });

  it("stored event history omits step outputs while the live sink receives them", async () => {
    const { c, events } = setup(producer("fake.p", { big: "data" }));
    const run = c.start({ goal: "g", steps: [step("p", "fake.p")] });
    await c.whenFinished(run.runId);
    assert.deepEqual(events.at(-1)!.snapshot.steps[0].output, { big: "data" });
    assert.ok(c.current()!.events.every((e) => e.snapshot.steps.every((s) => s.output === undefined)));
    assert.deepEqual(c.current()!.snapshot.steps[0].output, { big: "data" });
  });
});
