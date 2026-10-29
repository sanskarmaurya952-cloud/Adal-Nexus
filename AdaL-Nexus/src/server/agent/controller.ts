import { randomUUID } from "node:crypto";
import type { Policy } from "./policy.js";
import { RefError, checkPlanRefs, hasRefs, resolveRefs } from "./refs.js";
import {
  isTerminal,
  type Plan,
  type RunEvent,
  type RunSnapshot,
  type StepState,
  type StepStatus,
  type Tool,
} from "./types.js";

export class ControllerError extends Error {
  constructor(
    readonly code: "conflict" | "not_found" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "ControllerError";
  }
}

interface ToolSource {
  get(name: string): Tool | undefined;
}

type ApprovalOutcome = "approved" | "rejected" | "cancelled";

interface ActiveRun {
  plan: Plan;
  state: RunSnapshot;
  abort: AbortController;
  cancelRequested: boolean;
  rejected: boolean;
  resumeWaiter?: () => void;
  approvalWaiter?: (o: ApprovalOutcome) => void;
  events: RunEvent[];
  seq: number;
  finished: Promise<void>;
}

const MAX_EVENTS = 500;
const MAX_STEPS = 50;

/**
 * Executes one plan at a time, strictly sequentially. Every state change is emitted
 * as an event carrying a full snapshot. Which steps may run is decided by the Policy.
 */
export class Controller {
  private run: ActiveRun | null = null;

  constructor(
    private tools: ToolSource,
    private policy: Policy,
    private sink: (e: RunEvent) => void = () => {},
  ) {}

  // ---------- public API ----------

  start(plan: unknown): RunSnapshot {
    if (this.run && !isTerminal(this.run.state.status)) {
      throw new ControllerError(
        "conflict",
        `run ${this.run.state.runId} is still ${this.run.state.status}; cancel it or wait for it to finish`,
      );
    }
    const valid = this.validate(plan);
    const now = new Date().toISOString();
    const run: ActiveRun = {
      plan: valid,
      state: {
        runId: randomUUID(),
        goal: valid.goal,
        status: "pending",
        currentStepId: null,
        pauseRequested: false,
        createdAt: now,
        steps: valid.steps.map((s) => ({
          id: s.id,
          title: s.title,
          tool: s.tool,
          input: s.input,
          status: "pending" as StepStatus,
          requiresApproval: !!s.requiresApproval,
        })),
      },
      abort: new AbortController(),
      cancelRequested: false,
      rejected: false,
      events: [],
      seq: 0,
      finished: Promise.resolve(),
    };
    this.run = run;
    this.emit(run, "task.created", `Task created with ${valid.steps.length} step(s): ${valid.goal}`);
    run.finished = this.execute(run);
    return this.snap(run);
  }

  cancel(runId: string): RunSnapshot {
    const run = this.requireRun(runId);
    if (isTerminal(run.state.status)) {
      throw new ControllerError("conflict", `run already ${run.state.status}`);
    }
    if (run.cancelRequested) throw new ControllerError("conflict", "cancel already requested");
    run.cancelRequested = true;
    run.state.pauseRequested = false;
    this.emit(run, "task.cancel_requested", "Cancel requested; no further steps will start");
    run.abort.abort();
    run.resumeWaiter?.();
    run.approvalWaiter?.("cancelled");
    run.approvalWaiter = undefined;
    return this.snap(run);
  }

  pause(runId: string): RunSnapshot {
    const run = this.requireRun(runId);
    if (run.state.status !== "running" || run.state.pauseRequested || run.cancelRequested) {
      throw new ControllerError(
        "conflict",
        `cannot pause: run is ${run.state.status}${run.state.pauseRequested ? " (pause already requested)" : ""}`,
      );
    }
    run.state.pauseRequested = true;
    this.emit(run, "task.pause_requested", "Pause requested; run will pause before the next step");
    return this.snap(run);
  }

  resume(runId: string): RunSnapshot {
    const run = this.requireRun(runId);
    if (run.cancelRequested) throw new ControllerError("conflict", "run is being cancelled");
    if (run.state.status === "paused") {
      run.state.pauseRequested = false;
      run.state.status = "running";
      this.emit(run, "task.resumed", "Run resumed");
      run.resumeWaiter?.();
    } else if (run.state.status === "running" && run.state.pauseRequested) {
      run.state.pauseRequested = false;
      this.emit(run, "task.resumed", "Pause request withdrawn before the run paused");
    } else {
      throw new ControllerError("conflict", `cannot resume: run is ${run.state.status}`);
    }
    return this.snap(run);
  }

  approve(runId: string, stepId: string): RunSnapshot {
    const run = this.requireRun(runId);
    const waiter = this.takeApprovalWaiter(run, stepId);
    this.emit(run, "approval.granted", `Approved step "${stepId}"`, stepId);
    waiter("approved");
    return this.snap(run);
  }

  reject(runId: string, stepId: string): RunSnapshot {
    const run = this.requireRun(runId);
    const waiter = this.takeApprovalWaiter(run, stepId);
    this.emit(run, "approval.rejected", `Rejected step "${stepId}"`, stepId);
    waiter("rejected");
    return this.snap(run);
  }

  current(): { snapshot: RunSnapshot; events: RunEvent[] } | null {
    if (!this.run) return null;
    return { snapshot: this.snap(this.run), events: [...this.run.events] };
  }

  whenFinished(runId: string): Promise<void> {
    return this.requireRun(runId).finished;
  }

  // ---------- validation ----------

  private validate(input: unknown): Plan {
    const bad = (m: string) => new ControllerError("invalid", m);
    if (!input || typeof input !== "object") throw bad("plan must be an object");
    const p = input as Record<string, unknown>;
    if (typeof p.goal !== "string" || !p.goal.trim()) throw bad("plan.goal must be a non-empty string");
    if (!Array.isArray(p.steps) || p.steps.length === 0) throw bad("plan.steps must be a non-empty array");
    if (p.steps.length > MAX_STEPS) throw bad(`plan has more than ${MAX_STEPS} steps`);
    const ids = new Set<string>();
    const steps = p.steps.map((raw, i) => {
      if (!raw || typeof raw !== "object") throw bad(`step ${i} must be an object`);
      const s = raw as Record<string, unknown>;
      for (const k of ["id", "title", "tool"] as const) {
        if (typeof s[k] !== "string" || !(s[k] as string).trim()) {
          throw bad(`step ${i}: "${k}" must be a non-empty string`);
        }
      }
      if (ids.has(s.id as string)) throw bad(`duplicate step id "${s.id}"`);
      ids.add(s.id as string);
      if (s.timeoutMs !== undefined && (typeof s.timeoutMs !== "number" || s.timeoutMs <= 0)) {
        throw bad(`step "${s.id}": timeoutMs must be a positive number`);
      }
      return {
        id: s.id as string,
        title: s.title as string,
        tool: s.tool as string,
        input: s.input,
        requiresApproval: s.requiresApproval === true,
        timeoutMs: s.timeoutMs as number | undefined,
      };
    });
    const plan: Plan = { goal: p.goal.trim(), steps };
    const refProblems = checkPlanRefs(steps);
    if (refProblems.length) throw bad(`invalid step references: ${refProblems.join("; ")}`);
    const denied = steps
      .map((s) => ({ s, d: this.policy.evaluate(s) }))
      .filter((x) => x.d.kind === "deny")
      .map((x) => `step "${x.s.id}": ${(x.d as { reason: string }).reason}`);
    if (denied.length) throw bad(`plan rejected by policy: ${denied.join("; ")}`);
    return plan;
  }

  // ---------- execution ----------

  private async execute(run: ActiveRun): Promise<void> {
    try {
      await this.runSteps(run);
    } catch (err) {
      const reason = `controller error: ${err instanceof Error ? err.message : String(err)}`;
      for (const s of run.state.steps) {
        if (s.status === "running" || s.status === "waiting_for_approval") {
          this.transition(run, s, "failed", reason);
        }
      }
      this.closeRemaining(run, 0, "skipped", "skipped: controller error");
    }
    this.finalize(run);
  }

  private async runSteps(run: ActiveRun): Promise<void> {
    run.state.status = "running";
    this.emit(run, "task.started", "Task started");
    const steps = run.state.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const spec = run.plan.steps[i];

      await this.checkpoint(run);
      if (run.cancelRequested) {
        this.closeRemaining(run, i, "cancelled", "cancelled before this step started");
        return;
      }

      const decision = this.policy.evaluate(spec);
      if (decision.kind === "deny") {
        this.transition(run, step, "failed", `denied by policy: ${decision.reason}`, "policy.denied");
        this.closeRemaining(run, i + 1, "skipped", `skipped: step "${step.id}" was denied by policy`);
        return;
      }

      if (decision.kind === "require_approval") {
        step.requiresApproval = true;
        run.state.status = "waiting_for_approval";
        run.state.currentStepId = step.id;
        const pending = new Promise<ApprovalOutcome>((resolve) => (run.approvalWaiter = resolve));
        this.transition(
          run,
          step,
          "waiting_for_approval",
          decision.reason,
          undefined,
          `Approval required for "${step.title}": ${decision.reason}`,
        );
        const outcome = await pending;
        run.approvalWaiter = undefined;
        if (outcome === "cancelled") {
          this.transition(run, step, "cancelled", "cancelled while waiting for approval");
          this.closeRemaining(run, i + 1, "cancelled", "cancelled");
          return;
        }
        if (outcome === "rejected") {
          run.rejected = true;
          this.transition(run, step, "skipped", "rejected by user; step did not run");
          this.closeRemaining(run, i + 1, "cancelled", "task stopped: approval was rejected");
          return;
        }
        run.state.status = "running";
      }

      if (run.cancelRequested) {
        this.transition(run, step, "cancelled", "cancelled before this step started");
        this.closeRemaining(run, i + 1, "cancelled", "cancelled");
        return;
      }

      if (!(await this.runStep(run, i))) return;
    }
  }

  /** Waits while a pause is requested. Returns when resumed or cancelled. */
  private async checkpoint(run: ActiveRun): Promise<void> {
    while (run.state.pauseRequested && !run.cancelRequested) {
      run.state.status = "paused";
      run.state.currentStepId = null;
      this.emit(run, "task.paused", "Run paused before the next step");
      await new Promise<void>((resolve) => (run.resumeWaiter = resolve));
      run.resumeWaiter = undefined;
    }
    if (run.state.status === "paused") run.state.status = "running";
  }

  /** Returns true if the run may continue with the next step. */
  private async runStep(run: ActiveRun, i: number): Promise<boolean> {
    const step = run.state.steps[i];
    const spec = run.plan.steps[i];
    const tool = this.tools.get(spec.tool);
    if (!tool) {
      this.transition(run, step, "failed", `tool "${spec.tool}" is not registered`, "policy.denied");
      this.closeRemaining(run, i + 1, "skipped", `skipped: step "${step.id}" failed`);
      return false;
    }

    // Resolve references to earlier steps' outputs. Only completed/unverified steps provide data.
    let toolInput: unknown = spec.input;
    if (hasRefs(spec.input)) {
      const outputs = new Map<string, unknown>();
      for (const s of run.state.steps) {
        if ((s.status === "completed" || s.status === "unverified") && s.output !== undefined) outputs.set(s.id, s.output);
      }
      try {
        toolInput = resolveRefs(spec.input, outputs);
      } catch (err) {
        const msg = err instanceof RefError ? err.message : "could not resolve step references";
        this.transition(run, step, "failed", `input reference error: ${msg}`);
        this.closeRemaining(run, i + 1, "skipped", `skipped: step "${step.id}" failed`);
        return false;
      }
    }

    run.state.currentStepId = step.id;
    step.startedAt = new Date().toISOString();
    this.transition(run, step, "running", undefined, undefined, `Running "${step.title}" with ${spec.tool}`);

    const stepAbort = new AbortController();
    let timedOut = false;
    const onAbort = () => stepAbort.abort();
    run.abort.signal.addEventListener("abort", onAbort, { once: true });
    const timer = spec.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stepAbort.abort();
        }, spec.timeoutMs)
      : undefined;
    // Rejects when cancelled/timed out, so a tool that ignores its signal cannot hold the run hostage.
    const aborted = new Promise<never>((_, reject) =>
      stepAbort.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
    aborted.catch(() => {});

    try {
      const result = await Promise.race([
        tool.run(toolInput, {
          signal: stepAbort.signal,
          progress: (m) => {
            if (!stepAbort.signal.aborted && step.status === "running") {
              this.emit(run, "step.progress", m, step.id);
            }
          },
        }),
        aborted,
      ]);
      step.output = result.output;
      if (result.verification === "failed") {
        this.transition(run, step, "failed", result.note ?? "tool reported failed verification");
        this.closeRemaining(run, i + 1, "skipped", `skipped: step "${step.id}" failed verification`);
        return false;
      }
      if (result.verification === "unverified") {
        this.transition(run, step, "unverified", result.note ?? "result could not be verified");
        return true;
      }
      this.transition(run, step, "completed", result.note);
      return true;
    } catch (err) {
      if (run.cancelRequested) {
        this.transition(run, step, "cancelled", "cancelled while running");
        this.closeRemaining(run, i + 1, "cancelled", "cancelled");
        return false;
      }
      const reason = timedOut
        ? `timed out after ${spec.timeoutMs} ms`
        : err instanceof Error
          ? err.message
          : String(err);
      this.transition(run, step, "failed", reason);
      this.closeRemaining(run, i + 1, "skipped", `skipped: step "${step.id}" failed`);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      run.abort.signal.removeEventListener("abort", onAbort);
    }
  }

  private finalize(run: ActiveRun): void {
    const steps = run.state.steps;
    // Defensive: nothing may be left mid-flight.
    for (const s of steps) {
      if (s.status === "running" || s.status === "waiting_for_approval") {
        this.transition(run, s, "failed", "run ended while step was in progress");
      }
    }
    const has = (st: StepStatus) => steps.some((s) => s.status === st);
    const status =
      run.cancelRequested || run.rejected
        ? "cancelled"
        : has("failed")
          ? "failed"
          : has("unverified")
            ? "unverified"
            : "completed";
    const count = (st: StepStatus) => steps.filter((s) => s.status === st).length;
    run.state.status = status;
    run.state.currentStepId = null;
    run.state.pauseRequested = false;
    run.state.finishedAt = new Date().toISOString();
    run.state.summary =
      `${status}: ${count("completed")} completed, ${count("unverified")} unverified, ` +
      `${count("failed")} failed, ${count("skipped")} skipped, ${count("cancelled")} cancelled ` +
      `of ${steps.length} step(s)`;
    this.emit(run, "task.finished", run.state.summary);
  }

  // ---------- helpers ----------

  private takeApprovalWaiter(run: ActiveRun, stepId: string): (o: ApprovalOutcome) => void {
    const waiter = run.approvalWaiter;
    if (run.state.status !== "waiting_for_approval" || run.state.currentStepId !== stepId || !waiter) {
      throw new ControllerError("conflict", `no pending approval for step "${stepId}"`);
    }
    run.approvalWaiter = undefined; // a duplicate approve/reject now fails
    return waiter;
  }

  private requireRun(runId: string): ActiveRun {
    if (!this.run || this.run.state.runId !== runId) {
      throw new ControllerError("not_found", `unknown or stale run "${runId}"`);
    }
    return this.run;
  }

  private transition(
    run: ActiveRun,
    step: StepState,
    status: StepStatus,
    reason?: string,
    eventType?: string,
    message?: string,
  ): void {
    step.status = status;
    if (reason !== undefined) step.reason = reason;
    if (status !== "running" && status !== "waiting_for_approval") {
      step.finishedAt = new Date().toISOString();
    }
    this.emit(
      run,
      eventType ?? `step.${status}`,
      message ?? `Step "${step.title}" ${status.replace(/_/g, " ")}${reason ? `: ${reason}` : ""}`,
      step.id,
    );
  }

  private closeRemaining(run: ActiveRun, from: number, status: StepStatus, reason: string): void {
    for (let j = from; j < run.state.steps.length; j++) {
      const s = run.state.steps[j];
      if (s.status === "pending") this.transition(run, s, status, reason);
    }
  }

  private snap(run: ActiveRun): RunSnapshot {
    return structuredClone(run.state);
  }

  private emit(run: ActiveRun, type: string, message: string, stepId?: string): void {
    const event: RunEvent = {
      seq: ++run.seq,
      type,
      runId: run.state.runId,
      stepId,
      message,
      time: new Date().toISOString(),
      snapshot: this.snap(run),
    };
    // History keeps snapshots WITHOUT step outputs (research outputs can be large); live SSE gets the full event.
    run.events.push({
      ...event,
      snapshot: { ...event.snapshot, steps: event.snapshot.steps.map((s) => (s.output === undefined ? s : { ...s, output: undefined })) },
    });
    if (run.events.length > MAX_EVENTS) run.events.shift();
    try {
      this.sink(event);
    } catch {
      /* a failing listener must never break execution */
    }
  }
}
