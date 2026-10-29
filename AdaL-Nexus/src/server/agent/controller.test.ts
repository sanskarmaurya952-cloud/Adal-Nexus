import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, ControllerError } from "./controller.js";
import { PolicyEngine } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import type { RunEvent, Tool, ToolResult } from "./types.js";

// =====================================================================================
// FAKE FIXTURES — TEST ONLY. These tools simulate nothing about browsing or research;
// they only let the tests control timing and outcomes of the controller state machine.
// =====================================================================================

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Fake extends Tool {
  calls: number;
}

/** Fake tool that records calls and returns `result` (or throws). */
function fakeTool(
  name: string,
  opts: { result?: ToolResult; error?: string; sensitive?: boolean; onRun?: () => void } = {},
): Fake {
  const t: Fake = {
    name,
    description: "FAKE FIXTURE (tests only)",
    sensitive: opts.sensitive,
    calls: 0,
    async run() {
      t.calls++;
      opts.onRun?.();
      if (opts.error) throw new Error(opts.error);
      return opts.result ?? { output: `${name} ok` };
    },
  };
  return t;
}

/** Fake tool that blocks until released; optionally ignores the abort signal. */
function blockingTool(name: string, honorSignal = true) {
  const started = deferred();
  const release = deferred();
  const t: Fake = {
    name,
    description: "FAKE FIXTURE (tests only)",
    calls: 0,
    async run(_input, ctx) {
      t.calls++;
      started.resolve();
      if (honorSignal) {
        ctx.signal.addEventListener("abort", () => release.reject(new Error("aborted by signal")), {
          once: true,
        });
      }
      await release.promise;
      return { output: `${name} released` };
    },
  };
  return { tool: t, started: started.promise, release: () => release.resolve() };
}

function setup(...tools: Tool[]) {
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  const events: RunEvent[] = [];
  const controller = new Controller(registry, new PolicyEngine(registry), (e) => events.push(e));
  return { registry, controller, events };
}

const step = (id: string, tool: string, extra: object = {}) => ({ id, title: `Step ${id}`, tool, ...extra });
const statuses = (c: Controller) => c.current()!.snapshot.steps.map((s) => s.status);

function expectCode(fn: () => unknown, code: ControllerError["code"]) {
  assert.throws(fn, (e: unknown) => e instanceof ControllerError && e.code === code);
}

// =====================================================================================

describe("state transitions and events", () => {
  it("runs steps in order, ends completed, and emits ordered events matching history", async () => {
    const order: string[] = [];
    const a = fakeTool("fake.a", { onRun: () => order.push("a") });
    const b = fakeTool("fake.b", { onRun: () => order.push("b") });
    const { controller, events } = setup(a, b);

    const snap = controller.start({ goal: "g", steps: [step("s1", "fake.a"), step("s2", "fake.b")] });
    assert.ok(["pending", "running"].includes(snap.status));
    await controller.whenFinished(snap.runId);

    const final = controller.current()!.snapshot;
    assert.equal(final.status, "completed");
    assert.deepEqual(statuses(controller), ["completed", "completed"]);
    assert.deepEqual(order, ["a", "b"]);
    assert.equal(final.currentStepId, null);

    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      "task.created",
      "task.started",
      "step.running",
      "step.completed",
      "step.running",
      "step.completed",
      "task.finished",
    ]);
    events.forEach((e, i) => assert.equal(e.seq, i + 1));
    assert.equal(events.at(-1)!.snapshot.status, "completed");
    assert.equal(controller.current()!.events.length, events.length);
  });

  it("a throwing event sink does not break execution", async () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool("fake.a"));
    const c = new Controller(registry, new PolicyEngine(registry), () => {
      throw new Error("listener bug");
    });
    const s = c.start({ goal: "g", steps: [step("s1", "fake.a")] });
    await c.whenFinished(s.runId);
    assert.equal(c.current()!.snapshot.status, "completed");
  });

  it("a failed step is not skipped silently: run fails, later steps are marked skipped and never run", async () => {
    const a = fakeTool("fake.a");
    const bad = fakeTool("fake.bad", { error: "boom" });
    const c3 = fakeTool("fake.c");
    const { controller, events } = setup(a, bad, c3);
    const s = controller.start({
      goal: "g",
      steps: [step("s1", "fake.a"), step("s2", "fake.bad"), step("s3", "fake.c")],
    });
    await controller.whenFinished(s.runId);
    const snap = controller.current()!.snapshot;
    assert.equal(snap.status, "failed");
    assert.deepEqual(statuses(controller), ["completed", "failed", "skipped"]);
    assert.equal(snap.steps[1].reason, "boom");
    assert.match(snap.steps[2].reason!, /s2/);
    assert.equal(c3.calls, 0);
    assert.ok(events.some((e) => e.type === "step.failed" && e.stepId === "s2"));
    assert.ok(events.some((e) => e.type === "step.skipped" && e.stepId === "s3"));
  });

  it("unverified results are not reported as completed", async () => {
    const u = fakeTool("fake.u", { result: { verification: "unverified", note: "could not read back" } });
    const { controller } = setup(u, fakeTool("fake.a"));
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.u"), step("s2", "fake.a")] });
    await controller.whenFinished(s.runId);
    const snap = controller.current()!.snapshot;
    assert.deepEqual(statuses(controller), ["unverified", "completed"]);
    assert.equal(snap.status, "unverified");
    assert.notEqual(snap.status, "completed");
  });

  it("failed verification makes the step and the run fail", async () => {
    const v = fakeTool("fake.v", { result: { verification: "failed", note: "row count mismatch" } });
    const after = fakeTool("fake.after");
    const { controller } = setup(v, after);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.v"), step("s2", "fake.after")] });
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "failed");
    assert.deepEqual(statuses(controller), ["failed", "skipped"]);
    assert.equal(after.calls, 0);
  });

  it("a step that exceeds its timeout fails even if the tool ignores the abort signal", async () => {
    const hang = blockingTool("fake.hang", false);
    const { controller } = setup(hang.tool);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.hang", { timeoutMs: 30 })] });
    await controller.whenFinished(s.runId);
    const snap = controller.current()!.snapshot;
    assert.equal(snap.status, "failed");
    assert.match(snap.steps[0].reason!, /timed out/);
  });
});

describe("unknown tools and policy", () => {
  it("rejects a plan containing an unregistered tool before anything runs", () => {
    const a = fakeTool("fake.a");
    const { controller, events } = setup(a);
    expectCode(
      () => controller.start({ goal: "g", steps: [step("s1", "fake.a"), step("s2", "browser.open")] }),
      "invalid",
    );
    assert.equal(a.calls, 0);
    assert.equal(events.length, 0);
    assert.equal(controller.current(), null);
  });

  it("rejects malformed plans", () => {
    const { controller } = setup(fakeTool("fake.a"));
    expectCode(() => controller.start(null), "invalid");
    expectCode(() => controller.start({ goal: "", steps: [step("s1", "fake.a")] }), "invalid");
    expectCode(() => controller.start({ goal: "g", steps: [] }), "invalid");
    expectCode(() => controller.start({ goal: "g", steps: [step("x", "fake.a"), step("x", "fake.a")] }), "invalid");
  });

  it("denies at run time if a tool disappears after the plan was accepted", async () => {
    const holder: { registry?: ToolRegistry } = {};
    const remover = fakeTool("fake.remover", { onRun: () => holder.registry!.unregister("fake.b") });
    const b = fakeTool("fake.b");
    const { controller, registry, events } = setup(remover, b);
    holder.registry = registry;
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.remover"), step("s2", "fake.b")] });
    await controller.whenFinished(s.runId);
    assert.equal(b.calls, 0);
    assert.deepEqual(statuses(controller), ["completed", "failed"]);
    assert.equal(controller.current()!.snapshot.status, "failed");
    assert.ok(events.some((e) => e.type === "policy.denied" && e.stepId === "s2"));
  });

  it("PolicyEngine: unknown denied, sensitive and flagged steps need approval, others allowed", () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool("fake.plain"));
    registry.register(fakeTool("fake.send", { sensitive: true }));
    const p = new PolicyEngine(registry);
    assert.equal(p.evaluate({ id: "1", title: "t", tool: "nope" }).kind, "deny");
    assert.equal(p.evaluate({ id: "1", title: "t", tool: "fake.plain" }).kind, "allow");
    assert.equal(p.evaluate({ id: "1", title: "t", tool: "fake.plain", requiresApproval: true }).kind, "require_approval");
    // A plan cannot downgrade a sensitive tool by setting requiresApproval=false.
    assert.equal(p.evaluate({ id: "1", title: "t", tool: "fake.send", requiresApproval: false }).kind, "require_approval");
  });
});

describe("cancellation", () => {
  it("cancelling a running task stops the current step and prevents later steps", async () => {
    const blocker = blockingTool("fake.block");
    const later = fakeTool("fake.later");
    const { controller, events } = setup(blocker.tool, later);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block"), step("s2", "fake.later"), step("s3", "fake.later")] });
    await blocker.started;
    controller.cancel(s.runId);
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "cancelled");
    assert.deepEqual(statuses(controller), ["cancelled", "cancelled", "cancelled"]);
    assert.equal(later.calls, 0);
    assert.ok(events.some((e) => e.type === "task.cancel_requested"));
    assert.equal(events.at(-1)!.type, "task.finished");
  });

  it("cancel still takes effect when the tool ignores its abort signal", async () => {
    const stubborn = blockingTool("fake.stubborn", false);
    const later = fakeTool("fake.later");
    const { controller } = setup(stubborn.tool, later);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.stubborn"), step("s2", "fake.later")] });
    await stubborn.started;
    controller.cancel(s.runId);
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "cancelled");
    assert.equal(later.calls, 0);
  });

  it("cancelling a paused task ends it cancelled", async () => {
    const blocker = blockingTool("fake.block");
    const later = fakeTool("fake.later");
    const { controller } = setup(blocker.tool, later);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block"), step("s2", "fake.later")] });
    await blocker.started;
    controller.pause(s.runId);
    blocker.release();
    await waitFor(() => controller.current()!.snapshot.status === "paused");
    controller.cancel(s.runId);
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "cancelled");
    assert.deepEqual(statuses(controller), ["completed", "cancelled"]);
    assert.equal(later.calls, 0);
  });

  it("duplicate cancel and cancel after finish are conflicts", async () => {
    const blocker = blockingTool("fake.block");
    const { controller } = setup(blocker.tool);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block")] });
    await blocker.started;
    controller.cancel(s.runId);
    expectCode(() => controller.cancel(s.runId), "conflict");
    await controller.whenFinished(s.runId);
    expectCode(() => controller.cancel(s.runId), "conflict");
  });
});

describe("pause / resume", () => {
  it("pause stops before the next step; resume continues in order", async () => {
    const order: string[] = [];
    const blocker = blockingTool("fake.block");
    const next = fakeTool("fake.next", { onRun: () => order.push("next") });
    const { controller, events } = setup(blocker.tool, next);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block"), step("s2", "fake.next")] });
    await blocker.started;

    const afterPause = controller.pause(s.runId);
    assert.equal(afterPause.pauseRequested, true);
    assert.equal(afterPause.status, "running"); // current step still finishing
    blocker.release();

    await waitFor(() => controller.current()!.snapshot.status === "paused");
    assert.equal(next.calls, 0);
    assert.deepEqual(statuses(controller), ["completed", "pending"]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(next.calls, 0, "no step may start while paused");

    controller.resume(s.runId);
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "completed");
    assert.deepEqual(order, ["next"]);
    const types = events.map((e) => e.type);
    assert.ok(types.indexOf("task.pause_requested") < types.indexOf("task.paused"));
    assert.ok(types.indexOf("task.paused") < types.indexOf("task.resumed"));
  });

  it("a pause request can be withdrawn before it takes effect", async () => {
    const blocker = blockingTool("fake.block");
    const next = fakeTool("fake.next");
    const { controller } = setup(blocker.tool, next);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block"), step("s2", "fake.next")] });
    await blocker.started;
    controller.pause(s.runId);
    controller.resume(s.runId);
    assert.equal(controller.current()!.snapshot.pauseRequested, false);
    blocker.release();
    await controller.whenFinished(s.runId);
    assert.equal(controller.current()!.snapshot.status, "completed");
    assert.equal(next.calls, 1);
  });

  it("invalid pause/resume calls are conflicts", async () => {
    const blocker = blockingTool("fake.block");
    const { controller } = setup(blocker.tool);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.block")] });
    await blocker.started;
    expectCode(() => controller.resume(s.runId), "conflict"); // nothing to resume
    controller.pause(s.runId);
    expectCode(() => controller.pause(s.runId), "conflict"); // duplicate pause
    blocker.release();
    await controller.whenFinished(s.runId);
    expectCode(() => controller.pause(s.runId), "conflict"); // finished
    expectCode(() => controller.resume(s.runId), "conflict");
  });
});

describe("approval gates", () => {
  const plan = () => ({
    goal: "g",
    steps: [step("s1", "fake.a"), step("s2", "fake.send"), step("s3", "fake.a")],
  });

  it("a sensitive step does not execute until approved, then runs once", async () => {
    const a = fakeTool("fake.a");
    const send = fakeTool("fake.send", { sensitive: true });
    const { controller, events } = setup(a, send);
    const s = controller.start(plan());

    await waitFor(() => controller.current()!.snapshot.status === "waiting_for_approval");
    let snap = controller.current()!.snapshot;
    assert.equal(snap.currentStepId, "s2");
    assert.equal(snap.steps[1].status, "waiting_for_approval");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(send.calls, 0, "must not run before approval");

    controller.approve(s.runId, "s2");
    expectCode(() => controller.approve(s.runId, "s2"), "conflict"); // duplicate approval
    await controller.whenFinished(s.runId);

    snap = controller.current()!.snapshot;
    assert.equal(snap.status, "completed");
    assert.equal(send.calls, 1);
    assert.equal(a.calls, 2);
    const types = events.map((e) => e.type);
    assert.ok(types.indexOf("step.waiting_for_approval") < types.indexOf("approval.granted"));
    assert.ok(types.indexOf("approval.granted") < types.lastIndexOf("step.running"));
  });

  it("a plan-level requiresApproval flag on a normal tool also gates it", async () => {
    const a = fakeTool("fake.a");
    const { controller } = setup(a);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.a", { requiresApproval: true })] });
    await waitFor(() => controller.current()!.snapshot.status === "waiting_for_approval");
    assert.equal(a.calls, 0);
    controller.approve(s.runId, "s1");
    await controller.whenFinished(s.runId);
    assert.equal(a.calls, 1);
  });

  it("rejection prevents the step and all later steps from executing", async () => {
    const a = fakeTool("fake.a");
    const send = fakeTool("fake.send", { sensitive: true });
    const { controller, events } = setup(a, send);
    const s = controller.start(plan());
    await waitFor(() => controller.current()!.snapshot.status === "waiting_for_approval");
    controller.reject(s.runId, "s2");
    await controller.whenFinished(s.runId);

    const snap = controller.current()!.snapshot;
    assert.equal(send.calls, 0);
    assert.equal(a.calls, 1, "step after the rejected one must not run");
    assert.equal(snap.status, "cancelled");
    assert.deepEqual(statuses(controller), ["completed", "skipped", "cancelled"]);
    assert.match(snap.steps[1].reason!, /rejected/);
    assert.ok(events.some((e) => e.type === "approval.rejected"));
  });

  it("cancelling while waiting for approval never runs the protected step", async () => {
    const send = fakeTool("fake.send", { sensitive: true });
    const { controller } = setup(send);
    const s = controller.start({ goal: "g", steps: [step("s1", "fake.send")] });
    await waitFor(() => controller.current()!.snapshot.status === "waiting_for_approval");
    controller.cancel(s.runId);
    await controller.whenFinished(s.runId);
    assert.equal(send.calls, 0);
    assert.equal(controller.current()!.snapshot.status, "cancelled");
    expectCode(() => controller.approve(s.runId, "s1"), "conflict");
  });

  it("approving the wrong step or when nothing is pending is a conflict", async () => {
    const a = fakeTool("fake.a");
    const send = fakeTool("fake.send", { sensitive: true });
    const { controller } = setup(a, send);
    const s = controller.start(plan());
    await waitFor(() => controller.current()!.snapshot.status === "waiting_for_approval");
    expectCode(() => controller.approve(s.runId, "s1"), "conflict");
    expectCode(() => controller.reject(s.runId, "s3"), "conflict");
    assert.equal(send.calls, 0);
    controller.reject(s.runId, "s2");
    await controller.whenFinished(s.runId);
  });
});

describe("duplicate and stale requests", () => {
  it("a second start while a run is active is a conflict and leaves the run untouched", async () => {
    const blocker = blockingTool("fake.block");
    const { controller } = setup(blocker.tool);
    const s = controller.start({ goal: "first", steps: [step("s1", "fake.block")] });
    await blocker.started;
    expectCode(() => controller.start({ goal: "second", steps: [step("s1", "fake.block")] }), "conflict");
    assert.equal(controller.current()!.snapshot.runId, s.runId);
    assert.equal(blocker.tool.calls, 1);
    blocker.release();
    await controller.whenFinished(s.runId);
  });

  it("actions on an unknown or stale run id are rejected; a new run is allowed after the old one finished", async () => {
    const a = fakeTool("fake.a");
    const { controller } = setup(a);
    expectCode(() => controller.cancel("nope"), "not_found");
    const first = controller.start({ goal: "one", steps: [step("s1", "fake.a")] });
    await controller.whenFinished(first.runId);
    const second = controller.start({ goal: "two", steps: [step("s1", "fake.a")] });
    assert.notEqual(first.runId, second.runId);
    expectCode(() => controller.cancel(first.runId), "not_found"); // stale
    expectCode(() => controller.approve(first.runId, "s1"), "not_found");
    await controller.whenFinished(second.runId);
    assert.equal(a.calls, 2);
  });
});
