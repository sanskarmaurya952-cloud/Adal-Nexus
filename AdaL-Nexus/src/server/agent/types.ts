// Pure types/constants only (imported by the web UI as types, so no Node imports here).

export type TaskStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "unverified";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "unverified";

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "unverified",
];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export interface PlanStep {
  id: string;
  title: string;
  tool: string;
  input?: unknown;
  /** Plan-level request for approval. Tools marked `sensitive` always require approval regardless. */
  requiresApproval?: boolean;
  timeoutMs?: number;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface StepState {
  id: string;
  title: string;
  tool: string;
  input?: unknown;
  status: StepStatus;
  requiresApproval: boolean;
  /** Why the step failed / was skipped / cancelled / is unverified. */
  reason?: string;
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunSnapshot {
  runId: string;
  goal: string;
  status: TaskStatus;
  currentStepId: string | null;
  /** True after Pause was requested but before the current step finished and the run actually paused. */
  pauseRequested: boolean;
  steps: StepState[];
  createdAt: string;
  finishedAt?: string;
  summary?: string;
}

export interface RunEvent {
  seq: number;
  type: string;
  runId: string;
  stepId?: string;
  message: string;
  time: string;
  snapshot: RunSnapshot;
}

export interface ToolContext {
  signal: AbortSignal;
  progress(message: string): void;
}

export interface ToolResult {
  output?: unknown;
  /**
   * Result of the tool's own read-back check. Absent/"verified" => step completed;
   * "unverified" => step ends `unverified`; "failed" => step ends `failed`.
   */
  verification?: "verified" | "unverified" | "failed";
  note?: string;
}

export interface Tool {
  name: string;
  description: string;
  /** Sensitive tools (send/publish/delete...) always require explicit approval. */
  sensitive?: boolean;
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
